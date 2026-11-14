import { z } from 'zod';
import { httpJson, iso } from '../http';
import { haversineMeters } from '../geo';
import type { AdapterContext, AdapterResult } from '../types';

export const GROUNDWATER_OBS_MAX_DISTANCE_M = 10_000;
export const GROUNDWATER_OBS_MAX_AGE_DAYS = 31;
const Station = z.object({
  geometry: z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]) }),
  properties: z.object({ platsbeteckning: z.string(), obsplatsnamn: z.string(), tdat: z.string().nullable(), hojdsystem: z.string().nullable() }),
});
const Stations = z.object({ features: z.array(z.unknown()), numberMatched: z.number() });
const Levels = z.object({ features: z.array(z.object({ properties: z.object({ platsbeteckning: z.string(), obsdatum: z.string(), grundvattenniva_m_u_markyta: z.number().nullable(), nivaanmarkning: z.string().nullable() }) })), numberMatched: z.number() });
export interface ObservedGroundwater {
  stationId: string; stationName: string; distanceMeters: number;
  value: number; unit: string; observedAt: string; note: string; sourceUrl: string;
}

export function parseGroundwaterStations(raw: unknown, lat: number, lon: number) {
  const r = Stations.safeParse(raw);
  if (!r.success || r.data.numberMatched > r.data.features.length) return null;
  return r.data.features.flatMap((f) => {
    const p = Station.safeParse(f);
    if (!p.success || p.data.properties.tdat) return [];
    const [x, y] = p.data.geometry.coordinates;
    const distanceMeters = haversineMeters(lat, lon, y, x);
    return distanceMeters <= GROUNDWATER_OBS_MAX_DISTANCE_M ? [{ ...p.data.properties, distanceMeters }] : [];
  }).sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export function parseObservedGroundwater(raw: unknown, stationId: string, now: Date) {
  const r = Levels.safeParse(raw);
  if (!r.success || r.data.numberMatched > r.data.features.length) return undefined;
  // sortby was ignored by the real API: fetch the bounded date window and sort locally.
  return r.data.features.map((f) => f.properties).filter((p) => p.platsbeteckning === stationId && p.grundvattenniva_m_u_markyta !== null && !p.nivaanmarkning && iso(p.obsdatum) && Date.parse(p.obsdatum) <= now.getTime() && Date.parse(p.obsdatum) >= now.getTime() - GROUNDWATER_OBS_MAX_AGE_DAYS * 86_400_000).sort((a, b) => Date.parse(b.obsdatum) - Date.parse(a.obsdatum))[0] ?? null;
}

export async function fetchObservedGroundwater(lat: number, lon: number, ctx: AdapterContext): Promise<AdapterResult<ObservedGroundwater | null>> {
  if (!ctx.env.SOURCE_SGU_OBSERVED_ENABLED) return { ok: false, error: 'disabled' };
  const base = ctx.env.SGU_OBSERVED_GROUNDWATER_BASE_URL.replace(/\/+$/, '');
  const dy = 10 / 110.5, dx = dy / Math.cos(lat * Math.PI / 180);
  const u = new URL(`${base}/collections/stationer/items`);
  u.searchParams.set('bbox', [lon - dx, lat - dy, lon + dx, lat + dy].join(','));
  u.searchParams.set('limit', '1000');
  const r = await httpJson(u, ctx, { label: 'sgu_observed_stations', timeoutMs: 30_000 });
  if (!r.ok) return r;
  const stations = parseGroundwaterStations(r.data, lat, lon);
  if (!stations) return { ok: false, error: 'invalid_payload', detail: 'SGU stations invalid or truncated' };
  for (const s of stations) {
    const url = new URL(`${base}/collections/nivaer/items`);
    url.searchParams.set('filter-lang', 'cql-text');
    const since = new Date(ctx.now().getTime() - GROUNDWATER_OBS_MAX_AGE_DAYS * 86_400_000).toISOString();
    url.searchParams.set('filter', `platsbeteckning='${s.platsbeteckning.replace(/'/g, "''")}' AND obsdatum>='${since}'`);
    url.searchParams.set('limit', '10000');
    const l = await httpJson(url, ctx, { label: 'sgu_observed_levels', timeoutMs: 30_000 });
    if (!l.ok) return l;
    const value = parseObservedGroundwater(l.data, s.platsbeteckning, ctx.now());
    if (value === undefined) return { ok: false, error: 'invalid_payload', detail: 'SGU levels invalid or truncated' };
    if (!value) continue;
    return { ok: true, fetchedAt: l.fetchedAt, data: {
      stationId: s.platsbeteckning, stationName: s.obsplatsnamn, distanceMeters: Math.round(s.distanceMeters),
      value: value.grundvattenniva_m_u_markyta!, unit: 'm under markytan', observedAt: iso(value.obsdatum)!,
      note: 'Observation vid stationen, inte under byggnaden. Positivt värde = djup under stationens markyta.', sourceUrl: url.toString(),
    } };
  }
  return { ok: true, data: null, fetchedAt: r.fetchedAt };
}
