import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { enabledOperators, fetchOperatorOutages, operatorById, trimbleStations, type AdapterContext } from '../src';
const text = (id: string) => readFileSync(new URL(`./fixtures/utility-outages/${id}-2026-11-19.json`, import.meta.url), 'utf8');
describe('Mälarenergi heat: published district IDs with scope-specific station links', () => {
  it('preserves electricity outages while the heating flag is on', async () => {
    const op = operatorById('trimble:malarenergi')!;
    const fetcher = vi.fn(async (input) => new Response(text(String(input).includes('GetApplicationData') ? 'malarenergi-all-application' : String(input).includes('StaticObjects') ? 'malarenergi-all-static' : 'malar-heat-tiles-0')));
    const ctx: AdapterContext = { env: loadServerEnv({ SOURCE_UTILITY_MALAR_HEAT_ENABLED: 'true' }), fetch: fetcher as typeof fetch, now: () => new Date('2026-11-19T08:00:00Z'), logger: { debug() {}, info() {}, warn() {}, error() {} } };
    const r = await fetchOperatorOutages(op, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('Unexpected fetch failure');
    expect(r.data.skipped).toBe(0);
    expect(r.data.outages.every((o) => o.utility === 'electricity')).toBe(true);
    expect(r.data.outages.filter((o) => o.utility === 'electricity')).toHaveLength(2);
    expect(r.data.outages.every((o) => o.precision === 'area')).toBe(true);
    expect(r.data.outages.filter((o) => o.utility === 'electricity').every((o) => /^trimble:malarenergi:\d+$/.test(o.externalId))).toBe(true);
    expect(new Set(r.data.outages.map((o) => o.externalId)).size).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(enabledOperators('trimble:malarenergi', [op], loadServerEnv({}))[0]!.utilities).toEqual(['electricity']);
  });
  it('never mixes station IDs between utility scopes, even when outage numbers collide', () => {
    const point = (scope: string, x: number) => ({ x, y: 59.6, context: JSON.stringify({ t: 'po', _nt: scope, oid: 1 }) });
    const tiles = [{ points: [point('p', 16.5), point('h', 16.6)] }];
    expect(trimbleStations(tiles, 'p').get(1)).toEqual([[16.5, 59.6]]);
    expect(trimbleStations(tiles, 'h').get(1)).toEqual([[16.6, 59.6]]);
  });
});
