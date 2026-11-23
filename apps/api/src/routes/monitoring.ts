import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { ACTIVITY, countActiveAlertEvents, portfolioRisk, EventIdParamSchema, PropertyIdParamSchema, ROWS_PATCH_MAX } from '@fastighetsradar/domain';
import { resolveSmsMode, type ServerEnv } from '@fastighetsradar/config';
import { resolveSourceStatuses } from '@fastighetsradar/integrations';
import { orgContext } from '../auth';
import { HttpProblem } from '../errors';
import type { MonitoringService } from '../monitoring/service';
import { portfolioTelemetry } from './customer';

export interface MonitoringRouteDeps {
  env: ServerEnv;
  service: MonitoringService | null;
  requireUser: preHandlerHookHandler;
  requireOrg: preHandlerHookHandler;
}

/** `?ids=a,b,c` – property UUIDs, at most `ROWS_PATCH_MAX`. */
const IdsQuerySchema = z.object({
  ids: z.string().max(ROWS_PATCH_MAX * 37)
    .transform((v) => [...new Set(v.split(',').filter(Boolean))])
    .pipe(z.array(z.string().uuid()).min(1).max(ROWS_PATCH_MAX))
    .optional(),
});

/**
 * Versioned, authenticated, tenant-isolated monitoring endpoints (all under /v1).
 * Every handler resolves the organization from the VERIFIED token (orgContext) and reads only
 * stored snapshots – no handler calls an external provider.
 */
