import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { ACTIVITY, HistoryQuerySchema, historyPeriod, portfolioRisk, PropertyIdParamSchema, type StreamUpdate } from '@fastighetsradar/domain';
import { resolveSmsMode, type ServerEnv } from '@fastighetsradar/config';
import { resolveSourceStatuses } from '@fastighetsradar/integrations';
import { orgContext } from '../auth';
import { HttpProblem } from '../errors';
import type { MonitoringService } from '../monitoring/service';

export interface MonitoringRouteDeps {
  env: ServerEnv;
  service: MonitoringService | null;
  requireUser: preHandlerHookHandler;
  requireOrg: preHandlerHookHandler;
}

/** SSE limits (Build pod: keep connection count small). */
export const STREAM_MAX_PER_ORG = 20;
export const STREAM_MAX_TOTAL = 200;
export const STREAM_MAX_DURATION_MS = 60_000;
const HEARTBEAT_MS = 25_000;

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

  app.get('/v1/portfolio/summary', { preHandler: deps.requireOrg }, async (req) => {
    const p = await svc().portfolio(orgContext(req));
    const byStatus = { normal: 0, monitor: 0, warning: 0, critical: 0, unknown: 0 };
    for (const s of p.properties) byStatus[s.property.status]++;
    return {
      generatedAt: p.generatedAt,
      properties: p.properties.length,
      byStatus,
      statusMethod: 'highest_official_warning',
      riskScore: portfolioRisk(p.properties.map((s) => ({ name: s.property.name, risk: s.riskIndex }))).score,
      riskMethod: 'fr_risk_index_v1',
      activeOfficialWarnings: p.properties.reduce((a, s) => a + s.activeAlertCount, 0),
      publicEvents: p.properties.reduce((a, s) => a + s.events.length, 0),
      sources: p.sources.map((s) => ({ sourceId: s.sourceId, status: s.status, freshness: s.freshness, lastSuccessAt: s.lastSuccessAt })),
    };
  });

  app.get('/v1/properties/:id/snapshot', { preHandler: deps.requireOrg }, async (req) => {
    const r = await one(req);
    return { generatedAt: gen(), snapshot: r.snapshot, sources: r.statuses };
  });

  app.get('/v1/properties/:id/history', { preHandler: deps.requireOrg }, async (req) => {
    const { id } = PropertyIdParamSchema.parse(req.params);
    const query = HistoryQuerySchema.parse(req.query);
    let period;
    try {
      period = historyPeriod(query);
    } catch {
      throw new HttpProblem(400, 'Invalid history period');
    }
    const result = await svc().history(orgContext(req), id, period);
    if (!result) throw new HttpProblem(404, 'Property not found');
    return result;
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

  app.get('/v1/changes', { preHandler: deps.requireOrg }, async (req) => {
    const rows = await svc().changes(orgContext(req), 100);
    return {
      generatedAt: gen(),
      note: 'Normaliserad, deduplicerad ändringslogg – underlag för framtida SMS. Inga SMS skickas.',
      smsMode: resolveSmsMode(deps.env),
      changes: rows.map((r) => ({ id: r.id, propertyId: r.property_id, sourceId: r.source_id, changeType: r.change_type, dataClass: r.data_class, severity: r.severity, headline: r.headline, createdAt: r.created_at.toISOString() })),
    };
  });

  /* ---------------- live stream (SSE) ---------------- */

  const open = new Map<string, number>();
  const connections = new Set<() => void>();
  let total = 0;
  app.addHook('preClose', async () => { for (const close of connections) close(); });

  app.get('/v1/stream', { preHandler: deps.requireOrg }, async (req, reply) => {
    const ctx = orgContext(req);
    const service = svc();
    const lifetime = Math.min(STREAM_MAX_DURATION_MS, (req.auth!.expiresAt ?? Date.now() + STREAM_MAX_DURATION_MS) - Date.now());
    if (lifetime <= 0) throw new HttpProblem(401, 'Session expired');
    const mine = open.get(ctx.organizationId) ?? 0;
    if (mine >= STREAM_MAX_PER_ORG || total >= STREAM_MAX_TOTAL) throw new HttpProblem(429, 'Too many live connections');
    open.set(ctx.organizationId, mine + 1);
    total++;

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-request-id': req.id,
      'x-content-type-options': 'nosniff',
    });
    const send = (event: string, data: unknown) => {
      if (!res.destroyed && !res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) res.destroy();
    };
    res.write(`retry: 15000\n\n`);
    send('hello', { at: gen(), maxDurationMs: lifetime });

    let closed = false;
    const unsubscribe = service.bus.subscribe(ctx.organizationId, (u) => {
      const payload: StreamUpdate = { at: u.at, sources: u.sources, propertyIds: u.propertyIds, changes: u.changes };
      send('update', payload);
    });
    const heartbeat = setInterval(() => { if (!res.write(`: hb ${Date.now()}\n\n`)) res.destroy(); }, HEARTBEAT_MS);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(maxTimer);
      unsubscribe();
      const remaining = Math.max(0, (open.get(ctx.organizationId) ?? 1) - 1);
      if (remaining) open.set(ctx.organizationId, remaining);
      else open.delete(ctx.organizationId);
      total = Math.max(0, total - 1);
      connections.delete(close);
    };
    const close = () => {
      send('bye', { reason: 'reauthenticate' });
      cleanup();
      res.end();
    };
    // Never retain tenant access beyond this JWT. Reconnection verifies a fresh session.
    const maxTimer = setTimeout(close, lifetime);
    connections.add(close);
    req.raw.on('aborted', cleanup);
    res.on('close', cleanup);
  });

  /* ---------------- source status (authenticated) ---------------- */

  app.get('/v1/sources/status', { preHandler: deps.requireUser }, async () => ({
    generatedAt: gen(),
    smsMode: resolveSmsMode(deps.env),
    sources: deps.service ? await deps.service.statuses() : resolveSourceStatuses(deps.env),
    /** Health per grid operator behind the 'utility_outages' source (docs/plans/stromavbrott.md). */
    utilityOperators: deps.service ? await deps.service.operatorStatuses() : [],
  }));
}
