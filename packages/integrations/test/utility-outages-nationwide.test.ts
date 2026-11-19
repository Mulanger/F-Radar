import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import {
  enabledOperators, fetchOperatorOutages, operatorById, parseDigproKml, parseSkekraft, parseTrimble, parseUmea,
  publishedLocalTime, trimbleDistricts, trimbleStations, UTILITY_OPERATORS, type AdapterContext,
} from '../src';

const now = new Date('2026-11-19T07:00:00Z');
const text = (id: string, extension = 'json') => readFileSync(new URL(`./fixtures/utility-outages/${id}-2026-11-19.${extension}`, import.meta.url), 'utf8');
const fx = (id: string) => JSON.parse(text(id));
const context = (body: unknown): AdapterContext => ({ env: loadServerEnv({}), now: () => now, fetch: vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body))), logger: { debug() {}, info() {}, warn() {}, error() {} } });

describe('nationwide electricity additions: actual pod response contracts', () => {
  it('reuses ETag bodies on 304 instead of treating an unchanged feed as empty; unsolicited 304 is an error', async () => {
    const body = text('umea-public');
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(body, { headers: { ETag: '"published-v1"' } })).mockResolvedValueOnce(new Response(null, { status: 304 }));
    const c: AdapterContext = { env: loadServerEnv({}), fetch: fetcher, now: () => now, logger: { debug() {}, info() {}, warn() {}, error() {} } };
    const first = await fetchOperatorOutages(operatorById('umea')!, c);
    const second = await fetchOperatorOutages(operatorById('umea')!, c);
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(fetcher.mock.calls[1]![1].headers['If-None-Match']).toBe('"published-v1"');
    expect(await fetchOperatorOutages(operatorById('umea')!, { ...c, fetch: vi.fn(async () => new Response(null, { status: 304 })) })).toMatchObject({ ok: false, error: 'invalid_payload' });
  });
  it('all four operators stay disabled even with global source on and an explicit operator list', () => {
    const ids = ['oresundskraft', 'kraftringen_elnat', 'umea', 'skekraft'];
    const off = loadServerEnv({ SOURCE_UTILITY_OUTAGES_ENABLED: 'true' });
    expect(enabledOperators(ids.join(','), UTILITY_OPERATORS, off)).toEqual([]);
    const on = loadServerEnv({ SOURCE_UTILITY_ORESUND_ENABLED: 'true', SOURCE_UTILITY_KRAFTRINGEN_ENABLED: 'true', SOURCE_UTILITY_UMEA_ENABLED: 'true', SOURCE_UTILITY_SKEKRAFT_ENABLED: 'true' });
    expect(enabledOperators(ids.join(','), UTILITY_OPERATORS, on).map((o) => o.id)).toEqual(ids);
  });
  it('Kraftringen uses its actual blob KML and Öresundskraft reuses validated district matching', async () => {
    const op = operatorById('kraftringen_elnat')!;
    const c = context(text('kraftringen-kml', 'kml'));
    const r = await fetchOperatorOutages(op, c);
    expect(r.ok).toBe(true);
    expect(c.fetch).toHaveBeenCalledWith('https://stavbrottskartan.blob.core.windows.net/xml/fpp_lnd_outages.kml', expect.anything());
    const kml = parseDigproKml(text('kraftringen-kml', 'kml'), { operatorId: op.id, utility: 'electricity', mapUrl: op.mapUrl, now })!;
    expect(kml.skipped).toBe(0);
    expect(kml.outages.length).toBeGreaterThan(0);
    const oresund = operatorById('oresundskraft')!;
    if (oresund.platform !== 'trimble') throw new Error('Expected verified Trimble configuration');
    const district = parseTrimble(fx('oresund-application'), trimbleDistricts(fx('oresund-static'), 'p')!, trimbleStations([fx('oresund-tiles-0')]), oresund, now)!;
    expect(district.skipped).toBe(0);
    expect(district.outages).toHaveLength(17);
    expect(district.outages.every((o) => o.precision === 'area')).toBe(true);
  });
  it('Umeå reads only published utilities, explicit states and polygons; swapped axes are rejected', () => {
    const data = fx('umea-public');
    const r = parseUmea(data, { ...operatorById('umea')!, utilities: ['electricity'] }, now)!;
    expect(r.skipped).toBe(0);
    expect(r.outages.every((o) => o.utility === 'electricity')).toBe(true);
    // No active electricity outage was present in the captured public response.
    expect(new Set(r.outages.map((o) => o.state))).toEqual(new Set(['restored']));
    const row = data.find((x: { domain: number }) => x.domain === 0);
    // Synthetic lifecycle variants use the enum mapping verified in the public map bundle.
    expect(parseUmea([{ ...row, state: 1 }], operatorById('umea')!, now)!.outages[0]!.state).toBe('ongoing');
    expect(parseUmea([{ ...row, state: 2, type: 0, startDate: '2026-11-20T09:00:00' }], operatorById('umea')!, now)!.outages[0]!.state).toBe('upcoming');
    const bad = { ...row, geoCoordinates: { type: 'Polygon', coordinates: [[[63.8, 20.2], [63.9, 20.2], [63.9, 20.3], [63.8, 20.2]]] }, geoCoordinatesHistory: null };
    expect(parseUmea([bad], operatorById('umea')!, now)!.skipped).toBe(1);
    const unknown = parseUmea([{ ...row, state: 99, type: 99 }], operatorById('umea')!, now)!.outages[0]!;
    expect(unknown).toMatchObject({ kind: 'unknown', state: 'unknown' });
  });
  it('Skellefteå swaps lat/lng, preserves point precision and never confuses missing rows with restoration', () => {
    const data = fx('skekraft-disturbances');
    const r = parseSkekraft(data, operatorById('skekraft')!)!;
    expect(r.outages.some((o) => o.precision === 'point')).toBe(true);
    expect(r.outages.some((o) => o.state === 'restored')).toBe(true);
    // Fixture retains original count while trimming records: a truncated response must stay partial.
    expect(r.skipped).toBe(data.count - data.results.length);
    const full = { ...data, count: data.results.length };
    expect(parseSkekraft(full, operatorById('skekraft')!)!.skipped).toBe(0);
    const unknown = parseSkekraft({ ...full, count: 1, results: [{ ...data.results[0], Fixed: false, Status: 99 }] }, operatorById('skekraft')!)!.outages[0]!;
    expect(unknown.state).toBe('unknown');
  });
  it('valid empty JSON is zero outages; malformed responses are errors and invalid records are skipped', async () => {
    for (const [id, empty] of [['umea', []], ['skekraft', { count: 0, total: 18191, results: [] }]] as const) {
      const r = await fetchOperatorOutages(operatorById(id)!, context(empty));
      expect(r).toMatchObject({ ok: true, data: { outages: [], skipped: 0 } });
      const bad = await fetchOperatorOutages(operatorById(id)!, context('<html>unavailable</html>'));
      expect(bad).toMatchObject({ ok: false, error: 'invalid_payload' });
    }
    expect(parseUmea([{}], operatorById('umea')!, now)!.skipped).toBe(1);
    expect(parseSkekraft({ count: 1, total: 1, results: [{}] }, operatorById('skekraft')!)!.skipped).toBe(1);
  });
  it('naive fractional times are Swedish local time and sentinel/DST gaps remain unknown', () => {
    expect(publishedLocalTime('2026-11-19T09:03:00.34567')).toBe('2026-11-19T08:03:00.000Z');
    expect(publishedLocalTime('2026-07-01T09:03:00')).toBe('2026-07-01T07:03:00.000Z');
    expect(publishedLocalTime('2026-03-29T02:30:00')).toBeNull();
    expect(publishedLocalTime('0001-01-01T00:00:00')).toBeNull();
  });
});
