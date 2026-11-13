import { z } from 'zod';
import { httpJson, num } from '../http';
import type { AdapterContext, AdapterResult } from '../types';

/**
 * SCB PxWebApi v2 (verified live 2026-11-13; apiVersion 2.3.2).
 *
 *   {base}/api/v2/tables/TAB628/metadata?lang=sv      – json-stat2 dimensions (Region: 290 kommuner + län)
 *   {base}/api/v2/tables/TAB628/data?lang=sv&outputFormat=json-stat2
 *       &valuecodes[Region]=0180&valuecodes[Kon]=1+2&valuecodes[ContentsCode]=*&valuecodes[Tid]=top(1)
 * TAB628 = Befolkningstäthet, folkmängd och landareal efter region och kön (annual).
 * Limits (from /api/v2/config): 30 calls / 10 s per IP, 150 000 cells per call. Licence CC0.
 *
 * Context only (REGIONAL_STATISTIC): never used for alerts or a "risk score".
 */
export const SCB_ATTRIBUTION = 'Källa: SCB (CC0)';
export const SCB_TABLE = 'TAB628';
export const SCB_CONTENTS = [
  { code: 'BE0101U2', key: 'population', label: 'Folkmängd', unit: 'personer' },
  { code: 'BE0101U1', key: 'density', label: 'Invånare per km²', unit: 'inv/km²' },
  { code: 'BE0101U3', key: 'land_area', label: 'Landareal', unit: 'km²' },
] as const;

const apiBase = (ctx: AdapterContext) => `${ctx.env.SCB_PXWEB_V2_BASE_URL.replace(/\/+$/, '')}/api/v2`;

const Meta = z
  .object({ updated: z.string().optional(), dimension: z.object({ Region: z.object({ category: z.object({ label: z.record(z.string(), z.string()) }) }) }).passthrough() })
  .passthrough();

/** Normalises a municipality name: "Stockholms kommun" / "Stockholm" → "stockholm". */
export function normalizeMunicipality(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(kommun|stad)$/u, '')
    .replace(/s$/u, (m, off, str: string) => (str.length > 4 ? '' : m))
    .trim();
}

/** Builds name → 4-digit municipality code from TAB628 metadata (labels "Stockholm" etc.). */
export function parseScbMunicipalities(raw: unknown): Map<string, { code: string; name: string }> | null {
  const p = Meta.safeParse(raw);
  if (!p.success) return null;
  const map = new Map<string, { code: string; name: string }>();
  for (const [code, label] of Object.entries(p.data.dimension.Region.category.label)) {
    if (!/^\d{4}$/.test(code)) continue;
    const name = label.replace(/^\d{4}\s+/, '');
    map.set(normalizeMunicipality(name), { code, name });
    map.set(name.toLowerCase(), { code, name });
  }
  return map;
}

let muniCache: { at: number; map: Map<string, { code: string; name: string }> } | null = null;
/** Test hook. */
export function __resetScbCache() {
  muniCache = null;
}

export async function resolveMunicipalityCode(municipality: string, ctx: AdapterContext): Promise<AdapterResult<{ code: string; name: string } | null>> {
  const now = ctx.now().getTime();
  if (!muniCache || now - muniCache.at > 7 * 86_400_000) {
    const r = await httpJson(`${apiBase(ctx)}/tables/${SCB_TABLE}/metadata?lang=sv`, ctx, { label: 'scb_metadata', timeoutMs: 30_000 });
    if (!r.ok) return r;
    const map = parseScbMunicipalities(r.data);
    if (!map || map.size < 250) return { ok: false, error: 'invalid_payload', detail: 'scb_metadata: municipality list missing' };
    muniCache = { at: now, map };
  }
  const hit = muniCache.map.get(municipality.toLowerCase().trim()) ?? muniCache.map.get(normalizeMunicipality(municipality));
  return { ok: true, data: hit ?? null, fetchedAt: new Date(now).toISOString() };
}

const Data = z
  .object({
    updated: z.string().optional(),
    value: z.array(z.number().nullable()),
    id: z.array(z.string()),
    size: z.array(z.number()),
    dimension: z.record(z.string(), z.object({ category: z.object({ index: z.record(z.string(), z.number()) }) }).passthrough()),
  })
  .passthrough();

export interface MunicipalityStats {
  period: string;
  updated: string | null;
  values: Array<{ key: string; label: string; value: number | null; unit: string }>;
}

/** Parses a json-stat2 response for ONE region and ONE period. */
export function parseScbStats(raw: unknown): MunicipalityStats | null {
  const p = Data.safeParse(raw);
  if (!p.success) return null;
  const d = p.data;
  const ids = d.id;
  const contentsDim = d.dimension.ContentsCode?.category.index;
  const timeDim = d.dimension.Tid?.category.index;
  if (!contentsDim || !timeDim) return null;
  const period = Object.keys(timeDim)[0];
  if (!period) return null;
  // Row-major strides.
  const strides = ids.map((_, i) => d.size.slice(i + 1).reduce((a, b) => a * b, 1));
  const at = (sel: Record<string, number>) => ids.reduce((acc, id, i) => acc + (sel[id] ?? 0) * strides[i]!, 0);
  const values = SCB_CONTENTS.map((c) => {
    const ci = contentsDim[c.code];
    const v = ci === undefined ? null : d.value[at({ ContentsCode: ci })] ?? null;
    return { key: c.key, label: c.label, value: num(v), unit: c.unit };
  });
  return { period, updated: d.updated ?? null, values };
}

export async function fetchMunicipalityStats(code: string, ctx: AdapterContext): Promise<AdapterResult<MunicipalityStats>> {
  if (!/^\d{4}$/.test(code)) return { ok: false, error: 'invalid_payload', detail: 'scb: bad region code' };
  const q = `lang=sv&outputFormat=json-stat2&valuecodes[Region]=${code}&valuecodes[Kon]=1%2B2&valuecodes[ContentsCode]=*&valuecodes[Tid]=top(1)`;
  const r = await httpJson(`${apiBase(ctx)}/tables/${SCB_TABLE}/data?${q}`, ctx, { label: 'scb_data', timeoutMs: 30_000 });
  if (!r.ok) return r;
  const s = parseScbStats(r.data);
  return s ? { ok: true, data: s, fetchedAt: r.fetchedAt } : { ok: false, error: 'invalid_payload', detail: 'scb_data: schema mismatch' };
}
