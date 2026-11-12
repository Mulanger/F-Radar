import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { __resetGeoapifyState, geoapifyAdapter, mapGeoapifyResult, normalizeAddressQuery, type AdapterContext } from '../src';

/** Synthetic fixture shaped like a Geoapify `format=json` response (no real customer data). */
const FIXTURE = {
  results: [
    {
      country_code: 'se', street: 'Sveavägen', housenumber: '42', postcode: '111 35', city: 'Stockholm', county: 'Stockholms län',
      lon: 18.0627049, lat: 59.3367656, result_type: 'building', formatted: 'Sveavägen 42, 111 35 Stockholm, Sverige',
      place_id: 'abc', rank: { confidence: 1, confidence_building_level: 1 },
    },
    { country_code: 'se', street: 'Sveavägen', city: 'Stockholm', lon: 18.06, lat: 59.34, result_type: 'street', formatted: 'Sveavägen, Stockholm', rank: { confidence: 0.7 } },
    { country_code: 'no', city: 'Oslo', lon: 10.75, lat: 59.91, result_type: 'city', formatted: 'Oslo, Norge' },
    { lat: 'broken' },
  ],
};

function ctx(fetchImpl: typeof fetch, env: Record<string, string> = { GEOAPIFY_API_KEY: 'test-key' }): AdapterContext {
  return { env: loadServerEnv(env), fetch: fetchImpl, logger: { debug() {}, info() {}, warn() {}, error() {} }, now: () => new Date('2026-11-12T12:00:00Z') };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

describe('geoapify adapter (contract, no network)', () => {
  beforeEach(() => __resetGeoapifyState());

  it('maps results, keeps only Swedish ones and classifies precision', async () => {
    const f = vi.fn(async () => json(FIXTURE));
    const r = await geoapifyAdapter.suggest('Sveavägen 42', ctx(f as unknown as typeof fetch));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map((s) => [s.label, s.precision])).toEqual([
      ['Sveavägen 42, 111 35 Stockholm, Sverige', 'building'],
      ['Sveavägen, Stockholm', 'street'],
    ]);
    const url = new URL(String((f.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get('filter')).toBe('countrycode:se');
  });

  it('caches identical queries (no repeated credits)', async () => {
    const f = vi.fn(async () => json(FIXTURE));
    await geoapifyAdapter.suggest('Sveavägen 42', ctx(f as unknown as typeof fetch));
    await geoapifyAdapter.suggest('  sveavägen   42 ', ctx(f as unknown as typeof fetch));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('retries once on 5xx and reports upstream_error after that', async () => {
    const f = vi.fn(async () => json({}, 503));
    const r = await geoapifyAdapter.suggest('Kungsgatan 1', ctx(f as unknown as typeof fetch));
    expect(f).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ ok: false, error: 'upstream_error' });
  });

  it('honours 429 with one retry, then rate_limited', async () => {
    const f = vi.fn(async () => json({}, 429, { 'retry-after': '0' }));
    const r = await geoapifyAdapter.suggest('Drottninggatan 5', ctx(f as unknown as typeof fetch));
    expect(f).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ ok: false, error: 'rate_limited' });
  });

  it('reports unauthorized keys without retrying', async () => {
    const f = vi.fn(async () => json({}, 401));
    expect(await geoapifyAdapter.suggest('Storgatan 1', ctx(f as unknown as typeof fetch))).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('propagates caller cancellation (aborted keystrokes)', async () => {
    const ac = new AbortController();
    const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
      ac.abort();
      throw init?.signal?.reason ?? new Error('aborted');
    });
    await expect(geoapifyAdapter.suggest('Vasagatan 10', { ...ctx(f as unknown as typeof fetch), signal: ac.signal })).rejects.toBeDefined();
  });

  it('flags invalid payloads instead of crashing', async () => {
    const f = vi.fn(async () => json({ results: 'nope' }));
    expect(await geoapifyAdapter.suggest('Odengatan 1', ctx(f as unknown as typeof fetch))).toMatchObject({ ok: false, error: 'invalid_payload' });
  });

  it('normalises queries and drops unusable results', () => {
    expect(normalizeAddressQuery('  Svea\u0007vägen\n 42 ')).toBe('Svea vägen 42');
    expect(mapGeoapifyResult({ lat: 1 })).toBeNull();
    expect(mapGeoapifyResult({ lat: 59, lon: 18, country_code: 'fi', formatted: 'x' })).toBeNull();
  });
});
