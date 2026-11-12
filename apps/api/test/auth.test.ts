import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadServerEnv } from '@fastighetsradar/config';
import type { Queryable } from '@fastighetsradar/db';
import type { GeocodingProvider } from '@fastighetsradar/integrations';
import { buildApp } from '../src/app';
import type { AuthVerifier, VerifiedIdentity } from '../src/auth';
import { buildLivePortfolio } from '../src/portfolio';

/** Token → identity table standing in for Clerk's verified session claims. */
const IDENTITIES: Record<string, VerifiedIdentity> = {
  'tok-a': { userId: 'user_aaa', sessionId: 'sess_a', clerkOrgId: 'org_aaaaaaaa', orgRole: 'org:admin', orgSlug: 'org-a' },
  'tok-noorg': { userId: 'user_bbb', sessionId: 'sess_b', clerkOrgId: null, orgRole: null, orgSlug: null },
};
const verify: AuthVerifier = async (req) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  return m ? (IDENTITIES[m[1]!] ?? null) : null;
};

/** Minimal fake: answers the organization upsert only (CRUD is covered against real PostgreSQL). */
const orgUpserts: unknown[][] = [];
const fakeDb: Queryable = {
  async query<R>(sql: string, params?: unknown[]) {
    if (sql.includes('INSERT INTO organizations')) {
      orgUpserts.push(params ?? []);
      return { rows: [{ id: '00000000-0000-4000-8000-00000000000a' }] as R[] };
    }
    throw new Error('unexpected query in unit test: ' + sql.slice(0, 40));
  },
};

const geocoder: GeocodingProvider = {
  id: 'geoapify_geocoding',
  suggest: vi.fn(async (q: string) =>
    q.includes('fail')
      ? { ok: false as const, error: 'access_required' as const }
      : {
          ok: true as const,
          fetchedAt: new Date().toISOString(),
          data: [{ label: 'Sveavägen 42, 111 35 Stockholm, Sverige', lat: 59.3367, lon: 18.0627, precision: 'building' as const, provider: 'geoapify' as const }],
        },
  ),
  resolve: vi.fn(),
};

describe('customer API authentication & tenancy guards', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp(loadServerEnv({ NODE_ENV: 'test' }), { logger: false, verifyAuth: verify, db: fakeDb, geocoder });
  });
  afterAll(() => app.close());

  it('rejects unauthenticated requests with 401', async () => {
    for (const url of ['/v1/me', '/v1/properties', '/v1/portfolio', '/v1/geocoding/suggestions?q=Svea']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
    }
    expect((await app.inject({ method: 'GET', url: '/v1/properties', headers: { authorization: 'Bearer forged' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/properties', payload: {} })).statusCode).toBe(401);
  });

  it('requires an active organization for tenant data (403, not an empty list)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/properties', headers: { authorization: 'Bearer tok-noorg' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ title: 'Organization required', type: 'urn:fastighetsradar:organization-required' });
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer tok-noorg' } });
    expect(me.json()).toEqual({ userId: 'user_bbb', organization: null });
  });

  it('derives the organization from verified claims only – client-supplied org ids are ignored', async () => {
    orgUpserts.length = 0;
    await app.inject({ method: 'GET', url: '/v1/geocoding/suggestions?q=Sveav%C3%A4gen&organizationId=org_EVIL1234', headers: { authorization: 'Bearer tok-a', 'x-organization-id': 'org_EVIL1234' } });
    expect(orgUpserts).toEqual([['org_aaaaaaaa', 'org-a']]);
  });

  it('proxies geocoding with attribution and degrades to geocoding_unavailable', async () => {
    const ok = await app.inject({ method: 'GET', url: '/v1/geocoding/suggestions?q=Sveav%C3%A4gen%2042', headers: { authorization: 'Bearer tok-a' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'ok', attribution: expect.stringContaining('Geoapify'), suggestions: [{ precision: 'building' }] });
    const down = await app.inject({ method: 'GET', url: '/v1/geocoding/suggestions?q=fail%20please', headers: { authorization: 'Bearer tok-a' } });
    expect(down.json()).toMatchObject({ status: 'geocoding_unavailable', suggestions: [] });
  });

  it('validates property ids and payloads before touching the database', async () => {
    const bad = await app.inject({ method: 'GET', url: '/v1/properties/not-a-uuid', headers: { authorization: 'Bearer tok-a' } });
    expect(bad.statusCode).toBe(400);
    const outside = await app.inject({
      method: 'POST',
      url: '/v1/properties',
      headers: { authorization: 'Bearer tok-a' },
      payload: { name: 'Berlin', address: 'Unter den Linden 1, Berlin', location: { lat: 52.52, lon: 13.4 }, geocode: { provider: 'manual_pin', precision: 'unknown' } },
    });
    expect(outside.statusCode).toBe(400);
    expect(JSON.stringify(outside.json())).toContain('Latitude outside Sweden');
  });

  it('returns 503 (not a crash) when Clerk is not configured', async () => {
    const noClerk = await buildApp(loadServerEnv({ NODE_ENV: 'test' }), { logger: false, verifyAuth: null, db: fakeDb });
    expect((await noClerk.inject({ method: 'GET', url: '/v1/properties' })).statusCode).toBe(503);
    await noClerk.close();
  });
});

describe('live portfolio builder', () => {
  it('never invents monitoring values for real properties', () => {
    const p = buildLivePortfolio({
      clerkOrgId: 'org_aaaaaaaa',
      orgSlug: 'org-a',
      sources: [],
      properties: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Sveavägen 42',
          address: 'Sveavägen 42, 111 35 Stockholm, Sverige',
          location: { lat: 59.3367, lon: 18.0627 },
          positionSource: 'geocoded',
          geocode: { provider: 'geoapify', precision: 'building', confidence: 1, label: null, placeId: null, resultType: 'building', postcode: '111 35', city: 'Stockholm', municipality: null, geocodedAt: null },
          status: 'profiling',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const s = p.properties[0]!;
    expect(p.origin).toBe('live');
    expect(s.property.status).toBe('unknown');
    expect(s.metrics).toEqual([]);
    expect(s.warnings).toEqual([]);
    expect(s.demoRisk).toBeNull();
    expect(s.forecast).toBeNull();
    expect(s.flood.mapped.exposureClass).toBe('unknown');
    expect(s.sms.enabled).toBe(false);
    expect(p.narrative).toBeNull();
    expect(p.demoTrends).toBeNull();
  });
});
