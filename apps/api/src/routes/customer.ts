import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { ServerEnv } from '@fastighetsradar/config';
import {
  PropertyCreateSchema,
  PropertyIdParamSchema,
  PropertyUpdateSchema,
  type GeocodingSuggestionsResponse,
} from '@fastighetsradar/domain';
import { createProperty, deleteProperty, getProperty, listProperties, updateProperty, type Queryable } from '@fastighetsradar/db';
import { GEOAPIFY_ATTRIBUTION, resolveSourceStatuses, type AdapterContext, type GeocodingProvider } from '@fastighetsradar/integrations';
import { orgContext } from '../auth';
import { createRateLimiter } from '../rate-limit';
import { HttpProblem } from '../errors';
import { buildLivePortfolio } from '../portfolio';
import type { MonitoringService } from '../monitoring/service';

export interface CustomerRouteDeps {
  env: ServerEnv;
  db: Queryable | null;
  geocoder: GeocodingProvider;
  fetch: typeof fetch;
  requireUser: preHandlerHookHandler;
  requireOrg: preHandlerHookHandler;
  monitoring?: MonitoringService | null;
}

/** Max properties per organization (abuse guard, IMPLEMENTATION.md §16.1). */
export const MAX_PROPERTIES_PER_ORG = 500;

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
    const { rows } = await db().query<{ n: string }>('SELECT count(*)::text AS n FROM properties WHERE organization_id = $1', [ctx.organizationId]);
    if (Number(rows[0]?.n ?? 0) >= MAX_PROPERTIES_PER_ORG) throw new HttpProblem(409, 'Property limit reached');
    const property = await createProperty(db(), ctx, input);
    req.log.info({ propertyId: property.id }, 'property created');
    void deps.monitoring?.propertyChanged(ctx.organizationId);
    reply.code(201);
    return { property };
  });

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

  app.get('/v1/portfolio', { preHandler: deps.requireOrg }, async (req) => {
    const ctx = orgContext(req);
    if (deps.monitoring) return deps.monitoring.portfolio(ctx);
    return buildLivePortfolio({
      clerkOrgId: ctx.clerkOrgId,
      orgSlug: ctx.orgSlug,
      properties: await listProperties(db(), ctx),
      sources: resolveSourceStatuses(deps.env),
    });
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
