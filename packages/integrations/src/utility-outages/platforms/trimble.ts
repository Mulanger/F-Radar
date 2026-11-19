import { z } from 'zod';
import type { OutageKind, OutageState } from '@fastighetsradar/domain';
import { closeRing, inSweden, polygonsToGeoJson, type LonLat } from '../geometry';
import type { NormalizedUtilityOutage, OutageFetchResult, UtilityOperator } from '../types';

/**
 * Trimble (Tekla) NIS outage map – `<base>/geoserver-api/...` (Mälarenergi, Jämtkraft, Sundsvall, Gävle;
 * verified 2026-11-14 from the maps' own code and configuration):
 *  - GetApplicationData → JSON *string*; scopes.<scope>.outages[{ id, t, cc, starttime, plannedstart,
 *    plannedend, estendtime, reason, estimatedescr }] with t: 'f' fault, 'p' planned ongoing, 'u' upcoming
 *    (configuration tooltips: "Oplanerat avbrott" / "Planerat avbrott" / "Framtida avbrott"); times epoch ms, 0 = none.
 *  - content/StaticObjects → operating districts: features[__type 'Area:#Tekla…', path [{x: lon, y: lat}],
 *    context {_id, _nt: scope, t: 'a'}, label, BoundingBox].
 *  - GetObjectsByTiles?zoom=10&tiles=… → points; context t 'po' = network station with `oid`/`cc` (current
 *    outage) and `us` [{oid, cc}] (upcoming outages).
 * Each outage is tied to the smallest district containing an affected station → precision 'area'
 * (dashboard only, never SMS). Stations themselves are not customer locations.
 */
export const TrimbleOutage = z
  .object({
    id: z.number().int(),
    t: z.string(),
    cc: z.number().nullish(),
    starttime: z.number().nullish(),
    plannedstart: z.number().nullish(),
    plannedend: z.number().nullish(),
    estendtime: z.number().nullish(),
    reason: z.string().nullish(),
    estimatedescr: z.string().nullish(),
  })
  .passthrough();
const Area = z
  .object({
    __type: z.string(),
    context: z.string(),
    label: z.string().nullish(),
    path: z.array(z.object({ x: z.number(), y: z.number() })),
  })
  .passthrough();

export interface TrimbleDistrict {
  id: number;
  label: string;
  ring: LonLat[];
  /** bbox area in deg² – used to pick the smallest containing district. */
  size: number;
}

