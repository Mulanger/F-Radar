import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { AIR_PHENOMENA, eeaBand, fetchObservedGroundwater, fetchSlDeviations, parseAirSeries, parseGroundwaterStations, parseObservedGroundwater, parseSlDeviations, parseTrafikverket, stationAirIndex, windChill, type AdapterContext, type AirIndexSample } from '../src';

const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const NOW = new Date('2026-11-14T12:00:00Z');
const ctx = (responses: unknown[], env: Record<string, string> = {}): AdapterContext => ({
  env: loadServerEnv(env), now: () => NOW,
  fetch: vi.fn(async () => new Response(JSON.stringify(responses.shift()), { headers: { 'content-type': 'application/json' } })) as typeof fetch,
  logger: { debug() {}, info() {}, warn() {}, error() {} },
});

describe('SMHI published wind chill (ADR 0006)', () => {
  it('matches the SMHI table and refuses extrapolation or missing inputs', () => {
    expect(Math.round(windChill(-10, 2)!)).toBe(-14);
    expect(Math.round(windChill(-20, 10)!)).toBe(-34);
    for (const [t, w] of [[11, 5], [-41, 5], [0, 1.29], [0, 35.01], [null, 5], [0, null], [NaN, 2]]) expect(windChill(t!, w!)).toBeNull();
    expect(windChill(10, 1.3)).not.toBeNull();
    expect(windChill(-40, 35)).not.toBeNull();
  });
});

describe('SGU observed groundwater contract', () => {
  it('joins the station and level collections without confusing depth with altitude', async () => {
    const c = ctx([fx('sgu-observed-stations'), fx('sgu-observed-levels')]);
    const r = await fetchObservedGroundwater(59.39304617, 18.27230138, c);
    expect(r).toMatchObject({ ok: true, data: { stationId: '55_1', stationName: 'Vaxholm_1', distanceMeters: 0, value: 0.654, unit: 'm under markytan', observedAt: '2026-11-13T00:00:00.000Z' } });
    const u = new URL(String(vi.mocked(c.fetch).mock.calls[1]![0]));
    expect(u.searchParams.get('filter')).toContain("platsbeteckning='55_1'");
    expect(u.searchParams.has('sortby')).toBe(false); // live API ignores sortby
  });
  it('chooses newest locally; does not substitute a flagged, old or truncated series', () => {
    const raw = fx('sgu-observed-levels');
    raw.features.push(structuredClone(raw.features[0])); raw.numberMatched = 2;
    raw.features[0].properties.obsdatum = '2026-10-20T00:00:00Z';
    expect(parseObservedGroundwater(raw, '55_1', NOW)?.obsdatum).toBe('2026-11-13T00:00:00Z');
    raw.features[1].properties.nivaanmarkning = 'misstänkt';
    expect(parseObservedGroundwater(raw, '55_1', new Date('2026-12-20'))).toBeNull();
    raw.numberMatched = 10001;
    expect(parseObservedGroundwater(raw, '55_1', NOW)).toBeUndefined();
    expect(parseGroundwaterStations(fx('sgu-observed-stations'), 65, 15)).toEqual([]);
  });
});

describe('EEA hourly station index (ADR 0007)', () => {
  const sample = (parameter: string, value: number, over: Partial<AirIndexSample> = {}): AirIndexSample => ({ parameter, value, stationId: 'a', stationName: 'Gatan', distanceMeters: 2000, observedAt: '2026-11-14T11:00:00Z', resolution: 'hour', classification: 'Gaturum', ...over });
  it('uses all published bands, preserves boundary precision, and chooses the worst pollutant', () => {
    expect(eeaBand('pm25', 5)).toBe(1); expect(eeaBand('pm25', 5.01)).toBe(2); expect(eeaBand('pm25', 141)).toBe(6);
    expect(eeaBand('so2', 21)).toBe(2); expect(eeaBand('no2', -1)).toBeNull();
    expect(stationAirIndex([sample('pm25', 6), sample('no2', 61)], NOW)).toMatchObject({ band: 4, label: 'Dålig', missingPollutants: ['pm10', 'o3', 'so2'] });
  });
  it('never combines stations or hours, imputes gaps, or uses minute/daily values', () => {
    for (const over of [{ stationId: 'b' }, { observedAt: '2026-11-14T10:00:00Z' }, { resolution: 'day' }, { distanceMeters: 25001 }])
      expect(stationAirIndex([sample('pm25', 6), sample('no2', 16, over)], NOW)).toBeNull();
    expect(stationAirIndex([sample('pm25', 6, { classification: 'Urban bakgrund' }), sample('no2', 16, { classification: 'Urban bakgrund' })], NOW)).toBeNull();
    expect(stationAirIndex([sample('pm25', 6), sample('no2', 16)], new Date('2026-11-15'))).toBeNull();
  });
  it('joins REAL pollutant-specific ids only by exact published station identity', () => {
    const raw = fx('air-index-hours');
    const obs = AIR_PHENOMENA.flatMap((p) => parseAirSeries(raw[p.key], p, NOW) ?? []);
    const malmo = obs.filter((o) => o.name === 'Malmö Rådhuset');
    expect(new Set(malmo.map((o) => o.stationId)).size).toBe(1);
    expect(new Set(malmo.map((o) => o.extra.upstreamStationId)).size).toBeGreaterThan(2);
    const index = stationAirIndex(obs.map((o) => ({ parameter: o.parameter, value: o.extra.rawValue as number, stationId: o.stationId, stationName: o.name, distanceMeters: 2000, observedAt: o.observedAt, classification: o.extra.classification, resolution: o.extra.resolution })), NOW);
    expect(index).not.toBeNull();
  });
});

describe('road ferries and locally gated SL boats', () => {
  it('includes real Trafikverket disruptions with geometry and excludes ordinary departures', () => {
    const r = parseTrafikverket(fx('trafikverket-ferries'));
    if ('error' in r) throw new Error(r.error);
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.events.every((e) => e.description && e.geometryWkt)).toBe(true);
    expect(r.events.filter((e) => e.extra.transportMode === 'road_ferry').length).toBeGreaterThan(0);
    expect(r.events.some((e) => e.headline.includes('Vaxholmsleden'))).toBe(false);
  });
  it('reports missing SL access and never sends the key to the provider', async () => {
    const c = ctx([]);
    expect(await fetchSlDeviations(c)).toMatchObject({ ok: false, error: 'access_required' });
    expect(c.fetch).not.toHaveBeenCalled();
    const raw = fx('sl-ship-messages'), sites = fx('sl-sites');
    expect(parseSlDeviations(raw, sites)).toMatchObject({ events: [], unlocated: 1 });
    // Localisation branch: a fixture variant with a documented stop-area reference.
    raw[0].scope.stop_areas = [{ id: sites[0].stop_areas[0] }];
    const enabled = ctx([raw, sites], { SOURCE_SL_DEVIATIONS_ENABLED: 'true', SL_DEVIATIONS_API_KEY: 'private-local-gate' });
    const r = await fetchSlDeviations(enabled);
    expect(r).toMatchObject({ ok: true, data: { events: [{ sourceId: 'sl_deviations', geometry: { type: 'Point' } }] } });
    expect(JSON.stringify(vi.mocked(enabled.fetch).mock.calls)).not.toContain('private-local-gate');
  });
});
