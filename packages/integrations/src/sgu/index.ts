import { z } from 'zod';
import { httpJson, num } from '../http';
import type { AdapterContext, AdapterResult } from '../types';

/**
 * SGU groundwater – HYPE model areas (verified live 2026-11-13).
 *
 *  - Area lookup:  {regional}/collections/omraden/items?bbox=… → omrade_id (4×4 km model cells).
 *  - Levels:       {regional}/collections/grundvattennivaer-tidigare/items?filter-lang=cql-text
 *                  &filter=omrade_id=<id> AND datum>='YYYY-MM-DD'
 *    fyllnadsgrad_* = percentile vs. all modelled levels; grundvattensituation_* = percentile vs.
 *    the same time of year; *_sma = small (shallow) / *_stora = large magazines; −1 = not applicable.
 *  The series lags a few days; collected daily.
 *
 * This is a REGIONAL MODEL value, never a measurement in or under a building.
 * Licence: SGU open data, CC BY 4.0 ("Källa: SGU").
 */
export const SGU_ATTRIBUTION = 'Källa: SGU (CC BY 4.0) – modellberäknade nivåer (HYPE), 4×4 km';

const AreaFC = z.object({ features: z.array(z.object({ properties: z.object({ omrade_id: z.union([z.number(), z.string()]) }).passthrough() }).passthrough()).default([]) }).passthrough();
const LevelsFC = z
  .object({
    features: z
      .array(
        z
          .object({
            properties: z
              .object({
                datum: z.string(),
                omrade_id: z.union([z.number(), z.string()]),
                grundvattensituation_sma: z.number().nullish(),
                grundvattensituation_stora: z.number().nullish(),
                fyllnadsgrad_sma: z.number().nullish(),
                fyllnadsgrad_stora: z.number().nullish(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export interface GroundwaterLevel {
  areaId: string;
  date: string;
  fillSmall: number | null;
  fillLarge: number | null;
  situationSmall: number | null;
  situationLarge: number | null;
}

const pct = (v: number | null | undefined) => {
  const n = num(v, [-1]);
  return n === null || n < 0 || n > 100 ? null : n;
};

export function parseSguArea(raw: unknown): string | null | undefined {
  const p = AreaFC.safeParse(raw);
  if (!p.success) return undefined;
  const id = p.data.features[0]?.properties.omrade_id;
  return id === undefined ? null : String(id);
}

export function parseSguLevels(raw: unknown): GroundwaterLevel | null | undefined {
  const p = LevelsFC.safeParse(raw);
  if (!p.success) return undefined;
  const latest = [...p.data.features].sort((a, b) => b.properties.datum.localeCompare(a.properties.datum))[0];
  if (!latest) return null;
  const x = latest.properties;
  return {
    areaId: String(x.omrade_id),
    date: x.datum.slice(0, 10),
    fillSmall: pct(x.fyllnadsgrad_sma),
    fillLarge: pct(x.fyllnadsgrad_stora),
    situationSmall: pct(x.grundvattensituation_sma),
    situationLarge: pct(x.grundvattensituation_stora),
  };
}

/** Returns the HYPE area id containing the point, or null when outside the model (no coverage). */
export async function fetchSguAreaId(lat: number, lon: number, ctx: AdapterContext): Promise<AdapterResult<string | null>> {
  const d = 0.0001;
  const url = `${ctx.env.SGU_REGIONAL_GROUNDWATER_BASE_URL.replace(/\/+$/, '')}/collections/omraden/items?f=json&limit=1&bbox=${(lon - d).toFixed(5)},${(lat - d).toFixed(5)},${(lon + d).toFixed(5)},${(lat + d).toFixed(5)}`;
  const r = await httpJson(url, ctx, { label: 'sgu_area', timeoutMs: 20_000 });
  if (!r.ok) return r;
  const id = parseSguArea(r.data);
  return id === undefined ? { ok: false, error: 'invalid_payload', detail: 'sgu_area: schema mismatch' } : { ok: true, data: id, fetchedAt: r.fetchedAt };
}

export async function fetchSguLatestLevel(areaId: string, ctx: AdapterContext): Promise<AdapterResult<GroundwaterLevel | null>> {
  if (!/^\d+$/.test(areaId)) return { ok: false, error: 'invalid_payload', detail: 'sgu_levels: bad area id' };
  const since = new Date(ctx.now().getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const filter = encodeURIComponent(`omrade_id=${areaId} AND datum>='${since}'`);
  const url = `${ctx.env.SGU_REGIONAL_GROUNDWATER_BASE_URL.replace(/\/+$/, '')}/collections/grundvattennivaer-tidigare/items?f=json&limit=60&filter-lang=cql-text&filter=${filter}`;
  const r = await httpJson(url, ctx, { label: 'sgu_levels', timeoutMs: 20_000 });
  if (!r.ok) return r;
  const lv = parseSguLevels(r.data);
  return lv === undefined ? { ok: false, error: 'invalid_payload', detail: 'sgu_levels: schema mismatch' } : { ok: true, data: lv, fetchedAt: r.fetchedAt };
}
