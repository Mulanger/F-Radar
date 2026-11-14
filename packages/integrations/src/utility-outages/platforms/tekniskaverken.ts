import { z } from 'zod';
import type { OutageKind, OutageState } from '@fastighetsradar/domain';
import { iso } from '../../http';
import { closeRing, polygonsToGeoJson, type LonLat } from '../geometry';
import type { NormalizedUtilityOutage, OutageFetchResult, UtilityOperator } from '../types';

/**
 * Tekniska verken (Linköping) – https://avbrott.tekniskaverken.se/api/service-information (verified
 * 2026-11-14 from the map's own code):
 *  - GET  outage/list/?utility=electricity&brand=tekniskaverken → { outages: [...] }
 *  - POST outage/shapes/ { ids: [outageId] } → { outages: [{ outageId, geoJson: Feature(GeometryCollection|Polygon) }] }
 * Status enum from the map: Scheduled | Active | Completed | Cancelled | Unknown; `planned` boolean.
 * Times are ISO-8601 UTC. Precision: polygon.
 */
export const TvList = z.object({ outages: z.array(z.unknown()) }).passthrough();
export const TvShapes = z.object({ outages: z.array(z.object({ outageId: z.string(), geoJson: z.unknown() }).passthrough()) }).passthrough();
const Outage = z
  .object({
    outageId: z.string().min(1),
    utility: z.string(),
    status: z.string(),
    planned: z.boolean().nullish(),
    plannedStartTime: z.string().nullish(),
    estimatedCompletionTime: z.string().nullish(),
    startedTime: z.string().nullish(),
    completedTime: z.string().nullish(),
    registeredTime: z.string().nullish(),
    affectedCustomers: z.number().nullish(),
    affectedSites: z.number().nullish(),
    mainAreaAffected: z.string().nullish(),
    instructions: z.object({ textInstructions: z.array(z.string()).nullish() }).passthrough().nullish(),
  })
  .passthrough();

/** Polygons from a GeoJSON Feature/geometry (Polygon, MultiPolygon or GeometryCollection of those). */
export function polygonsFromGeoJson(g: unknown): LonLat[][][] | null {
  const geom = (g as { type?: string; geometry?: unknown })?.type === 'Feature' ? (g as { geometry: unknown }).geometry : g;
  const out: LonLat[][][] = [];
  const visit = (x: unknown): boolean => {
    const t = x as { type?: string; coordinates?: unknown; geometries?: unknown[] };
    if (t?.type === 'GeometryCollection') return (t.geometries ?? []).every(visit);
    const polys = t?.type === 'Polygon' ? [t.coordinates] : t?.type === 'MultiPolygon' ? (t.coordinates as unknown[]) : null;
    if (!polys) return t?.type === 'Point' || t?.type === 'LineString' || t?.type === 'MultiPoint' || t?.type === 'MultiLineString';
    for (const poly of polys) {
      if (!Array.isArray(poly)) return false;
      const rings: LonLat[][] = [];
      for (const ring of poly) {
        const closed = Array.isArray(ring) ? closeRing(ring.map((p) => [Number(p?.[0]), Number(p?.[1])] as LonLat)) : null;
        if (!closed) return false;
        rings.push(closed);
      }
      out.push(rings);
    }
    return true;
  };
  return visit(geom) && out.length ? out : null;
}

export function parseTekniskaVerken(list: unknown, shapes: unknown, op: UtilityOperator, now: Date): OutageFetchResult | null {
  const l = TvList.safeParse(list);
  const s = TvShapes.safeParse(shapes);
  if (!l.success || !s.success) return null;
  const geoms = new Map(s.data.outages.map((x) => [x.outageId, x.geoJson]));
  const outages: NormalizedUtilityOutage[] = [];
  let skipped = 0;
  let ignored = 0;
  for (const raw of l.data.outages) {
    const r = Outage.safeParse(raw);
    if (!r.success) {
      skipped++;
      continue;
    }
    const o = r.data;
    const utility = ({ Electricity: 'electricity', DistrictHeating: 'district_heating', DistrictCooling: 'district_cooling' } as const)[o.utility as 'Electricity'];
    if (!utility || !op.utilities.includes(utility)) {
      ignored++; // water, fiber and waste are out of scope.
      continue;
    }
    const polys = polygonsFromGeoJson(geoms.get(o.outageId));
    const geometry = polys ? polygonsToGeoJson(polys) : null;
    if (!geometry) {
      skipped++;
      continue;
    }
    const planned = o.planned === true;
    const kind: OutageKind = o.planned === true ? 'planned' : o.planned === false ? 'unplanned' : 'unknown';
    const plannedStart = iso(o.plannedStartTime);
    const started = iso(o.startedTime);
    const completed = iso(o.completedTime);
    let state: OutageState;
    switch (o.status) {
      case 'Completed':
        state = 'restored';
        break;
      case 'Cancelled':
        state = 'withdrawn';
        break;
      case 'Active':
        state = 'ongoing';
        break;
      case 'Scheduled':
        state = planned && plannedStart && Date.parse(plannedStart) > now.getTime() ? 'upcoming' : planned ? 'ongoing' : 'unknown';
        break;
      default:
        state = 'unknown';
    }
    const estimate = iso(o.estimatedCompletionTime);
    outages.push({
      operatorId: op.id,
      utility,
      externalId: `${op.id}:${o.outageId}`,
      kind,
      state,
      affectedCustomers: o.affectedCustomers && o.affectedCustomers > 0 ? Math.round(o.affectedCustomers) : o.affectedSites && o.affectedSites > 0 ? Math.round(o.affectedSites) : null,
      areaCustomerTotal: null,
      reportedAt: iso(o.registeredTime),
      plannedStart: planned ? plannedStart : null,
      plannedEnd: planned ? estimate : null,
      actualStart: state === 'upcoming' ? null : (started ?? (planned ? plannedStart : null)),
      estimatedRestore: planned ? null : estimate,
      restoredAt: state === 'restored' ? completed : null,
      precision: 'polygon',
      geometry,
      addresses: null,
      postalCodes: [],
      municipalityCode: null,
      placeLabel: o.mainAreaAffected?.trim() || null,
      operatorText: o.instructions?.textInstructions?.filter((x) => x.trim()).join(' ') || null,
      cause: null,
      sourceUrl: op.mapUrl,
      upstream: { status: o.status, planned: o.planned ?? null },
    });
  }
  return { outages, skipped, ignored, sourceUpdatedAt: null };
}
