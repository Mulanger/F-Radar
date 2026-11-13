import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadServerEnv } from '@fastighetsradar/config';
import { ReadinessResponseSchema } from '@fastighetsradar/domain';
import { buildApp } from '../src/app';

describe('API bootstrap', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp(loadServerEnv({ NODE_ENV: 'test', GEOAPIFY_API_KEY: 'very-secret-geoapify-key' }), {
      logger: false,
      probes: { database: async () => ({ status: 'ok', detail: 'fake' }) },
      verifyAuth: async (req) =>
        req.headers.authorization === 'Bearer tok' ? { userId: 'user_test', sessionId: 's', clerkOrgId: null, orgRole: null, orgSlug: null } : null,
    });
  });
  afterAll(() => app.close());

  it('GET /health/live', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /health/ready is ready when configured probes pass (unconfigured ones are skipped)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    const body = ReadinessResponseSchema.parse(res.json());
    expect(body.checks.database!.status).toBe('ok');
    expect(body.checks.redis!.status).toBe('skipped');
    expect(body.status).toBe('ready');
  });

  it('GET /v1/sources/status never exposes secrets and never claims ok', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/sources/status' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'GET', url: '/v1/sources/status', headers: { authorization: 'Bearer tok' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('very-secret-geoapify-key');
    const body = res.json() as { smsMode: string; sources: Array<{ sourceId: string; status: string }> };
    expect(body.smsMode).toBe('disabled');
    expect(body.sources.length).toBeGreaterThan(10);
    body.sources.forEach((s) => expect(s.status).not.toBe('ok'));
  });

  it('returns RFC 9457 problem details for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope?apiKey=x', headers: { 'x-request-id': 'req-123' } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 404, title: 'Not Found', instance: '/nope', requestId: 'req-123' });
  });
});

describe('readiness with a failing critical probe', () => {
  it('stays 200 when the failing probe is non-critical (degraded)', async () => {
    const app = await buildApp(loadServerEnv({ NODE_ENV: 'test' }), {
      logger: false,
      probes: { database: async () => ({ status: 'error', detail: 'down' }) },
    });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'degraded', checks: { database: { status: 'error' } } });
    await app.close();
  });
});
