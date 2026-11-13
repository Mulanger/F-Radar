import { z } from 'zod';
import { httpJson } from '../http';
import type { AdapterContext, AdapterResult } from '../types';

/**
 * MCF (f.d. MSB) Översvämningsportalen – INSPIRE WFS (verified live 2026-11-13).
 *
 *   https://inspire.msb.se/oversvamning/ows?service=WFS&version=2.0.0&request=GetFeature
 *     &typeNames=oversvamning:NZ_Oversvamning_{100|200|BHF}&outputFormat=application/json
 *     &propertyName=objectid,beginlifespanversion
 *     &CQL_FILTER=BBOX(geom,minLon,minLat,maxLon,maxLat,'EPSG:4326')
 *
 * Findings: features are very large multipolygons (76 nationwide for the 100-year layer), so
 * geometry is NEVER downloaded – only "does a box around the point intersect a mapped area".
 * Default CRS is EPSG:3006, but a CQL BBOX with an explicit 'EPSG:4326' (lon/lat order) works; the
 * plain `bbox=` parameter and INTERSECTS(point) returned no hits during verification.
 * Coverage: only selected watercourses are mapped. "No hit" therefore means "no mapped area
 * within the radius", NOT "no flood risk".
 *
 * Static scenario data: never an alert, never a current water level.
 */
export const MCF_ATTRIBUTION = 'Källa: MCF Översvämningsportalen (översvämningskartering)';
export const MCF_WFS_URL = 'https://inspire.msb.se/oversvamning/ows';
export const MCF_SCENARIOS = [
  { key: 'q100', layer: 'NZ_Oversvamning_100', label: '100-årsflöde' },
  { key: 'q200', layer: 'NZ_Oversvamning_200', label: '200-årsflöde' },
  { key: 'bhf', layer: 'NZ_Oversvamning_BHF', label: 'Beräknat högsta flöde (BHF)' },
] as const;
/** Probe radii (m); the first is treated as "at the point" (address points are not exact). */
export const MCF_RADII = [15, 100, 250, 500, 1000] as const;

const FC = z
  .object({
    numberMatched: z.union([z.number(), z.string()]).optional(),
    features: z.array(z.object({ properties: z.record(z.string(), z.unknown()).nullish() }).passthrough()).default([]),
  })
  .passthrough();

export function mcfBoxFilter(lat: number, lon: number, radiusM: number): string {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return `BBOX(geom,${(lon - dLon).toFixed(6)},${(lat - dLat).toFixed(6)},${(lon + dLon).toFixed(6)},${(lat + dLat).toFixed(6)},'EPSG:4326')`;
}

export function mcfUrl(layer: string, lat: number, lon: number, radiusM: number): string {
  const q = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: `oversvamning:${layer}`,
    outputFormat: 'application/json',
    count: '1',
    propertyName: 'objectid,beginlifespanversion',
    CQL_FILTER: mcfBoxFilter(lat, lon, radiusM),
  });
  return `${MCF_WFS_URL}?${q.toString()}`;
}

export function parseMcfHit(raw: unknown): { hit: boolean; version: string | null } | null {
  const p = FC.safeParse(raw);
  if (!p.success) return null;
  const f = p.data.features[0];
  const v = f?.properties?.beginlifespanversion;
  return { hit: p.data.features.length > 0, version: typeof v === 'string' ? v : null };
}

export interface FloodScenarioProbe {
  scenario: (typeof MCF_SCENARIOS)[number]['key'];
  label: string;
  inside: boolean;
  withinMeters: number | null;
}

/**
 * For each scenario: one query at the max radius; only on a hit, narrow down with smaller radii.
 * Worst case 5 small requests per scenario; typical (no mapped area nearby) 1 per scenario.
 */
export async function probeFloodScenarios(lat: number, lon: number, ctx: AdapterContext): Promise<AdapterResult<{ scenarios: FloodScenarioProbe[]; datasetVersion: string | null }>> {
  const scenarios: FloodScenarioProbe[] = [];
  let version: string | null = null;
  let fetchedAt = ctx.now().toISOString();
  const max = MCF_RADII[MCF_RADII.length - 1];
  for (const s of MCF_SCENARIOS) {
    const ask = async (radius: number) => {
      const r = await httpJson(mcfUrl(s.layer, lat, lon, radius), ctx, { label: `mcf_${s.key}`, timeoutMs: 30_000 });
      if (!r.ok) return r;
      const hit = parseMcfHit(r.data);
      if (!hit) return { ok: false as const, error: 'invalid_payload' as const, detail: `mcf_${s.key}: schema mismatch` };
      fetchedAt = r.fetchedAt;
      version = version ?? hit.version;
      return { ok: true as const, data: hit.hit };
    };
    const outer = await ask(max);
    if (!outer.ok) return outer;
    let within: number | null = null;
    if (outer.data) {
      within = max;
      for (const radius of MCF_RADII.slice(0, -1)) {
        const r = await ask(radius);
        if (!r.ok) return r;
        if (r.data) {
          within = radius;
          break;
        }
      }
    }
    scenarios.push({ scenario: s.key, label: s.label, inside: within !== null && within <= MCF_RADII[0], withinMeters: within });
  }
  return { ok: true, data: { scenarios, datasetVersion: version }, fetchedAt };
}
