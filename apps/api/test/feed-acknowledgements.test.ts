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
  const reads = new Set<string>();
  const calls: string[] = [];
  const db: Queryable = {
    async query<R>(sql: string, params: unknown[] = []) {
      calls.push(sql);
      const [org, id, by] = params as string[];
      if (sql.includes('INSERT INTO feed_update_reads')) {
        for (const changeId of Array.isArray(id) ? id as string[] : [id!]) {
          if (changes.get(changeId) === org) reads.add(`${org}:${changeId}:${by}`);
        }
        return { rows: [] as R[] };
      }
      if (sql.trimStart().startsWith('INSERT') && Array.isArray(id)) {
        // Batch: INSERT … WHERE organization_id = $1 AND id = ANY($2) RETURNING change_id, acknowledged_at
        const own = (id as string[]).filter((x) => changes.get(x) === org);
        for (const x of own) if (!acks.has(x)) acks.set(x, { org: org!, by: by!, at: new Date('2026-11-18T08:00:00Z') });
        return { rows: own.map((x) => ({ change_id: x, acknowledged_at: acks.get(x)!.at })) as R[] };
      }
      if (sql.includes('DELETE FROM feed_acknowledgements') && Array.isArray(id)) {
        const removed = (id as string[]).filter((x) => changes.get(x) === org && acks.delete(x));
        return { rows: removed.map((x) => ({ change_id: x })) as R[] };
      }
      if (sql.trimStart().startsWith('INSERT')) {
        // INSERT … SELECT FROM monitoring_changes WHERE id = $2 AND organization_id = $1
        if (changes.get(id!) !== org) return { rows: [] as R[] };
        if (!acks.has(id!)) acks.set(id!, { org: org!, by: by!, at: new Date('2026-11-18T08:00:00Z') });
        return { rows: [{ acknowledged_at: acks.get(id!)!.at }] as R[] };
      }
      if (sql.includes('DELETE FROM feed_acknowledgements') && changes.get(id!) === org) acks.delete(id!);
      return { rows: [] as R[] };
    },
  };
  return { db, acks, reads, calls };
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
  it('saves only the displayed alarm ids for the authenticated viewer, with no acknowledgements', async () => {
    const { db, reads, acks } = fakeDb();
    const a = await app(db);
    const request = { method: 'POST' as const, url: '/v1/feed/alarm-reads', payload: { changeIds: ['chg-7', 'chg-8'] } };
    expect((await a.inject(request)).statusCode).toBe(204);
    expect((await a.inject(request)).statusCode).toBe(204);
    expect([...reads]).toEqual(['org-a:7:user_a']);
    expect(acks.size).toBe(0);
    expect((await a.inject({ ...request, payload: { changeIds: [] } })).statusCode).toBe(400);
    expect((await a.inject({ ...request, payload: { changeIds: ['invalid'] } })).statusCode).toBe(400);
  });

  it('records each read for the authenticated person and leaves the organization acknowledgement alone', async () => {
    const { db, reads, acks, calls } = fakeDb();
    const a = await app(db);
    const b = await app(db, 'org-a', 'user_b');
    const request = { method: 'POST' as const, url: '/v1/feed/reads', payload: { changeId: 'chg-7', userId: 'ignored' } };
    expect((await a.inject(request)).statusCode).toBe(204);
    expect((await a.inject(request)).statusCode).toBe(204);
    expect([...reads]).toEqual(['org-a:7:user_a']);
    expect((await b.inject(request)).statusCode).toBe(204);
    expect((await b.inject({ ...request, payload: { changeId: 'chg-8', userId: 'ignored' } })).statusCode).toBe(204);
    expect([...reads]).toEqual(['org-a:7:user_a', 'org-a:7:user_b']);
    expect(acks.size).toBe(0);
    expect(calls[0]).toContain('c.organization_id = $1');
  });

  it('acknowledges all rows of an event in one call, only the own organization’s, with one rate-limit token (Fas 2 / S-05)', async () => {
    const { db, acks } = fakeDb();
    const a = await app(db);
    const batch = (changeIds: string[], acknowledged = true) => a.inject({ method: 'POST', url: '/v1/feed/acknowledgements/batch', payload: { changeIds, acknowledged } });
    const r = await batch(['chg-7', 'chg-8', '7']);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ changes: [{ changeId: 'chg-7', at: '2026-11-18T08:00:00.000Z' }] });
    expect([...acks.keys()]).toEqual(['7']);
    expect((await batch(['chg-8'])).statusCode).toBe(404);
    expect((await batch([])).statusCode).toBe(400);
    expect((await batch(Array.from({ length: 1_001 }, (_, i) => `chg-${i + 1}`))).statusCode).toBe(400);
    expect((await batch(['not-an-id'])).statusCode).toBe(400);
    const undo = await batch(['chg-7', 'chg-8'], false);
    expect(undo.json()).toEqual({ changes: [{ changeId: 'chg-7', at: null }] });
    expect(acks.size).toBe(0);
  });

  it('exports the whole selection in one call, with the organization and filters from the request (Fas 2 / S-08)', async () => {
    const { db, calls } = fakeDb();
    const a = await app(db);
    const r = await a.inject({ method: 'GET', url: '/v1/feed/acknowledgements/export?from=2026-11-01&to=2026-11-30' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ entries: [], truncated: false });
    expect(calls.at(-1)).toContain('LIMIT $5');
    expect((await a.inject({ method: 'GET', url: '/v1/feed/acknowledgements/export?from=2026-12-01&to=2026-11-01' })).statusCode).toBe(400);
    expect((await a.inject({ method: 'GET', url: '/v1/feed/acknowledgements/export?property=nope' })).statusCode).toBe(400);
  });

  it('counts a batch of 1000 rows as one change for the rate limit', async () => {
    const { db } = fakeDb();
    const a = await app(db);
    const ids = Array.from({ length: 1_000 }, (_, i) => `chg-${i + 1}`);
    let ok = 0;
    for (let i = 0; i < 60; i++) if ((await a.inject({ method: 'POST', url: '/v1/feed/acknowledgements/batch', payload: { changeIds: ids, acknowledged: true } })).statusCode !== 429) ok++;
    expect(ok).toBe(60);
    expect((await a.inject({ method: 'POST', url: '/v1/feed/acknowledgements/batch', payload: { changeIds: ids, acknowledged: true } })).statusCode).toBe(429);
  });

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
    expect(calls[0]).toContain('c.organization_id = $1');
    expect(calls[1]).toContain('a.organization_id = $1');
  });

  it('rejects malformed row ids', async () => {
    const a = await app(fakeDb().db);
    for (const changeId of ['', 'chg-', 'abc', 'chg-1;drop', '1'.repeat(19)]) {
      const res = await a.inject({ method: 'POST', url: '/v1/feed/acknowledgements', payload: { changeId, acknowledged: true } });
      expect(res.statusCode).toBe(400);
    }
  });

  it('uses only the active organization and keeps account identifiers out of the history response', async () => {
    const property = '33333333-3333-4333-8333-333333333333';
    const at = new Date('2026-11-18T08:00:00Z');
    const db: Queryable = {
      async query<R>(sql: string, params: unknown[] = []) {
        expect(params[0]).toBe('org-a');
        if (sql.includes('SELECT h.id')) {
          expect(params.slice(1, 5)).toEqual(['2026-11-18', '2026-11-19', property, null]);
          return { rows: [{
            id: '12', property_id: property, property_name: 'Strandhuset', property_address: 'Åvägen 2',
            source_id: 'smhi_warnings', operator_name: null, title: 'Snövarning', description: 'Hela texten',
            area: 'Stockholm', severity: 'warning', event_at: at, acknowledged_at: at,
            acknowledged_by: 'user_a', undone_at: at, undone_by: 'user_b', imported: false, is_update: true,
          }] as R[] };
        }
        return { rows: [{ id: property, name: 'Strandhuset', address: 'Åvägen 2' }] as R[] };
      },
    };
    const a = await app(db);
    const res = await a.inject(`/v1/feed/acknowledgements?from=2026-11-18&to=2026-11-19&property=${property}&organizationId=org-b`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      entries: [{ description: 'Hela texten', source: 'SMHI', acknowledgedAt: at.toISOString(), undoneAt: at.toISOString(), isUpdate: true }],
      properties: [{ id: property }],
      nextCursor: null,
    });
    expect(res.body).not.toMatch(/user_[ab]|acknowledgedBy|undoneBy/);
    expect((await a.inject('/v1/feed/acknowledgements?from=2026-11-19&to=2026-11-18')).statusCode).toBe(400);
    expect((await a.inject('/v1/feed/acknowledgements?property=other-org')).statusCode).toBe(400);
  });

  it('undoes by archived id with the authenticated actor and validates the id', async () => {
    const undoneAt = new Date('2026-11-20T10:15:00Z');
    let calls = 0;
    const a = await app({
      async query<R>(sql: string, params: unknown[] = []) {
        calls++;
        expect(params).toEqual(['org-a', '12', 'user_a']);
        expect(sql).toContain('h.organization_id = $1 AND h.id = $2::bigint');
        expect(sql).toContain('a.acknowledged_at = h.acknowledged_at');
        return { rows: [{ undone_at: undoneAt }] as R[] };
      },
    });
    const undo = await a.inject({ method: 'POST', url: '/v1/feed/acknowledgements/12/undo?organizationId=org-b' });
    expect(undo.statusCode).toBe(200);
    expect(undo.json()).toEqual({ id: '12', undoneAt: undoneAt.toISOString() });
    expect((await a.inject({ method: 'POST', url: '/v1/feed/acknowledgements/chg-12/undo' })).statusCode).toBe(400);
    expect(calls).toBe(1);
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
    const [open, done, info, superseded] = buildFeed([
      { ...base, id: '1', change_type: 'updated', acknowledged_at: null },
      { ...base, id: '2', acknowledged_at: new Date('2026-11-18T07:30:00Z') },
      { ...base, id: '3', source_id: 'trafikverket', severity: 'warning' },
      { ...base, id: '4', change_type: 'updated', superseded: true },
    ], new Set([PID]));
    expect(open).toMatchObject({ acknowledgementUpdate: true, ackRequired: true, acknowledgedAt: null });
    expect(done).toMatchObject({ ackRequired: true, acknowledgedAt: '2026-11-18T07:30:00.000Z' });
    expect(info).not.toHaveProperty('ackRequired');
    expect(superseded).toMatchObject({ acknowledgementUpdate: true });
    expect(superseded).not.toHaveProperty('ackRequired');
  });

  it('identifies the same source revision across property matches made at different times', () => {
    const base = { event_id: 'event-1', source_id: 'utility_outages', change_type: 'new', severity: 'warning', headline: 'Strömavbrott' };
    const rows = buildFeed([
      { ...base, id: '1', property_id: 'p1', dedup_key: 'p1:event-1:v2:inside', created_at: new Date('2026-11-20T10:00:00Z') },
      { ...base, id: '2', property_id: 'p2', dedup_key: 'p2:event-1:v2:inside', created_at: new Date('2026-11-20T10:05:00Z') },
      { ...base, id: '3', property_id: 'p2', dedup_key: 'p2:event-1:v3:inside', created_at: new Date('2026-11-20T10:05:00Z') },
      { ...base, id: '4', property_id: 'p2', dedup_key: 'p2:event-1:v2:gone', created_at: new Date('2026-11-20T10:05:00Z'), change_type: 'ended' },
    ], new Set(['p1', 'p2']));
    const groups = new Map(rows.map((item) => [item.id, item.eventGroupId]));
    expect(groups.get('chg-1')).toBeTruthy();
    expect(groups.get('chg-1')).toBe(groups.get('chg-2'));
    expect(groups.get('chg-1')).not.toBe(groups.get('chg-3'));
    expect(groups.get('chg-1')).not.toBe(groups.get('chg-4'));
  });
});
