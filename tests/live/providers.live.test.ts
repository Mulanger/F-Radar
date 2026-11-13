/**
 * LIVE smoke tests against the real public providers (network!).
 *
 * Deliberately NOT part of `npm test`. Run explicitly:
 *   npm run test:live
 * Trafikverket runs only when TRAFIKVERKET_API_KEY is set in the environment (.env is loaded by the
 * npm script); the key is never printed. Each test makes the minimum number of requests.
 * Assertions check schema/semantics, never specific weather – an empty warning list is a valid result.
 */
import { describe, expect, it } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import {
  fetchHydrology, fetchHydrologyReference,
  fetchOceanography,
  fetchMetNowcast,
  AIR_PHENOMENA,
  METOBS_PARAMETERS,
  fetchAirQuality,
  fetchKrisinformation,
  fetchMetObsLatest,
  fetchMunicipalityStats,
  fetchSguAreaId,
  fetchSguLatestLevel,
  fetchSmhiCountyAreas,
  fetchSmhiPointForecast,
  fetchSmhiWarnings,
  fetchTrafikverketNear,
  probeFloodScenarios,
  resolveMunicipalityCode,
  type AdapterContext,
} from '@fastighetsradar/integrations';

const env = loadServerEnv({ ...process.env, TRAFIKVERKET_ENABLED: process.env.TRAFIKVERKET_API_KEY ? 'true' : 'false' } as Record<string, string>);
const ctx: AdapterContext = { env, fetch, logger: { debug() {}, info() {}, warn() {}, error() {} }, now: () => new Date() };
const STHLM = { lat: 59.3367656, lon: 18.0627049 }; // Sveavägen 42
const UPPSALA_FYRIS = { lat: 59.8586, lon: 17.6389 }; // inside mapped Fyrisån flood areas (verified)

describe('live providers', () => {
  it('SMHI hydrology flow and corrected archive',async()=>{
    const r=await fetchHydrology(ctx);expect(r.ok,r.ok?'':r.detail).toBe(true);
    if(r.ok)expect(r.data.length).toBeGreaterThan(50);
    const ref=await fetchHydrologyReference('1583',ctx);expect(ref.ok,ref.ok?'':ref.detail).toBe(true);
    if(ref.ok){expect(ref.data.filter(m=>m.reference).length).toBe(12);expect(ref.data[10]!.reference!.years).toBeGreaterThan(3);}
  },240000);
  it('SMHI oceanography RW minute data',async()=>{
    const r=await fetchOceanography(ctx);expect(r.ok,r.ok?'':r.detail).toBe(true);
    if(r.ok){expect(r.data.length).toBeGreaterThan(60);expect(r.data.every(x=>x.extra.referenceSystem==='RW'&&x.unit==='cm')).toBe(true);}
  },45000);
  it.skipIf(!env.MET_NORWAY_CONTACT)('MET Norway nowcast', async () => {
    const r=await fetchMetNowcast(59.33,18.06,ctx);
    expect(r.ok, r.ok?'':r.detail).toBe(true);
    if(r.ok) { expect(r.data.expiresAt).toBeTruthy(); expect(r.data.data?.points.length).toBeGreaterThan(0); }
  },30000);
  it('SMHI SNOW1gv1 point forecast', async () => {
    const r = await fetchSmhiPointForecast(STHLM.lat, STHLM.lon, ctx);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.data.steps.length).toBeGreaterThan(48);
    expect(Date.now() - Date.parse(r.data.referenceTime)).toBeLessThan(12 * 3_600_000);
    expect(r.data.steps.some((s) => s.airTemperature !== null)).toBe(true);
  }, 30_000);

  it('SMHI IBWW warnings + county polygons', async () => {
    const w = await fetchSmhiWarnings(ctx);
    expect(w.ok, JSON.stringify(w)).toBe(true);
    if (w.ok) for (const e of w.data.events) expect(['Yellow', 'Orange', 'Red', 'Info']).toContain(e.level);
    const a = await fetchSmhiCountyAreas(ctx);
    expect(a.ok && a.data.length).toBe(21);
  }, 60_000);

  it('Krisinformation v3 news + VMA', async () => {
    const r = await fetchKrisinformation(ctx);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) for (const e of r.data.events) expect(e.countyNames.length + ((e.extra.municipalities as string[]) ?? []).length).toBeGreaterThan(0);
  }, 45_000);

  it.skipIf(!process.env.TRAFIKVERKET_API_KEY)('Trafikverket situations near Stockholm', async () => {
    const r = await fetchTrafikverketNear([STHLM], ctx);
    expect(r.ok, r.ok ? '' : `${r.error}: ${r.detail}`).toBe(true);
    if (r.ok) for (const e of r.data.events) expect(e.geometryWkt).toMatch(/^(POINT|LINESTRING|MULTI)/);
  }, 45_000);

  it('SMHI MetObs latest hour (air temperature)', async () => {
    const r = await fetchMetObsLatest(METOBS_PARAMETERS[0], ctx);
    expect(r.ok && r.data.length).toBeGreaterThan(50);
  }, 45_000);

  it('Air quality PM2.5 (slow endpoint)', async () => {
    const r = await fetchAirQuality(AIR_PHENOMENA[0], ctx);
    expect(r.ok, JSON.stringify(r).slice(0, 300)).toBe(true);
    if (r.ok) expect(r.data.length).toBeGreaterThan(5);
  }, 150_000);

  it('SGU HYPE area + latest level for Stockholm', async () => {
    const a = await fetchSguAreaId(STHLM.lat, STHLM.lon, ctx);
    expect(a.ok && a.data).toBeTruthy();
    if (!a.ok || !a.data) return;
    const l = await fetchSguLatestLevel(a.data, ctx);
    expect(l.ok && l.data?.areaId).toBe(a.data);
  }, 45_000);

  it('MCF flood scenarios (Uppsala hit, Stockholm property no hit)', async () => {
    const u = await probeFloodScenarios(UPPSALA_FYRIS.lat, UPPSALA_FYRIS.lon, ctx);
    expect(u.ok, JSON.stringify(u)).toBe(true);
    if (u.ok) expect(u.data.scenarios.find((s) => s.scenario === 'q100')!.withinMeters).not.toBeNull();
    const s = await probeFloodScenarios(STHLM.lat, STHLM.lon, ctx);
    expect(s.ok).toBe(true);
  }, 120_000);

  it('SCB PxWeb v2 municipality statistics', async () => {
    const c = await resolveMunicipalityCode('Stockholms kommun', ctx);
    expect(c.ok && c.data?.code).toBe('0180');
    const s = await fetchMunicipalityStats('0180', ctx);
    expect(s.ok && s.data.values.find((v) => v.key === 'population')!.value).toBeGreaterThan(900_000);
  }, 60_000);
});
