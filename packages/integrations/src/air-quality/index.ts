import { z } from 'zod';
import { httpJson, iso, num } from '../http';
import type { AdapterContext, AdapterResult, StationObservation } from '../types';

/**
 * Air quality – SMHI "Datavärdskap luft" 52°North SOS/Timeseries API (verified live 2026-11-13).
 *
 *   {base}/timeseries?phenomenon={id}&expanded=true
 * Each series carries the station (label, classification, WGS84 point), uom (µg/m3) and lastValue.
 * The endpoint is SLOW (17–60 s per phenomenon), so it is collected centrally and sequentially
 * with a long timeout, at most hourly. Values are preliminary (not quality assured).
 *
 * No air-quality index is computed: no documented, approved method exists (IMPLEMENTATION.md §20).
 */
export const AIR_QUALITY_ATTRIBUTION = 'Källa: SMHI / Naturvårdsverket (datavärdskap luft) – preliminära data';

export const AIR_PHENOMENA = [
  { id: '6001', key: 'pm25', label: 'PM2,5', unit: 'µg/m³' },
  { id: '5', key: 'pm10', label: 'PM10', unit: 'µg/m³' },
  { id: '8', key: 'no2', label: 'Kvävedioxid (NO₂)', unit: 'µg/m³' },
  { id: '7', key: 'o3', label: 'Ozon (O₃)', unit: 'µg/m³' },
] as const;

/** Series whose last value is older than this are ignored (station not currently reporting). */
export const AIR_MAX_AGE_HOURS = 24;

const Series = z
  .object({
    id: z.string(),
    uom: z.string().nullish(),
    lastValue: z.object({ timestamp: z.number(), value: z.union([z.number(), z.string()]).nullable() }).nullish(),
    primaryData: z.string().nullish(),
    station: z.object({
      id: z.union([z.string(), z.number()]),
      properties: z.object({ label: z.string(), classification: z.string().nullish() }).passthrough(),
      geometry: z.object({ type: z.literal('Point'), coordinates: z.array(z.number()).min(2) }),
    }),
  })
  .passthrough();

/**
 * Picks, per station, the newest series of the phenomenon (hourly preferred over daily) and
 * drops stale/missing values.
 */
export function parseAirSeries(raw: unknown, phen: (typeof AIR_PHENOMENA)[number], now: Date): StationObservation[] | null {
  const list = z.array(z.unknown()).safeParse(raw);
  if (!list.success) return null;
  const best = new Map<string, { obs: StationObservation; ts: number; hourly: boolean }>();
  for (const r of list.data) {
    const p = Series.safeParse(r);
    if (!p.success || !p.data.lastValue) continue;
    const s = p.data;
    const value = num(s.lastValue!.value);
    const ts = s.lastValue!.timestamp;
    if (value === null || value < 0 || now.getTime() - ts > AIR_MAX_AGE_HOURS * 3_600_000 || ts > now.getTime() + 3_600_000) continue;
    const [lon, lat] = s.station.geometry.coordinates as [number, number];
    const stationId = String(s.station.id);
    const hourly = s.primaryData === 'hour';
    const prev = best.get(stationId);
    if (prev && (prev.hourly && !hourly ? true : prev.ts >= ts && prev.hourly === hourly)) continue;
    best.set(stationId, {
      ts,
      hourly,
      obs: {
        sourceId: 'air_quality',
        stationId,
        parameter: phen.key,
        name: s.station.properties.label,
        lat,
        lon,
        value: Math.round(value * 10) / 10,
        unit: phen.unit,
        observedAt: iso(ts),
        quality: 'preliminary',
        extra: { classification: s.station.properties.classification ?? null, seriesId: s.id, resolution: s.primaryData ?? null },
      },
    });
  }
  return [...best.values()].map((b) => b.obs);
}

export async function fetchAirQuality(phen: (typeof AIR_PHENOMENA)[number], ctx: AdapterContext): Promise<AdapterResult<StationObservation[]>> {
  const base = ctx.env.AIR_QUALITY_BASE_URL.replace(/\/+$/, '');
  const r = await httpJson(`${base}/timeseries?phenomenon=${phen.id}&expanded=true`, ctx, { label: `air_quality_${phen.key}`, timeoutMs: 120_000, attempts: 2 });
  if (!r.ok) return r;
  const parsed = parseAirSeries(r.data, phen, ctx.now());
  return parsed ? { ok: true, data: parsed, fetchedAt: r.fetchedAt } : { ok: false, error: 'invalid_payload', detail: `air_quality_${phen.key}: expected an array` };
}
