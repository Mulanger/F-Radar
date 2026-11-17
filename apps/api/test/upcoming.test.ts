import { describe, expect, it } from 'vitest';
import Fastify, { type preHandlerHookHandler } from 'fastify';
import type { Queryable } from '@fastighetsradar/db';
import { registerErrorHandling } from '../src/errors';
import { registerUpcomingRoutes } from '../src/routes/upcoming';

/** In-memory stand-in for upcoming_acknowledgements, keyed per organization. */
function fakeDb() {
  const rows = new Map<string, { org: string; key: string; by: string; at: Date }>();
  const db: Queryable = {
    async query<R>(sql: string, params: unknown[] = []) {
      const [org, key, by] = params as string[];
      if (sql.startsWith('SELECT')) return { rows: [...rows.values()].filter((r) => r.org === org).map((r) => ({ item_key: r.key, acknowledged_at: r.at })) as R[] };
      if (sql.startsWith('INSERT')) {
        const id = `${org}|${key}`;
        if (!rows.has(id)) rows.set(id, { org: org!, key: key!, by: by!, at: new Date('2026-11-17T08:00:00Z') });
        return { rows: [{ acknowledged_at: rows.get(id)!.at }] as R[] };
      }
      if (sql.startsWith('DELETE') && key !== undefined) rows.delete(`${org}|${key}`);
      return { rows: [] as R[] };
    },
  };
  return { db, rows };
}

async function app(db: Queryable, org = 'org-a', userId = 'user_a') {
  const a = Fastify({ logger: false });
  a.decorateRequest('auth', null);
  registerErrorHandling(a);
  const requireOrg: preHandlerHookHandler = async (req) => {
    req.auth = { userId, sessionId: 's', clerkOrgId: 'org_clerk', orgRole: 'org:member', orgSlug: 'x', organizationId: org };
  };
  registerUpcomingRoutes(a, { db, requireOrg });
  await a.ready();
  return a;
}

describe('upcoming acknowledgements', () => {
  it('acknowledges, lists and un-acknowledges per organization', async () => {
    const { db, rows } = fakeDb();
    const a = await app(db);
    const key = 'frost-1b4e28ba-2fa1-11d2-883f-0016d3cca427@2026-11-17';
    const post = await a.inject({ method: 'POST', url: '/v1/upcoming/acknowledgements', payload: { key, acknowledged: true } });
    expect(post.statusCode).toBe(200);
    expect(post.json()).toEqual({ key, at: '2026-11-17T08:00:00.000Z' });
    expect([...rows.values()][0]).toMatchObject({ org: 'org-a', by: 'user_a' });

    const list = await a.inject({ method: 'GET', url: '/v1/upcoming/acknowledgements' });
    expect(list.json()).toEqual({ acknowledgements: [{ key, at: '2026-11-17T08:00:00.000Z' }] });

    // Another organization never sees it.
    const other = await app(db, 'org-b');
    expect((await other.inject({ method: 'GET', url: '/v1/upcoming/acknowledgements' })).json()).toEqual({ acknowledgements: [] });

    const undo = await a.inject({ method: 'POST', url: '/v1/upcoming/acknowledgements', payload: { key, acknowledged: false } });
    expect(undo.json()).toEqual({ key, at: null });
    expect(rows.size).toBe(0);
  });

  it('rejects malformed keys', async () => {
    const a = await app(fakeDb().db);
    for (const key of ['', 'has space', 'x'.repeat(201)]) {
      const res = await a.inject({ method: 'POST', url: '/v1/upcoming/acknowledgements', payload: { key, acknowledged: true } });
      expect(res.statusCode).toBe(400);
    }
  });
});