export function registerMonitoringRoutes(app: FastifyInstance, deps: MonitoringRouteDeps) {
  const svc = () => {
    if (!deps.service) throw new HttpProblem(503, 'Monitoring unavailable');
    return deps.service;
  };
  const one = async (req: Parameters<preHandlerHookHandler>[0]) => {
    const { id } = PropertyIdParamSchema.parse(req.params);
    const r = await svc().property(orgContext(req), id);
    if (!r) throw new HttpProblem(404, 'Property not found');
    return r;
  };
  const gen = () => new Date().toISOString();

  // Counts from the organization's list (S-17): no full snapshots, no per-user feed.
  app.get('/v1/portfolio/summary', { preHandler: deps.requireOrg }, async (req) => {
    const org = await svc().organizationList(orgContext(req));
    const p = { generatedAt: org.base.generatedAt, properties: org.properties, sources: org.base.sources };
    const byStatus = { normal: 0, monitor: 0, warning: 0, critical: 0, unknown: 0 };
    for (const s of p.properties) byStatus[s.property.status]++;
    return {
      generatedAt: p.generatedAt,
      properties: p.properties.length,
      byStatus,
      statusMethod: 'highest_official_warning',
      riskScore: portfolioRisk(p.properties.map((s) => ({ name: s.property.name, risk: s.riskIndex }))).score,
      riskMethod: 'fr_risk_index_v1',
      activeOfficialWarnings: countActiveAlertEvents(p.properties),
      publicEvents: p.properties.reduce((a, s) => a + s.events.length, 0),
      sources: p.sources.map((s) => ({ sourceId: s.sourceId, status: s.status, freshness: s.freshness, lastSuccessAt: s.lastSuccessAt })),
    };
  });

  /* ---------------- live patches (docs/plans/skalning.md, Fas 3 / S-12) ---------------- */

  const sendTimed = (req: FastifyRequest, reply: FastifyReply, started: number, properties: number, value: unknown, message: string) => {
    const body = JSON.stringify(value);
    req.log.info(portfolioTelemetry(properties, body, started), message);
    return reply.type('application/json; charset=utf-8').send(body);
  };

  app.get('/v1/portfolio/rows', { preHandler: deps.requireOrg }, async (req, reply) => {
    const { ids } = IdsQuerySchema.parse(req.query);
    if (!ids) throw new HttpProblem(400, 'ids required');
    const started = performance.now();
    const patch = await svc().rows(orgContext(req), ids);
    return sendTimed(req, reply, started, patch.properties.length, patch, 'portfolio rows built');
  });

  app.get('/v1/portfolio/nowcast', { preHandler: deps.requireOrg }, async (req, reply) => {
    const { ids } = IdsQuerySchema.parse(req.query);
    const started = performance.now();
    const patch = await svc().nowcasts(orgContext(req), ids);
    return sendTimed(req, reply, started, patch.nowcasts.length, patch, 'portfolio nowcast built');
  });

  /* ---------------- event page (docs/plans/skalning.md, Fas 2 / S-09) ---------------- */

  app.get('/v1/events/:eventId', { preHandler: deps.requireOrg }, async (req) => {
    const { eventId } = EventIdParamSchema.parse(req.params);
    const page = await svc().event(orgContext(req), eventId);
    if (!page) throw new HttpProblem(404, 'Event not found');
    return page;
  });

  app.get('/v1/events/links/:key', { preHandler: deps.requireOrg }, async (req) => {
    const { key } = z.object({ key: z.string().regex(/^[0-9a-f]{16}$/) }).parse(req.params);
    const id = await svc().eventByLinkKey(orgContext(req), key);
    if (!id) throw new HttpProblem(404, 'Event not found');
    return { id };
  });

  app.get('/v1/properties/:id/snapshot', { preHandler: deps.requireOrg }, async (req) => {
    const r = await one(req);
    return { generatedAt: gen(), snapshot: r.snapshot, sources: r.statuses };
  });

  app.get('/v1/properties/:id/forecast', { preHandler: deps.requireOrg }, async (req) => {
    const { snapshot } = await one(req);
    return { generatedAt: gen(), dataClass: 'FORECAST', forecast: snapshot.forecast, current: snapshot.metrics.filter((m) => m.kind === 'forecast') };
  });

  app.get('/v1/properties/:id/warnings', { preHandler: deps.requireOrg }, async (req) => {
    const { snapshot } = await one(req);
    return {
      generatedAt: gen(),
      dataClass: 'OFFICIAL_WARNING',
      status: snapshot.property.status,
      statusReason: snapshot.property.statusReason ?? null,
      statusMethod: 'highest_official_warning',
      warnings: snapshot.warnings,
    };
  });

  app.get('/v1/properties/:id/events', { preHandler: deps.requireOrg }, async (req) => {
    const { snapshot } = await one(req);
    return { generatedAt: gen(), dataClass: 'PUBLIC_EVENT', events: snapshot.events };
  });

  app.get('/v1/properties/:id/environment', { preHandler: deps.requireOrg }, async (req) => {
    const { snapshot } = await one(req);
    const m = snapshot.monitoring;
    return {
      generatedAt: gen(),
      county: m?.county ?? null,
      observations: m?.observations ?? [],
      airQuality: m?.airQuality ?? [],
      groundwater: m?.groundwater ?? null,
      statistics: m?.statistics ?? null,
      coverage: m?.coverage ?? [],
      airQualityIndex: null,
    };
  });

  app.get('/v1/properties/:id/flood', { preHandler: deps.requireOrg }, async (req) => {
    const { snapshot } = await one(req);
    return { generatedAt: gen(), dataClass: 'STATIC_GEODATA', exposure: snapshot.flood, context: snapshot.monitoring?.flood ?? null };
  });

  /** Short activity log for the property's "Tidslinje" (ACTIVITY.days, newest first). */
  app.get('/v1/properties/:id/activity', { preHandler: deps.requireOrg }, async (req) => {
    const { id } = PropertyIdParamSchema.parse(req.params);
    const items = await svc().activity(orgContext(req), id);
    if (!items) throw new HttpProblem(404, 'Property not found');
    return { propertyId: id, since: new Date(Date.now() - ACTIVITY.days * 86_400_000).toISOString(), items };
  });

  /** Affected stretch/point of the property's matched traffic events, for "Visa på karta". */
  app.get('/v1/properties/:id/event-map', { preHandler: deps.requireOrg }, async (req) => {
    const { id } = PropertyIdParamSchema.parse(req.params);
    const items = await svc().eventMap(orgContext(req), id);
    if (!items) throw new HttpProblem(404, 'Property not found');
    return { propertyId: id, items };
  });

  /** One event from the property's feed on the map – also an ended one, shown greyed out. */
  app.get('/v1/properties/:id/event-map/:eventId', { preHandler: deps.requireOrg }, async (req) => {
    const { id } = PropertyIdParamSchema.parse(req.params);
    const { eventId } = EventIdParamSchema.parse(req.params);
    const result = await svc().eventMapEvent(orgContext(req), id, eventId);
    if (!result) throw new HttpProblem(404, 'Event not found');
    return result;
  });

  app.get('/v1/changes', { preHandler: deps.requireOrg }, async (req) => {
    const rows = await svc().changes(orgContext(req), 100);
    return {
      generatedAt: gen(),
      note: 'Normaliserad, deduplicerad ändringslogg – underlag för framtida SMS. Inga SMS skickas.',
      smsMode: resolveSmsMode(deps.env),
      changes: rows.map((r) => ({ id: r.id, propertyId: r.property_id, sourceId: r.source_id, changeType: r.change_type, dataClass: r.data_class, severity: r.severity, headline: r.headline, createdAt: r.created_at.toISOString() })),
    };
  });

  /* ---------------- source status (authenticated) ---------------- */

  app.get('/v1/utility-coverage', { preHandler: deps.requireOrg }, async (req) => ({
    generatedAt: gen(),
    reports: await svc().utilityCoverage(orgContext(req).organizationId),
  }));

  app.get('/v1/sources/status', { preHandler: deps.requireUser }, async () => ({
    generatedAt: gen(),
    smsMode: resolveSmsMode(deps.env),
    sources: deps.service ? await deps.service.statuses() : resolveSourceStatuses(deps.env),
    /** Health per grid operator behind the 'utility_outages' source (docs/plans/stromavbrott.md). */
    utilityOperators: deps.service ? await deps.service.operatorStatuses() : [],
  }));
}