/** Districts of one scope from StaticObjects. */
export function trimbleDistricts(staticObjects: unknown, scope: string, publishedIds?: ReadonlySet<number>): TrimbleDistrict[] | null {
  const features = (staticObjects as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return null;
  const out: TrimbleDistrict[] = [];
  for (const raw of features) {
    const a = Area.safeParse(raw);
    if (!a.success || !a.data.__type.startsWith('Area')) continue;
    let ctx: { _id?: number; _nt?: string; t?: string };
    try {
      ctx = JSON.parse(a.data.context);
    } catch {
      continue;
    }
    if (typeof ctx._id !== 'number' || (publishedIds ? !publishedIds.has(ctx._id) : ctx._nt !== scope)) continue;
    const ring = closeRing(a.data.path.map((p) => [p.x, p.y] as LonLat));
    if (!ring) continue;
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    out.push({ id: ctx._id, label: (a.data.label ?? '').replace(/_+$/, '').trim(), ring, size: (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) });
  }
  return out;
}

/** Ray-casting point-in-ring (lon/lat). */
export function pointInRing([x, y]: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Outage id → affected station coordinates, from GetObjectsByTiles points. */
export function trimbleStations(tilePayloads: unknown[], scope?: string): Map<number, LonLat[]> {
  const byOutage = new Map<number, LonLat[]>();
  const add = (oid: unknown, p: LonLat) => {
    if (typeof oid !== 'number' || oid <= 0 || !inSweden(p)) return;
    if (!byOutage.has(oid)) byOutage.set(oid, []);
    byOutage.get(oid)!.push(p);
  };
  for (const payload of tilePayloads) {
    const points = (payload as { points?: unknown[] })?.points;
    if (!Array.isArray(points)) continue;
    for (const raw of points) {
      const pt = raw as { context?: string; x?: number; y?: number };
      if (typeof pt.context !== 'string' || typeof pt.x !== 'number' || typeof pt.y !== 'number') continue;
      let ctx: Record<string, unknown>;
      try {
        ctx = JSON.parse(pt.context);
      } catch {
        continue;
      }
      if (ctx.t !== 'po' || scope && ctx._nt !== scope) continue;
      const p: LonLat = [pt.x, pt.y];
      add(ctx.oid, p);
      for (const v of Object.values(ctx)) if (Array.isArray(v)) for (const e of v) add((e as { oid?: unknown })?.oid, p);
    }
  }
  return byOutage;
}

/** Zoom-10 tile ranges ("from-to" per row, id = y·1024 + x) covering the districts' extent. */
export function trimbleTileRanges(districts: TrimbleDistrict[]): string[] {
  if (!districts.length) return [];
  const n = 1024;
  const xs = districts.flatMap((d) => d.ring.map((p) => p[0]));
  const ys = districts.flatMap((d) => d.ring.map((p) => p[1]));
  const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const ty = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  const [x0, x1] = [tx(Math.min(...xs)), tx(Math.max(...xs))];
  const [y0, y1] = [ty(Math.max(...ys)), ty(Math.min(...ys))];
  const rows: string[] = [];
  for (let y = y0; y <= y1; y++) rows.push(`${y * n + x0}-${y * n + x1}`);
  return rows;
}

const ms = (v: number | null | undefined) => (typeof v === 'number' && v > 0 ? new Date(v).toISOString() : null);

export function parseTrimble(appData: unknown, districts: TrimbleDistrict[], stations: Map<number, LonLat[]>, op: UtilityOperator & { platform: 'trimble' }, now: Date): OutageFetchResult | null {
  let j: unknown = appData;
  try {
    if (typeof j === 'string') j = JSON.parse(j);
  } catch {
    return null;
  }
  const scope = (j as { scopes?: Record<string, { outages?: unknown }> })?.scopes?.[op.scope];
  if (!scope) return null;
  if (!Array.isArray(scope.outages)) return null;
  const outages: NormalizedUtilityOutage[] = [];
  let skipped = 0;
  const unknown = new Set<string>();
  for (const raw of scope.outages) {
    const r = TrimbleOutage.safeParse(raw);
    if (!r.success) {
      skipped++;
      continue;
    }
    const o = r.data;
    const pts = stations.get(o.id) ?? [];
    const chosen = new Map<number, TrimbleDistrict>();
    for (const p of pts) {
      const d = districts.filter((x) => pointInRing(p, x.ring)).sort((a, b) => a.size - b.size)[0];
      if (d) chosen.set(d.id, d);
    }
    const geometry = polygonsToGeoJson([...chosen.values()].map((d) => [d.ring]));
    if (!geometry) {
      skipped++;
      continue;
    }
    let kind: OutageKind;
    let state: OutageState;
    const plannedStart = ms(o.plannedstart);
    if (o.t === 'f') [kind, state] = ['unplanned', 'ongoing'];
    else if (o.t === 'p') [kind, state] = ['planned', 'ongoing'];
    else if (o.t === 'u') [kind, state] = ['planned', plannedStart && Date.parse(plannedStart) <= now.getTime() ? 'ongoing' : 'upcoming'];
    else {
      unknown.add(o.t);
      [kind, state] = ['unknown', 'unknown'];
    }
    const planned = kind === 'planned';
    outages.push({
      operatorId: op.id,
      utility: op.utilities[0]!,
      externalId: `${op.id}${op.utilities[0] === 'electricity' ? '' : `:${op.utilities[0]}`}:${o.id}`,
      kind,
      state,
      affectedCustomers: o.cc && o.cc > 0 ? Math.round(o.cc) : null,
      areaCustomerTotal: null,
      reportedAt: null,
      plannedStart: planned ? (plannedStart ?? ms(o.starttime)) : null,
      plannedEnd: planned ? (ms(o.plannedend) ?? ms(o.estendtime)) : null,
      actualStart: state === 'upcoming' ? null : ms(o.starttime) ?? (planned ? plannedStart : null),
      estimatedRestore: planned ? null : ms(o.estendtime),
      restoredAt: null,
      precision: 'area',
      geometry,
      addresses: null,
      postalCodes: [],
      municipalityCode: null,
      placeLabel: [...chosen.values()].map((d) => d.label).filter(Boolean).join(', ') || null,
      operatorText: o.reason?.trim() || null,
      cause: o.estimatedescr?.trim() || null,
      sourceUrl: op.mapUrl,
      upstream: { t: o.t, stations: pts.length },
    });
  }
  return { outages, skipped, ignored: 0, sourceUpdatedAt: null, ...(unknown.size ? { unknownStatusCodes: [...unknown] } : {}) };
}
