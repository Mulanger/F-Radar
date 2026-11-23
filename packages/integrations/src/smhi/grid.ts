import { SWEDEN_BOUNDS } from '@fastighetsradar/domain';
import { httpJson } from '../http';
import type { AdapterContext, AdapterResult } from '../types';

interface GridPoint { lat: number; lon: number }
export interface SmhiForecastGrid {
  nearest(lat: number, lon: number): GridPoint | null;
}

// 0.1° bins are wider than a cell even at Sweden's northern limit. Search adjacent bins for a
// spherical nearest point, and keep only the part of the static catalogue the app can use.
const BIN = 0.1;
const bin = (angle: number) => Math.floor(angle / BIN);
const key = (y: number, x: number) => y * 4096 + x;
const radians = Math.PI / 180;
// A 2.5 km cell's diagonal is ~3.54 km. Do not snap positions well beyond the outermost cells.
const maxDistance = Math.sin(2_100 / (2 * 6_371_000)) ** 2;

/** Index the versioned SNOW MultiPoint geometry, not a sampled/downsampled forecast. */
export function indexSmhiForecastGrid(raw: unknown): SmhiForecastGrid | null {
  if (!raw || typeof raw !== 'object' || !('type' in raw) || raw.type !== 'MultiPoint'
      || !('coordinates' in raw) || !Array.isArray(raw.coordinates)) return null;
  const buckets = new Map<number, number[]>();
  for (const coord of raw.coordinates as unknown[]) {
    if (!Array.isArray(coord) || coord.length !== 2) return null;
    const [lon, lat] = coord as unknown[];
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)
        || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    if (lat < SWEDEN_BOUNDS.minLat - BIN || lat > SWEDEN_BOUNDS.maxLat + BIN
        || lon < SWEDEN_BOUNDS.minLon - BIN || lon > SWEDEN_BOUNDS.maxLon + BIN) continue;
    const k = key(bin(lat), bin(lon));
    const bucket = buckets.get(k);
    if (bucket) bucket.push(lat, lon);
    else buckets.set(k, [lat, lon]);
  }
  if (!buckets.size) return null;
  return {
    nearest(lat, lon) {
      let best: GridPoint | null = null;
      let distance = maxDistance;
      const y = bin(lat), x = bin(lon), cosLat = Math.cos(lat * radians);
      for (let j = y - 1; j <= y + 1; j++) for (let k = x - 1; k <= x + 1; k++) {
        const bucket = buckets.get(key(j, k));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i += 2) {
          const a = bucket[i]!, b = bucket[i + 1]!;
          const d = Math.sin((a - lat) * radians / 2) ** 2 + cosLat * Math.cos(a * radians) * Math.sin((b - lon) * radians / 2) ** 2;
          if (d < distance) { best = { lat: a, lon: b }; distance = d; }
        }
      }
      return best;
    },
  };
}

export async function fetchSmhiForecastGrid(ctx: AdapterContext): Promise<AdapterResult<SmhiForecastGrid>> {
  const base = ctx.env.SMHI_FORECAST_BASE_URL.replace(/\/+$/, '');
  const r = await httpJson(`${base}/category/snow1g/version/1/geotype/multipoint.json`, ctx,
    { label: 'smhi_forecast_grid', timeoutMs: 30_000, headers: { 'Accept-Encoding': 'gzip' } });
  if (!r.ok) return r;
  const data = indexSmhiForecastGrid(r.data);
  return data ? { ...r, data } : { ok: false, error: 'invalid_payload', detail: 'smhi_forecast_grid: invalid MultiPoint catalogue' };
}
