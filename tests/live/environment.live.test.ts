import { describe, expect, it } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { AIR_PHENOMENA, fetchAirQuality, fetchObservedGroundwater, fetchTrafikverketNear, stationAirIndex, type AdapterContext } from '@fastighetsradar/integrations';

const env = loadServerEnv({ ...process.env, SOURCE_SGU_OBSERVED_ENABLED: 'true', TRAFIKVERKET_ENABLED: 'true' });
const ctx: AdapterContext = { env, fetch, logger: { debug() {}, info() {}, warn() {}, error() {} }, now: () => new Date() };
describe('environment adapter live contracts', () => {
  it('SGU measured groundwater near Vaxholm_1', async () => {
    const r = await fetchObservedGroundwater(59.39304617, 18.27230138, ctx);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.data).toMatchObject({ stationId: '55_1', unit: 'm under markytan' });
  }, 90_000);
  it.skipIf(!env.TRAFIKVERKET_API_KEY)('Trafikverket road ferry deviations and geometry', async () => {
    const r = await fetchTrafikverketNear([{ lat: 57.81, lon: 11.85 }], ctx);
    expect(r.ok, r.ok ? '' : r.detail).toBe(true);
    if (r.ok) expect(r.data.events.every((e) => e.geometryWkt)).toBe(true);
  }, 60_000);
  it('all five air pollutants join a same-hour physical station index', async () => {
    const observations = [];
    for (const p of AIR_PHENOMENA) {
      const r = await fetchAirQuality(p, ctx);
      expect(r.ok, r.ok ? '' : `${p.key}: ${r.error}`).toBe(true);
      if (r.ok) observations.push(...r.data);
    }
    const index = stationAirIndex(observations.map((o) => ({ stationId: o.stationId, stationName: o.name, distanceMeters: 1000,
      parameter: o.parameter, value: o.extra.rawValue as number, observedAt: o.observedAt, resolution: o.extra.resolution, classification: o.extra.classification })), new Date());
    expect(index).not.toBeNull();
  }, 660_000);
});
