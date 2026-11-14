import { z } from 'zod';
import type { OutageKind, OutageState } from '@fastighetsradar/domain';
import { polygonsToGeoJson, swerefPolygonsToLonLat, type LonLat } from '../geometry';
import type { NormalizedUtilityOutage, OutageFetchResult, UtilityOperator } from '../types';

/**
 * E.ON Energidistribution – https://avbrott.eon.se (decoded 2026-11-14 from the map's own bundle):
 *  - conf/h01_config.json → { path } ; <path>/outstat.bin = 52-byte little-endian records:
 *      u32 addr (bytes: län, kommun, nätområde, 0), u32 outage id, u16 planned flag, u16 fault flag,
 *      u32 affected (planned), u32 affected (fault), then a 256-bit map of affected station areas ("nst").
 *  - conf/h02_config.json → { path } ; <path>/<outageId>.json = { t: 'D' fault | other planned, ts (s),
 *      ca current affected, ma max affected, tc estimated completion (s), cmnt, evts[] }.
 *  - conf/res.json → { g } ; static_geom/<g>/01/<län>/<kommun>/<nätområde>.json = { display_name,
 *      sub_areas: { <nst>: { display_name, geometry (EPSG:3006) } } }.
 * Station areas are village/district sized → precision 'area' (dashboard only, never SMS).
 */
export interface EonRecord {
  addr: string;
  /** "01/LL/KK/FF" – geometry file of the network area. */
  areaPath: string;
  outageId: number;
  planned: boolean;
  fault: boolean;
  affected: number;
  stationAreas: string[];
}

export const EON_RECORD_BYTES = 52;

export function decodeEonOutstat(buf: Buffer): EonRecord[] | null {
  if (buf.length % EON_RECORD_BYTES !== 0) return null;
  const out: EonRecord[] = [];
  for (let o = 0; o < buf.length; o += EON_RECORD_BYTES) {
    const addr = ('00000000' + buf.readUInt32LE(o).toString(16)).slice(-8);
    const subs: string[] = [];
    for (let i = 0; i < 32; i++) {
      const byte = buf[o + 20 + i]!;
      for (let bit = 0; bit < 8; bit++) if ((byte >> bit) & 1) subs.push(('00' + (i * 8 + bit).toString(16)).slice(-2));
    }
    const p = buf.readUInt16LE(o + 8);
    const d = buf.readUInt16LE(o + 10);
    const acp = buf.readUInt32LE(o + 12);
    const acd = buf.readUInt32LE(o + 16);
    out.push({
      addr,
      areaPath: ['01', addr.slice(0, 2), addr.slice(2, 4), addr.slice(4, 6)].join('/'),
      outageId: buf.readUInt32LE(o + 4),
      planned: p > 0,
      fault: d > 0,
      affected: acp === 0 ? acd : acp,
      stationAreas: subs,
    });
  }
  return out;
}

export const EonDetail = z
  .object({
    t: z.string(),
    ts: z.number().nullish(),
    ca: z.number().nullish(),
    ma: z.number().nullish(),
    tc: z.number().nullish(),
    cmnt: z.string().nullish(),
  })
  .passthrough();

export const EonAreaGeom = z
  .object({
    display_name: z.string().nullish(),
    sub_areas: z.record(z.string(), z.object({ display_name: z.string().nullish(), geometry: z.unknown() }).passthrough()).nullish(),
  })
  .passthrough();

/** The map rewrites `,[{"c"` to `,"evts":[{"c"` before parsing (malformed upstream JSON). */
export function parseEonDetailText(text: string): unknown {
  try {
    return JSON.parse(text.replace(/,\[\{"c"/g, ',"evts":[{"c"'));
  } catch {
    return undefined;
  }
}

const sec = (v: number | null | undefined) => (typeof v === 'number' && v > 0 ? new Date(v * 1000).toISOString() : null);

export function parseEon(
  records: EonRecord[],
  details: Map<number, unknown>,
  areas: Map<string, unknown>,
  op: UtilityOperator,
  now: Date,
): OutageFetchResult {
  const byOutage = new Map<number, EonRecord[]>();
  for (const r of records) {
    if (!byOutage.has(r.outageId)) byOutage.set(r.outageId, []);
    byOutage.get(r.outageId)!.push(r);
  }
  const outages: NormalizedUtilityOutage[] = [];
  let skipped = 0;
  for (const [id, recs] of byOutage) {
    const det = EonDetail.safeParse(details.get(id));
    const polys: LonLat[][][] = [];
    const labels: string[] = [];
    for (const r of recs) {
      const g = EonAreaGeom.safeParse(areas.get(r.areaPath));
      if (!g.success || !g.data.sub_areas) continue;
      const keys = r.stationAreas.length ? r.stationAreas : Object.keys(g.data.sub_areas);
      for (const k of keys) {
        const sa = g.data.sub_areas[k];
        const p = sa ? swerefPolygonsToLonLat(sa.geometry as { type?: string; coordinates?: unknown }) : null;
        if (p) {
          polys.push(...p);
          if (sa?.display_name) labels.push(sa.display_name);
        }
      }
    }
    const geometry = polygonsToGeoJson(polys);
    if (!det.success || !geometry) {
      skipped++;
      continue;
    }
    const d = det.data;
    const kind: OutageKind = d.t === 'D' ? 'unplanned' : recs.some((r) => r.planned) ? 'planned' : 'unknown';
    const start = sec(d.ts);
    const state: OutageState = kind === 'planned' && start && Date.parse(start) > now.getTime() ? 'upcoming' : 'ongoing';
    const planned = kind === 'planned';
    const affected = d.ca && d.ca > 0 ? Math.round(d.ca) : recs.reduce((a, r) => a + r.affected, 0) || null;
    outages.push({
      operatorId: op.id,
      utility: 'electricity',
      externalId: `${op.id}:${id}`,
      kind,
      state,
      affectedCustomers: affected,
      areaCustomerTotal: null,
      reportedAt: null,
      plannedStart: planned ? start : null,
      plannedEnd: planned ? sec(d.tc) : null,
      actualStart: state === 'upcoming' ? null : start,
      estimatedRestore: planned ? null : sec(d.tc),
      restoredAt: null,
      precision: 'area',
      geometry,
      addresses: null,
      postalCodes: [],
      municipalityCode: null,
      placeLabel: [...new Set(labels)].slice(0, 4).join(', ') || null,
      operatorText: d.cmnt?.trim() || null,
      cause: null,
      sourceUrl: op.mapUrl,
      upstream: { t: d.t, records: recs.length },
    });
  }
  return { outages, skipped, ignored: 0, sourceUpdatedAt: null };
}
