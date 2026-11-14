import { z } from 'zod';
import { httpJson, iso, num } from '../http';
import type { AdapterContext, AdapterResult, StationObservation } from '../types';

export const OCEAN_MAX_DISTANCE_M = 30_000;
export const OCEAN_MAX_AGE_HOURS = 3;
const Station = z.object({ key: z.string(), name: z.string(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), active: z.boolean() });
export type OceanStation = z.infer<typeof Station>;
const Catalogue = z.object({ key: z.literal('6'), unit: z.literal('cm'), station: z.array(Station) });
const Series = z.object({
  parameter: z.object({ key: z.literal('6'), unit: z.literal('cm') }),
  station: z.object({ key: z.string(), name: z.string() }),
  value: z.array(z.object({ date: z.number(), value: z.union([z.number(), z.string()]).nullable(), quality: z.string() })),
});

export function parseOceanStations(raw: unknown): OceanStation[] | null {
  const r = Catalogue.safeParse(raw);
  return r.success ? r.data.station.filter((s) => s.active) : null;
}

/** RH2000 hourly instantaneous samples, NOT centimetres above local mean. */
export function parseOceanSeries(raw: unknown, station: OceanStation, now: Date): StationObservation | null | undefined {
  const r = Series.safeParse(raw);
  if (!r.success || r.data.station.key !== station.key) return undefined;
  const points = [...new Map(r.data.value.filter((p) => ['G', 'Y', 'O'].includes(p.quality) && num(p.value, [9999, -9999]) !== null && p.date <= now.getTime() && p.date >= now.getTime() - 30 * 3_600_000).map((p) => [p.date, p])).values()].sort((a, b) => a.date - b.date);
  const last = points.at(-1);
  if (!last || now.getTime() - last.date > OCEAN_MAX_AGE_HOURS * 3_600_000) return null;
  // A one-hour finite difference; no interpolation over missing hours.
  const previous = points.find((p) => p.date === last.date - 3_600_000);
  const trend = previous ? Math.round((Number(last.value) - Number(previous.value)) * 10) / 10 : null;
  return {
    sourceId: 'smhi_oceanography', stationId: station.key, name: station.name,
    parameter: 'sea_level_rh2000', lat: station.latitude, lon: station.longitude,
    value: num(last.value), unit: 'cm RH 2000', observedAt: iso(last.date), quality: last.quality,
    extra: { referenceSystem: 'RH 2000', trendCmPerHour: trend, trendFrom: previous ? iso(previous.date) : null, method: 'hourly_difference_v1', sourceUrl: `https://opendata-download-ocobs.smhi.se/api/version/1.0/parameter/6/station/${station.key}/period/latest-day/data.json` },
  };
}

export async function fetchOceanStations(ctx: AdapterContext): Promise<AdapterResult<OceanStation[]>> {
  if (!ctx.env.SOURCE_SMHI_OCEANOGRAPHY_ENABLED) return { ok: false, error: 'disabled' };
  const r = await httpJson(`${ctx.env.SMHI_OCEANOGRAPHY_BASE_URL}/version/1.0/parameter/6.json`, ctx, { label: 'ocean_stations' });
  if (!r.ok) return r;
  const data = parseOceanStations(r.data);
  return data ? { ok: true, data, fetchedAt: r.fetchedAt } : { ok: false, error: 'invalid_payload' };
}

export async function fetchOceanLevel(station: OceanStation, ctx: AdapterContext): Promise<AdapterResult<StationObservation | null>> {
  if (!ctx.env.SOURCE_SMHI_OCEANOGRAPHY_ENABLED) return { ok: false, error: 'disabled' };
  const url = `${ctx.env.SMHI_OCEANOGRAPHY_BASE_URL}/version/1.0/parameter/6/station/${encodeURIComponent(station.key)}/period/latest-day/data.json`;
  const r = await httpJson(url, ctx, { label: 'ocean_level' });
  if (!r.ok) return r;
  const data = parseOceanSeries(r.data, station, ctx.now());
  return data === undefined ? { ok: false, error: 'invalid_payload' } : { ok: true, data, fetchedAt: r.fetchedAt };
}
