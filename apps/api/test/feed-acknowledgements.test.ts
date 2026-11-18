import { describe, expect, it } from 'vitest';
import Fastify, { type preHandlerHookHandler } from 'fastify';
import { feedNeedsAck } from '@fastighetsradar/domain';
import type { Queryable } from '@fastighetsradar/db';
import { registerErrorHandling } from '../src/errors';
import { registerFeedAcknowledgementRoutes } from '../src/routes/feed-acknowledgements';
import { buildFeed } from '../src/monitoring/snapshot';

/** In-memory stand-in: feed rows per organization and their acknowledgements. */
function fakeDb() {
  const changes = new Map([['7', 'org-a'], ['8', 'org-b']]);
  const acks = new Map<string, { org: string; by: string; at: Date }>();
  const calls: string[] = [];
  const db: Queryable = {
    async query<R>(sql: string, params: unknown[] = []) {
      calls.push(sql);
      const [org, id, by] = params as string[];
      if (sql.trimStart().startsWith('INSERT')) {
        // INSERT … SELECT FROM monitoring_changes WHERE id = $2 AND organization_id = $1
        if (changes.get(id!) !== org) return { rows: [] as R[] };
        if (!acks.has(id!)) acks.set(id!, { org: org!, by: by!, at: new Date('2026-11-18T08:00:00Z') });
        return { rows: [{ acknowledged_at: acks.get(id!)!.at }] as R[] };
      }
      if (sql.trimStart().startsWith('DELETE') && changes.get(id!) === org) acks.delete(id!);
      return { rows: [] as R[] };
    },
  };
  return { db, acks, calls };
}

async function app(db: Queryable, org = 'org-a', userId = 'user_a') {
  const a = Fastify({ logger: false });
  a.decorateRequest('auth', null);
  registerErrorHandling(a);
  const requireOrg: preHandlerHookHandler = async (req) => {
    req.auth = { userId, sessionId: 's', clerkOrgId: 'org_clerk', orgRole: 'org:member', orgSlug: 'x', organizationId: org };
  };
  registerFeedAcknowledgementRoutes(a, { db, requireOrg });
  await a.ready();
  return a;
}

describe('feed acknowledgements (kvittering i händelseflödet)', () => {
  it('acknowledges and undoes a feed row of the own organization', async () => {
    const { db, acks } = fakeDb();
    const a = await app(db);
    const post = await a.inject({ method: 'POST', url: '/v1/feed/acknowledgements', payload: { changeId: 'chg-7', acknowledged: true } });
    expect(post.statusCode).toBe(200);
    expect(post.json()).toEqual({ changeId: 'chg-7', at: '2026-11-18T08:00:00.000Z' });
    expect(acks.get('7')).toMatchObject({ org: 'org-a', by: 'user_a' });

    const undo = await a.inject({ method: 'POST', url: '/v1/feed/acknowledgements', payload: { changeId: 'chg-7', acknowledged: false } });
    expect(undo.json()).toEqual({ changeId: 'chg-7', at: null });
    expect(acks.size).toBe(0);
  });

  it('never acknowledges another organization’s row', async () => {
    const { db, acks } = fakeDb();
    const a = await app(db);
    const res = await a.inject({ method: 'POST', url: '/v1/feed/acknowledgements', payload: { changeId: 'chg-8', acknowledged: true } });
    expect(res.statusCode).toBe(404);
    expect(acks.size).toBe(0);
  });

  it('scopes every statement to the organization', async () => {
    const { db, calls } = fakeDb();
    const a = await app(db);
    await a.inject({ method: 'POST', url: '/v1/feed/acknowledgements', payload: { changeId: '7', acknowledged: true } });
    await a.inject({ method: 'POST', url: '/v1/feed/acknowledgements', payload: { changeId: '7', acknowledged: false } });
    expect(calls).toHaveLength(2);
    for (const sql of calls) expect(sql).toMatch(/c\.organization_id = \$1/);
  });

  it('rejects malformed row ids', async () => {
    const a = await app(fakeDb().db);
    for (const changeId of ['', 'chg-', 'abc', 'chg-1;drop', '1'.repeat(19)]) {
      const res = await a.inject({ method: 'POST', url: '/v1/feed/acknowledgements', payload: { changeId, acknowledged: true } });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('which feed rows must be acknowledged', () => {
  const row = (x: Partial<Parameters<typeof feedNeedsAck>[0]>) => feedNeedsAck({ sourceId: 'smhi_warnings', changeType: 'new', severity: 'monitor', eventActive: true, ...x });

  it('official warnings yellow and up, VMA/critical and outages – while they go on', () => {
    expect(row({})).toBe(true); // yellow SMHI warning
    expect(row({ severity: 'warning' })).toBe(true); // orange
    expect(row({ severity: 'critical', sourceId: 'krisinformation' })).toBe(true); // VMA
    expect(row({ sourceId: 'utility_outages' })).toBe(true);
    expect(row({ changeType: 'updated', severity: 'critical' })).toBe(true);
  });

  it('not ordinary traffic, information, ended rows or superseded rows', () => {
    expect(row({ sourceId: 'trafikverket', severity: 'warning' })).toBe(false);
    expect(row({ sourceId: 'krisinformation', severity: 'info' })).toBe(false);
    expect(row({ severity: 'info' })).toBe(false); // SMHI message, not a warning
    expect(row({ changeType: 'ended' })).toBe(false);
    expect(row({ changeType: 'cancelled', severity: 'critical' })).toBe(false);
    expect(row({ eventActive: false })).toBe(false);
    expect(row({ superseded: true })).toBe(false);
  });

  it('puts the flag and the acknowledgement time on the feed item', () => {
    const NOW = new Date('2026-11-18T07:00:00Z');
    const PID = 'p1';
    const base = { property_id: PID, source_id: 'smhi_warnings', change_type: 'new', severity: 'monitor', headline: 'Gul varning: vind', created_at: NOW, event_active: true, superseded: false };
    const [open, done, info] = buildFeed([
      { ...base, id: '1', acknowledged_at: null },
      { ...base, id: '2', acknowledged_at: new Date('2026-11-18T07:30:00Z') },
      { ...base, id: '3', source_id: 'trafikverket', severity: 'warning' },
    ], new Set([PID]));
    expect(open).toMatchObject({ ackRequired: true, acknowledgedAt: null });
    expect(done).toMatchObject({ ackRequired: true, acknowledgedAt: '2026-11-18T07:30:00.000Z' });
    expect(info).not.toHaveProperty('ackRequired');
  });
});
