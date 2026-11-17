import { describe, expect, it } from 'vitest';
import Fastify, { type preHandlerHookHandler } from 'fastify';
import { TRAFFIC_RADIUS, TrafficRadiusSchema, formatTrafficRadius } from '@fastighetsradar/domain';
import { saveTrafficRadius, type Queryable } from '@fastighetsradar/db';
import { buildTrafikverketQuery } from '@fastighetsradar/integrations';
import { registerErrorHandling } from '../src/errors';
import { registerSettingsRoutes } from '../src/routes/settings';
import { trafikverketQueryPoints } from '../src/monitoring/jobs';

const ORG = '00000000-0000-4000-8000-00000000000a';

/** In-memory organizations.traffic_radius_m; records every statement. */
function fakeDb(initial: number = TRAFFIC_RADIUS.default) {
  let radius = initial;
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: Queryable = {
    async query<R>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT traffic_radius_m')) return { rows: [{ traffic_radius_m: radius }] as R[] };
      if (sql.includes('UPDATE organizations SET traffic_radius_m')) {
        radius = params[1] as number;
        return { rows: [{ removed: '3', added: '0', updated: '1' }] as R[] };
      }
      return { rows: [] as R[] };
    },
  };
  return { db, calls, radius: () => radius };
}

async function app(db: Queryable, role: string | null = 'org:admin') {
  const a = Fastify({ logger: false });
  a.decorateRequest('auth', null);
  registerErrorHandling(a);
  const requireOrg: preHandlerHookHandler = async (req) => {
    req.auth = { userId: 'user_a', sessionId: 's', clerkOrgId: 'org_clerk', orgRole: role, orgSlug: 'x', organizationId: ORG };
  };
  registerSettingsRoutes(a, { db, requireOrg });
  await a.ready();
  return a;
}

describe('Trafikverket distance (Inställningar)', () => {
  it('is 100–3000 m in steps of 100 m, 500 m by default', () => {
    expect(TRAFFIC_RADIUS).toMatchObject({ min: 100, max: 3000, step: 100, default: 500 });
    expect(TrafficRadiusSchema.safeParse(100).success).toBe(true);
    expect(TrafficRadiusSchema.safeParse(3000).success).toBe(true);
    expect(TrafficRadiusSchema.safeParse(50).success).toBe(false);
    expect(TrafficRadiusSchema.safeParse(3100).success).toBe(false);
    expect(TrafficRadiusSchema.safeParse(550).success).toBe(false);
    expect([500, 1000, 1500, 3000].map(formatTrafficRadius)).toEqual(['500 m', '1 km', '1,5 km', '3 km']);
  });

  it('any member reads it; only admins change it, with validation', async () => {
    const { db, radius } = fakeDb();
    const member = await app(db, 'org:member');
    expect((await member.inject({ method: 'GET', url: '/v1/settings' })).json()).toEqual({ trafficRadiusM: 500, canEdit: false });
    expect((await member.inject({ method: 'PATCH', url: '/v1/settings', payload: { trafficRadiusM: 1500 } })).statusCode).toBe(403);
    expect(radius()).toBe(500);

    const admin = await app(db);
    expect((await admin.inject({ method: 'GET', url: '/v1/settings' })).json()).toEqual({ trafficRadiusM: 500, canEdit: true });
    expect((await admin.inject({ method: 'PATCH', url: '/v1/settings', payload: { trafficRadiusM: 5000 } })).statusCode).toBe(400);
    expect((await admin.inject({ method: 'PATCH', url: '/v1/settings', payload: { trafficRadiusM: 'far' } })).statusCode).toBe(400);
    const ok = await admin.inject({ method: 'PATCH', url: '/v1/settings', payload: { trafficRadiusM: 1500 } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ trafficRadiusM: 1500, canEdit: true });
  });

  it('saving re-matches the organization’s traffic events silently (no feed rows)', async () => {
    const { db, calls } = fakeDb();
    expect(await saveTrafficRadius(db, ORG, 300)).toEqual({ removed: 3, added: 0 });
    const sql = calls[0]!.sql;
    expect(calls[0]!.params).toEqual([ORG, 300]);
    expect(sql).toContain('m.organization_id = $1');
    expect(sql).toContain('p.organization_id = $1');
    expect(sql).toContain("e.source_id IN ('trafikverket', 'sl_deviations')");
    expect(sql).not.toContain('monitoring_changes');
  });

  it('fetches each shared query point far enough for every property in it', () => {
    const pts = trafikverketQueryPoints([
      { lat: 59.3, lon: 18.0, trafficRadiusM: 500 },
      { lat: 59.301, lon: 18.002, trafficRadiusM: 3000 }, // same ~1 km cell, ~160 m away
      { lat: 57.7, lon: 11.9, trafficRadiusM: 100 },
    ]);
    expect(pts).toHaveLength(2);
    expect(pts[0]!.radiusM).toBeGreaterThanOrEqual(3000 + 200 + 150);
    expect(pts[0]!.radiusM).toBeLessThan(3000 + 200 + 200);
    expect(pts[1]!.radiusM).toBe(300);
    const q = buildTrafikverketQuery('k', pts);
    expect(q).toContain('radius="300m"');
    expect(q).toMatch(/radius="33\d\dm"/);
  });
});
