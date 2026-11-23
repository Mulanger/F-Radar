import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { ServerEnv } from '@fastighetsradar/config';
import {
  listPortfolio,
  PropertyCreateSchema,
  PropertyIdParamSchema,
  PropertyImportRequestSchema,
  PropertyUpdateSchema,
  type GeocodingSuggestionsResponse,
  type PositionReviewResponse,
  type PropertyImportResponse,
} from '@fastighetsradar/domain';
import { createProperty, deleteProperty, getProperty, getPropertyLimit, listPositionReview, listProperties, updateProperty, type Queryable } from '@fastighetsradar/db';
import { GEOAPIFY_ATTRIBUTION, resolveSourceStatuses, type AdapterContext, type GeocodingProvider } from '@fastighetsradar/integrations';
import { orgContext } from '../auth';
import { createRateLimiter } from '../rate-limit';
import { HttpProblem } from '../errors';
import { buildLivePortfolio } from '../portfolio';
import type { MonitoringService } from '../monitoring/service';
import { createPacer, IMPORT_GEOCODE_PER_SECOND, importPropertyBatch, serializeForOrganization, type ImportGeocoder } from '../property-import';

/** While an import's batches keep coming, its re-match waits this long after the latest one (S-29). */
export const IMPORT_SETTLE_MS = 30_000;

export interface CustomerRouteDeps {
  env: ServerEnv;
  db: Queryable | null;
  geocoder: GeocodingProvider;
  fetch: typeof fetch;
  requireUser: preHandlerHookHandler;
  requireOrg: preHandlerHookHandler;
  monitoring?: MonitoringService | null;
  importGeocodePerSecond?: number;
}

/** Log fields for one portfolio response: how many properties, how big, how long, heap after serializing. */
export function portfolioTelemetry(properties: number, body: string, startedAt: number, now = performance.now()) {
  return {
    portfolio: {
      properties,
      bytes: Buffer.byteLength(body),
      durationMs: Math.round(now - startedAt),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1_048_576),
    },
  };
}


