import { once } from 'node:events';
import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadServerEnv } from '@fastighetsradar/config';
import type { Queryable } from '@fastighetsradar/db';
import { buildApp } from '../src/app';
import { MonitoringBus } from '../src/monitoring/bus';
import { LiveStreamCounter, STREAM_MAX_TOTAL, STREAM_WARN_AT } from '../src/monitoring/live-stream-counts';
import { MonitoringService } from '../src/monitoring/service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('live stream counters', () => {
  it('logs once at the threshold even if the count falls and reaches it again', () => {
    const warn = vi.fn();
    const streams = new LiveStreamCounter(warn);
    const bus = new MonitoringBus();
    const open = () => {
      const close = streams.open();
      const unsubscribe = bus.subscribe('org', vi.fn());
      return () => { close(); unsubscribe(); };
    };
    const close = Array.from({ length: STREAM_WARN_AT - 1 }, open);
    expect(warn).not.toHaveBeenCalled();
    const atThreshold = open();
    expect(warn).toHaveBeenCalledExactlyOnceWith({ opened: STREAM_WARN_AT, closed: 0, current: STREAM_WARN_AT, peak: STREAM_WARN_AT });
    atThreshold();
    atThreshold();
    close.push(...Array.from({ length: STREAM_MAX_TOTAL - close.length }, open));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount()).toBe(STREAM_MAX_TOTAL);
    for (const stop of close) stop();
    expect(bus.listenerCount()).toBe(0);
    expect(streams.snapshot()).toEqual({ opened: STREAM_MAX_TOTAL + 1, closed: STREAM_MAX_TOTAL + 1, current: 0, peak: STREAM_MAX_TOTAL });
  });
});

describe('live stream HTTP lifecycle', () => {
  const env = loadServerEnv({ NODE_ENV: 'test' });
  const db: Queryable = {
    async query<R>(sql: string) {
      const rows = sql.includes('INSERT INTO organizations') ? [{ id: 'test-org-id' }] : [];
      return { rows: rows as R[] };
    },
  };
  const identity = { userId: 'test-user-id', sessionId: 'session', clerkOrgId: 'org_test', orgRole: 'org:admin', orgSlug: null };
  let app: FastifyInstance;
  let bus: MonitoringBus;
  let base: string;
  let verifyStarted: ReturnType<typeof deferred>;
  let allowVerify: ReturnType<typeof deferred>;
  let requestAborted: ReturnType<typeof deferred>;

  beforeEach(async () => {
    bus = new MonitoringBus();
    verifyStarted = deferred();
    allowVerify = deferred();
    requestAborted = deferred();
    app = await buildApp(env, {
      logger: false, db, monitoring: new MonitoringService(db, env, bus),
      verifyAuth: async (req) => {
        if (req.headers.authorization === 'Bearer pending') {
          req.raw.socket.once('close', () => requestAborted.resolve());
          verifyStarted.resolve();
          await allowVerify.promise;
        }
        return { ...identity, expiresAt: Date.now() + (req.headers.authorization === 'Bearer expiring' ? 500 : 60_000) };
      },
    });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterEach(async () => {
    allowVerify.resolve();
    await app.close();
  });

  const health = async (url = '/health') => (await app.inject({ url })).json().liveStreams;

  it('exposes only aggregate counts and releases listeners after the client aborts', async () => {
    const abort = new AbortController();
    const res = await fetch(`${base}/v1/stream`, { headers: { authorization: 'Bearer active' }, signal: abort.signal });
    try {
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const expected = { opened: 1, closed: 0, current: 1, peak: 1 };
      for (const url of ['/health', '/health/live', '/health/ready']) expect(await health(url)).toEqual(expected);
      expect(bus.listenerCount()).toBe(1);
    } finally {
      abort.abort();
    }
    await vi.waitFor(async () => expect(await health()).toEqual({ opened: 1, closed: 1, current: 0, peak: 1 }));
    expect(bus.listenerCount()).toBe(0);
  });

  it('never counts a disconnected request whose authentication was still pending', async () => {
    const client = request(`${base}/v1/stream`, { headers: { authorization: 'Bearer pending' } });
    client.on('error', () => undefined);
    client.end();
    await verifyStarted.promise;
    const closed = once(client, 'close').catch(() => undefined);
    client.destroy();
    await closed;
    await requestAborted.promise;
    allowVerify.resolve();
    expect(await health()).toEqual({ opened: 0, closed: 0, current: 0, peak: 0 });
    expect(bus.listenerCount()).toBe(0);
  });

  it('counts a server-side session expiry as a closure', async () => {
    const res = await fetch(`${base}/v1/stream`, { headers: { authorization: 'Bearer expiring' } });
    expect(await res.text()).toContain('event: bye');
    expect(await health()).toEqual({ opened: 1, closed: 1, current: 0, peak: 1 });
    expect(bus.listenerCount()).toBe(0);
  });

  it('ends open streams and releases their listeners on shutdown', async () => {
    const res = await fetch(`${base}/v1/stream`, { headers: { authorization: 'Bearer active' } });
    expect(await health()).toEqual({ opened: 1, closed: 0, current: 1, peak: 1 });
    const [body] = await Promise.all([res.text(), app.close()]);
    expect(body).toContain('event: bye');
    expect(bus.listenerCount()).toBe(0);
  });
});
