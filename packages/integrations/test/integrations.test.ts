import { describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import {
  MANIFEST_LIST,
  boverketAdapter,
  buildGeoapifyAutocompleteUrl,
  createSmsProvider,
  estimateSmsParts,
  geoapifyAdapter,
  redactGeoapifyUrl,
  resolveSourceStatuses,
  fetchTrafikverketNear,
  type AdapterContext,
} from '../src';

const ctx = (envVars: Record<string, string> = {}): AdapterContext => ({
  env: loadServerEnv(envVars),
  fetch: vi.fn(async () => {
    throw new Error('network must not be used in tests');
  }) as unknown as typeof fetch,
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  now: () => new Date('2026-11-12T12:00:00Z'),
});

describe('source manifest', () => {
  it('covers every planned source with display/alerts off until licence review', () => {
    const ids = MANIFEST_LIST.map((m) => m.id);
    for (const id of ['smhi_forecast', 'smhi_warnings', 'smhi_observations', 'krisinformation', 'air_quality', 'sgu_groundwater', 'mcf_flood', 'scb', 'trafikverket', 'geoapify_geocoding', 'lantmateriet_address', 'boverket_energy', 'sms_46elks'])
      expect(ids).toContain(id);
    MANIFEST_LIST.forEach((m) => {
      expect(m.commercialReuseReviewed).toBe(false);
      expect(m.displayPermitted).toBe(false);
      expect(m.alertsPermitted).toBe(false);
    });
  });
});

describe('resolveSourceStatuses', () => {
  it('never reports a source as ok without a real fetch', () => {
    const statuses = resolveSourceStatuses(loadServerEnv({ GEOAPIFY_API_KEY: 'k', TRAFIKVERKET_ENABLED: 'true', TRAFIKVERKET_API_KEY: 'k' }));
    statuses.forEach((s) => expect(s.status).not.toBe('ok'));
  });

  it('marks key-dependent sources pending_access and disabled sources disabled', () => {
    const byId = Object.fromEntries(resolveSourceStatuses(loadServerEnv({})).map((s) => [s.sourceId, s]));
    expect(byId.trafikverket!.status).toBe('disabled'); // flag off by default
    expect(byId.geoapify_geocoding!.status).toBe('pending_access');
    expect(byId.boverket_energy!.status).toBe('disabled');
    expect(byId.lantmateriet_address!.status).toBe('disabled');
    // Implemented + configured, but never 'ok' before a real collector run succeeds.
    expect(byId.smhi_forecast!.status).toBe('degraded');
    expect(byId.smhi_oceanography!.status).toBe('not_implemented');

    const tv = resolveSourceStatuses(loadServerEnv({ TRAFIKVERKET_ENABLED: 'true' })).find((s) => s.sourceId === 'trafikverket');
    expect(tv!.status).toBe('pending_access');
  });

  it('does not leak secrets into status notes', () => {
    const json = JSON.stringify(resolveSourceStatuses(loadServerEnv({ GEOAPIFY_API_KEY: 'super-secret-key' })));
    expect(json).not.toContain('super-secret-key');
  });
});

describe('gated adapters', () => {
  it('do not call the network without key/flag and report access_required / disabled', async () => {
    const c = ctx();
    expect(await fetchTrafikverketNear([{ lat: 59.3, lon: 18 }], c)).toMatchObject({ ok: false, error: 'access_required' });
    expect(await fetchTrafikverketNear([{ lat: 59.3, lon: 18 }], ctx({ TRAFIKVERKET_API_KEY: 'k' }))).toMatchObject({ ok: false, error: 'access_required' });
    expect(await boverketAdapter.getDeclaration('p')).toMatchObject({ ok: false, error: 'disabled' });
    expect(c.fetch).not.toHaveBeenCalled();
  });
});

describe('geoapify', () => {
  it('returns geocoding_unavailable (access_required) without a key', async () => {
    const r = await geoapifyAdapter.suggest('Sveavägen 42', ctx());
    expect(r).toMatchObject({ ok: false, error: 'access_required' });
  });
  it('rejects queries shorter than 3 characters', async () => {
    expect(await geoapifyAdapter.suggest('Sv', ctx({ GEOAPIFY_API_KEY: 'k' }))).toMatchObject({ error: 'invalid_payload' });
  });
  it('builds a Sweden-filtered autocomplete URL and redacts the key for logs', () => {
    const url = buildGeoapifyAutocompleteUrl(loadServerEnv({ GEOAPIFY_API_KEY: 'secret123' }), 'Sveavägen 42, Stockholm');
    expect(url.searchParams.get('filter')).toBe('countrycode:se');
    expect(url.searchParams.get('lang')).toBe('sv');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('format')).toBe('json');
    expect(redactGeoapifyUrl(url)).not.toContain('secret123');
  });
});

describe('SMS provider', () => {
  it('blocks every message when SMS is disabled (default)', async () => {
    const sms = createSmsProvider(loadServerEnv({}));
    expect(sms.mode).toBe('disabled');
    expect(await sms.send({ to: '+46700000000', message: 'test', dedupKey: 'a', organizationId: 'o' })).toMatchObject({ status: 'blocked' });
  });

  it('records dry-run messages without any network call and dedupes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const sms = createSmsProvider(loadServerEnv({ SMS_ENABLED: 'true' }));
    expect(sms.mode).toBe('dry_run');
    const msg = { to: '+46700000000', message: 'FastighetsRadar: test', dedupKey: 'k1', organizationId: 'o' };
    expect(await sms.send(msg)).toMatchObject({ status: 'dry_run', parts: 1 });
    expect(await sms.send(msg)).toMatchObject({ status: 'blocked', reason: 'duplicate dedupKey' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses to construct a live provider in this phase', () => {
    expect(() =>
      createSmsProvider(loadServerEnv({ SMS_ENABLED: 'true', SMS_DRY_RUN: 'false', SMS_LIVE_SENDING_APPROVED: 'true', NODE_ENV: 'production', ELKS_API_USERNAME: 'u', ELKS_API_PASSWORD: 'p' })),
    ).toThrow(/not implemented/);
  });

  it('estimates SMS parts for GSM-7 and UCS-2', () => {
    expect(estimateSmsParts('a'.repeat(160))).toBe(1);
    expect(estimateSmsParts('a'.repeat(161))).toBe(2);
    expect(estimateSmsParts('€'.repeat(70) + '😀')).toBe(2);
  });
});
