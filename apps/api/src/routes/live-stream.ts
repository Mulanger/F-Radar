import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { StreamUpdate } from '@fastighetsradar/domain';
import { orgContext } from '../auth';
import { HttpProblem } from '../errors';
import type { MonitoringBus } from '../monitoring/bus';
import { STREAM_MAX_TOTAL, type LiveStreamCounter } from '../monitoring/live-stream-counts';

const STREAM_MAX_PER_ORG = 20;
const STREAM_MAX_DURATION_MS = 60_000;
const HEARTBEAT_MS = 25_000;

interface StreamRouteDeps {
  bus?: MonitoringBus;
  requireOrg: preHandlerHookHandler;
  streams: LiveStreamCounter;
}

export function registerLiveStreamRoute(app: FastifyInstance, { bus, requireOrg, streams }: StreamRouteDeps) {
  const open = new Map<string, number>();
  const connections = new Set<() => void>();
  let closing = false;
  app.addHook('preClose', async () => {
    closing = true;
    for (const close of connections) close();
  });

  app.get('/v1/stream', { preHandler: requireOrg }, async (req, reply) => {
    const { organizationId } = orgContext(req);
    if (closing || !bus) throw new HttpProblem(503, 'Monitoring unavailable');
    const lifetime = Math.min(STREAM_MAX_DURATION_MS, (req.auth!.expiresAt ?? Date.now() + STREAM_MAX_DURATION_MS) - Date.now());
    if (lifetime <= 0) throw new HttpProblem(401, 'Session expired');
    const mine = open.get(organizationId) ?? 0;
    if (mine >= STREAM_MAX_PER_ORG || streams.current >= STREAM_MAX_TOTAL) throw new HttpProblem(429, 'Too many live connections');

    reply.hijack();
    const res = reply.raw;
    if (req.raw.aborted || res.destroyed) { res.destroy(); return; }
    open.set(organizationId, mine + 1);
    const countClosed = streams.open();

    const write = (chunk: string) => {
      if (!res.destroyed && !res.writableEnded && !res.write(chunk)) res.destroy();
    };
    const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const unsubscribe = bus.subscribe(organizationId, (u) => {
      const payload: StreamUpdate = { at: u.at, sources: u.sources, propertyIds: u.propertyIds, changes: u.changes, ...(u.all ? { all: true } : {}) };
      send('update', payload);
    });
    const heartbeat = setInterval(() => write(`: hb ${Date.now()}\n\n`), HEARTBEAT_MS);
    const cleanup = () => {
      if (!connections.delete(close)) return;
      req.raw.off('aborted', cleanup);
      clearInterval(heartbeat);
      clearTimeout(maxTimer);
      unsubscribe();
      countClosed();
      const remaining = (open.get(organizationId) ?? 1) - 1;
      if (remaining) open.set(organizationId, remaining);
      else open.delete(organizationId);
    };
    const close = () => {
      cleanup();
      try { send('bye', { reason: 'reauthenticate' }); }
      finally { res.end(); }
    };
    // Never retain tenant access beyond this JWT. Reconnection verifies a fresh session.
    const maxTimer = setTimeout(close, lifetime);
    connections.add(close);
    req.raw.once('aborted', cleanup);
    res.once('close', cleanup);
    res.once('error', () => { cleanup(); res.destroy(); });

    try {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        'x-request-id': req.id,
        'x-content-type-options': 'nosniff',
      });
      write('retry: 15000\n\n');
      send('hello', { at: new Date().toISOString(), maxDurationMs: lifetime });
    } catch (err) {
      cleanup();
      res.destroy();
      throw err;
    }
  });
}
