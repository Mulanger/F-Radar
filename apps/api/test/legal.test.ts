import { describe, expect, it } from 'vitest';
import Fastify, { type preHandlerHookHandler } from 'fastify';
import { currentSignupConsent, LEGAL_VERSIONS, signupLegalConsent } from '@fastighetsradar/domain';
import type { Queryable } from '@fastighetsradar/db';
import { registerErrorHandling } from '../src/errors';
import { acceptanceTime, registerLegalRoutes } from '../src/routes/legal';

const ORG = '00000000-0000-4000-8000-00000000000b';
const NOW = new Date('2026-11-21T12:00:00Z');

interface OrgRow {
  terms_version: string | null;
  terms_accepted_at: Date | null;
  privacy_version: string | null;
  privacy_accepted_at: Date | null;
  legal_accepted_by_user_id: string | null;
}

/** In-memory organizations row with the acceptance columns. */
function fakeDb(initial: Partial<OrgRow> = {}) {
  const row: OrgRow = { terms_version: null, terms_accepted_at: null, privacy_version: null, privacy_accepted_at: null, legal_accepted_by_user_id: null, ...initial };
  const db: Queryable = {
    async query<R>(sql: string, params: unknown[] = []) {
      if (sql.startsWith('SELECT terms_version')) return { rows: [{ ...row }] as R[] };
      if (sql.includes('UPDATE organizations')) {
        const [, terms, privacy, at, user] = params as [string, string, string, Date, string];
        if (row.terms_version === terms && row.privacy_version === privacy) return { rows: [] as R[] };
        Object.assign(row, { terms_version: terms, terms_accepted_at: at, privacy_version: privacy, privacy_accepted_at: at, legal_accepted_by_user_id: user });
        return { rows: [{ ...row }] as R[] };
      }
      return { rows: [] as R[] };
    },
  };
  return { db, row };
}

async function app(db: Queryable, role: string | null = 'org:admin', userId = 'user_admin1') {
  const a = Fastify({ logger: false });
  a.decorateRequest('auth', null);
  registerErrorHandling(a);
  const requireOrg: preHandlerHookHandler = async (req) => {
    req.auth = { userId, sessionId: 's', clerkOrgId: 'org_clerk', orgRole: role, orgSlug: 'x', organizationId: ORG };
  };
  registerLegalRoutes(a, { db, requireOrg, now: () => NOW });
  await a.ready();
  return a;
}

const body = (extra: Record<string, unknown> = {}) => ({ termsVersion: LEGAL_VERSIONS.terms, privacyVersion: LEGAL_VERSIONS.privacy, ...extra });

describe('terms acceptance per organization', () => {
  it('reports that a new organization has not accepted, and who may accept', async () => {
    const { db } = fakeDb();
    expect((await (await app(db)).inject({ method: 'GET', url: '/v1/legal/acceptance' })).json()).toMatchObject({ current: false, canAccept: true, termsVersion: null });
    expect((await (await app(db, 'org:member')).inject({ method: 'GET', url: '/v1/legal/acceptance' })).json()).toMatchObject({ current: false, canAccept: false });
  });

  it('stores version, time and user when an administrator accepts – using the sign-up time', async () => {
    const { db, row } = fakeDb();
    const signedUp = '2026-11-21T11:58:00.000Z';
    const res = await (await app(db)).inject({ method: 'POST', url: '/v1/legal/acceptance', payload: body({ acceptedAt: signedUp }) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      current: true, termsVersion: LEGAL_VERSIONS.terms, privacyVersion: LEGAL_VERSIONS.privacy,
      termsAcceptedAt: signedUp, privacyAcceptedAt: signedUp, acceptedByUserId: 'user_admin1',
    });
    expect(row.legal_accepted_by_user_id).toBe('user_admin1');
  });

  it('keeps the first acceptance of the same version', async () => {
    const first = new Date('2026-11-21T10:00:00Z');
    const { db } = fakeDb({ terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy, terms_accepted_at: first, privacy_accepted_at: first, legal_accepted_by_user_id: 'user_first1' });
    const res = await (await app(db, 'org:admin', 'user_other1')).inject({ method: 'POST', url: '/v1/legal/acceptance', payload: body() });
    expect(res.json()).toMatchObject({ acceptedByUserId: 'user_first1', termsAcceptedAt: first.toISOString() });
  });

  it('refuses members, outdated versions and malformed input', async () => {
    const { db, row } = fakeDb();
    expect((await (await app(db, 'org:member')).inject({ method: 'POST', url: '/v1/legal/acceptance', payload: body() })).statusCode).toBe(403);
    const admin = await app(db);
    expect((await admin.inject({ method: 'POST', url: '/v1/legal/acceptance', payload: body({ termsVersion: '2025-01-01' }) })).statusCode).toBe(400);
    expect((await admin.inject({ method: 'POST', url: '/v1/legal/acceptance', payload: body({ acceptedAt: 'igår' }) })).statusCode).toBe(400);
    expect(row.terms_version).toBeNull();
  });

  it('uses a claimed sign-up time only when it is plausible', () => {
    expect(acceptanceTime(undefined, NOW)).toEqual(NOW);
    expect(acceptanceTime('2026-11-20T12:00:00Z', NOW)).toEqual(new Date('2026-11-20T12:00:00Z'));
    expect(acceptanceTime('2026-11-22T12:00:00Z', NOW)).toEqual(NOW); // future
    expect(acceptanceTime('2026-09-01T12:00:00Z', NOW)).toEqual(NOW); // older than 30 days
  });
});

describe('sign-up consent metadata', () => {
  it('round-trips the current versions and ignores older ones', () => {
    const consent = signupLegalConsent(NOW);
    expect(currentSignupConsent({ legal: consent })).toBe(NOW.toISOString());
    expect(currentSignupConsent({ legal: { ...consent, termsVersion: '2025-01-01' } })).toBeNull();
    expect(currentSignupConsent({})).toBeNull();
    expect(currentSignupConsent(null)).toBeNull();
  });
});