export function registerCustomerRoutes(app: FastifyInstance, deps: CustomerRouteDeps) {
  const db = () => {
    if (!deps.db) throw new HttpProblem(503, 'Database unavailable');
    return deps.db;
  };

  app.get('/v1/me', { preHandler: deps.requireUser }, async (req) => ({
    userId: req.auth!.userId,
    organization: req.auth!.clerkOrgId ? { clerkOrgId: req.auth!.clerkOrgId, slug: req.auth!.orgSlug, role: req.auth!.orgRole } : null,
  }));

  /* ---------------- properties ---------------- */

  app.get('/v1/properties', { preHandler: deps.requireOrg }, async (req) => ({
    properties: await listProperties(db(), orgContext(req)),
  }));

  app.get('/v1/properties/:id', { preHandler: deps.requireOrg }, async (req) => {
    const { id } = PropertyIdParamSchema.parse(req.params);
    const p = await getProperty(db(), orgContext(req), id);
    if (!p) throw new HttpProblem(404, 'Property not found');
    return { property: p };
  });

  app.post('/v1/properties', { preHandler: deps.requireOrg }, async (req, reply) => {
    const input = PropertyCreateSchema.parse(req.body);
    const ctx = orgContext(req);
    // Per organization (abuse guard, IMPLEMENTATION.md §16.1; docs/plans/skalning.md, S-30).
    const [{ rows }, limit] = await Promise.all([
      db().query<{ n: string }>('SELECT count(*)::text AS n FROM properties WHERE organization_id = $1', [ctx.organizationId]),
      getPropertyLimit(db(), ctx.organizationId),
    ]);
    if (Number(rows[0]?.n ?? 0) >= limit) throw new HttpProblem(409, 'Property limit reached');
    const property = await createProperty(db(), ctx, input);
    req.log.info({ propertyId: property.id }, 'property created');
    void deps.monitoring?.propertyChanged(ctx.organizationId);
    reply.code(201);
    return { property };
  });

  /* ---------------- import (docs/plans/skalning.md, Fas 6 / S-28) ---------------- */

  // One pacer for every import on this process: Geoapify's limit is per key, not per customer.
  const importPacer = createPacer(deps.importGeocodePerSecond ?? IMPORT_GEOCODE_PER_SECOND);
  // Batches per user instead of the ordinary write limit (BULK_WRITE_ROUTES): 1000 rows with
  // coordinates is 40 batches; with address searches a batch takes seconds anyway.
  const importLimiter = createRateLimiter({ capacity: 40, refillPerSecond: 1 });
  app.post('/v1/properties/import', { preHandler: deps.requireOrg }, async (req, reply): Promise<PropertyImportResponse> => {
    if (!importLimiter.take(req.auth!.userId)) {
      reply.header('retry-after', '2');
      throw new HttpProblem(429, 'Too many requests');
    }
    const { rows, final } = PropertyImportRequestSchema.parse(req.body);
    const ctx = orgContext(req);
    const abort = new AbortController();
    // The request stream closes once its body is read; only a response closed before it ended means the client left.
    reply.raw.on('close', () => !reply.raw.writableEnded && abort.abort());
    const geocode: ImportGeocoder = async (address, signal) => {
      await importPacer.wait(signal);
      const r = await deps.geocoder.resolve(address, { env: deps.env, fetch: deps.fetch, logger: req.log, now: () => new Date(), signal });
      if (r.ok) return { ok: true, data: r.data };
      if (r.error === 'invalid_payload') return { ok: true, data: null };
      // A passing error is retried by sending the row again; a missing key or the day's quota is not.
      const retry = r.error === 'timeout' || r.error === 'upstream_error' || (r.error === 'rate_limited' && r.retryAfterSeconds !== undefined);
      return { ok: false, retry };
    };
    const outcome = await serializeForOrganization(ctx.organizationId, async () =>
      importPropertyBatch(db(), ctx, rows, { geocode, limit: await getPropertyLimit(db(), ctx.organizationId), signal: abort.signal }),
    );
    // One re-match for the whole import: held while batches follow, run shortly after the last one.
    if (outcome.created > 0 || final) {
      void deps.monitoring?.propertyChanged(ctx.organizationId, { changes: outcome.created, settleMs: final ? undefined : IMPORT_SETTLE_MS });
    }
    const statuses: Record<string, number> = {};
    for (const r of outcome.results) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    req.log.info({ propertyImport: { rows: rows.length, final, statuses } }, 'property import batch');
    return { results: outcome.results, remaining: outcome.remaining };
  });

  // Street or approximate hits nobody has checked yet (the import's review list).
  app.get('/v1/properties/position-review', { preHandler: deps.requireOrg }, async (req): Promise<PositionReviewResponse> => ({
    properties: await listPositionReview(db(), orgContext(req)),
  }));

  app.patch('/v1/properties/:id', { preHandler: deps.requireOrg }, async (req) => {
    const { id } = PropertyIdParamSchema.parse(req.params);
    const patch = PropertyUpdateSchema.parse(req.body);
    const ctx = orgContext(req);
    const property = await updateProperty(db(), ctx, id, patch);
    if (!property) throw new HttpProblem(404, 'Property not found');
    void deps.monitoring?.propertyChanged(ctx.organizationId);
    return { property };
  });

  app.delete('/v1/properties/:id', { preHandler: deps.requireOrg }, async (req, reply) => {
    const { id } = PropertyIdParamSchema.parse(req.params);
    const ctx = orgContext(req);
    if (!(await deleteProperty(db(), ctx, id))) throw new HttpProblem(404, 'Property not found');
    void deps.monitoring?.propertyChanged(ctx.organizationId);
    req.log.info({ propertyId: id }, 'property deleted');
    reply.code(204);
    return null;
  });

  /* ---------------- portfolio snapshot ---------------- */

  app.get('/v1/portfolio', { preHandler: deps.requireOrg }, async (req, reply) => {
    const ctx = orgContext(req);
    const started = performance.now();
    // The list: detail-only parts emptied; the property page loads /v1/properties/:id/snapshot (S-10).
    // `list()` already is the list; `listPortfolio` again is cheap and keeps the contract if it changes.
    const portfolio = deps.monitoring
      ? listPortfolio(await deps.monitoring.list(ctx))
      : buildLivePortfolio({
        clerkOrgId: ctx.clerkOrgId,
        orgSlug: ctx.orgSlug,
        properties: await listProperties(db(), ctx),
        sources: resolveSourceStatuses(deps.env),
      });
    const body = JSON.stringify(portfolio);
    // Scale telemetry (docs/plans/skalning.md, Fas 0 / S-33): counts, size, time and heap only – never content.
    req.log.info(portfolioTelemetry(portfolio.properties.length, body, started), 'portfolio built');
    return reply.type('application/json; charset=utf-8').send(body);
  });

  /* ---------------- geocoding (Geoapify proxy) ---------------- */

  const SuggestQuery = z.object({ q: z.string().max(200) });
  const suggestLimiter = createRateLimiter({ capacity: 30, refillPerSecond: 0.5 });
  app.get(
    '/v1/geocoding/suggestions',
    { preHandler: deps.requireOrg },
    async (req, reply): Promise<GeocodingSuggestionsResponse> => {
      const { q } = SuggestQuery.parse(req.query);
      // Per-user limit (all traffic arrives from the Next.js server, so client IPs are meaningless here).
      if (!suggestLimiter.take(req.auth!.userId)) {
        return { suggestions: [], attribution: GEOAPIFY_ATTRIBUTION, status: 'rate_limited' };
      }
      const abort = new AbortController();
      req.raw.on('close', () => abort.abort());
      const ctx: AdapterContext = { env: deps.env, fetch: deps.fetch, logger: req.log, now: () => new Date(), signal: abort.signal };
      let r;
      try {
        r = await deps.geocoder.suggest(q, ctx);
      } catch {
        // client went away
        reply.code(499);
        return { suggestions: [], attribution: GEOAPIFY_ATTRIBUTION, status: 'ok' };
      }
      if (r.ok) return { suggestions: r.data.filter((s) => s.provider === 'geoapify').map((s) => ({ ...s, provider: 'geoapify' as const })), attribution: GEOAPIFY_ATTRIBUTION, status: 'ok' };
      if (r.error === 'invalid_payload' && q.trim().length < 3) return { suggestions: [], attribution: GEOAPIFY_ATTRIBUTION, status: 'ok' };
      if (r.error === 'rate_limited') return { suggestions: [], attribution: GEOAPIFY_ATTRIBUTION, status: 'rate_limited' };
      return { suggestions: [], attribution: GEOAPIFY_ATTRIBUTION, status: 'geocoding_unavailable' };
    },
  );
}
