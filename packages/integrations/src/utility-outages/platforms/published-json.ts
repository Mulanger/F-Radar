import { z } from 'zod';
import type { OutageKind, OutageState, UtilityKind } from '@fastighetsradar/domain';
import type { GeoJsonGeometry } from '../../types';
import { closeRing, inSweden, polygonsToGeoJson, type LonLat } from '../geometry';
import { parseSwedishLocal } from '../time';
import type { NormalizedUtilityOutage, OutageFetchResult, UtilityOperator } from '../types';
import { polygonsFromGeoJson } from './tekniskaverken';
import { htmlToText } from './servicealert';

/** These APIs publish naive Swedish local ISO times, sometimes with fractional seconds. */
export function publishedLocalTime(value: string | null | undefined): string | null {
  if (!value || /^0001-/.test(value)) return null;
  if (/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  return parseSwedishLocal(value.replace(/(\d{2}:\d{2}:\d{2})\.\d+$/, '$1'));
}

function geometryOf(raw: unknown): GeoJsonGeometry | null {
  const g = raw as { type?: string; coordinates?: unknown } | null;
  if (g?.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    const point: LonLat = [Number(g.coordinates[0]), Number(g.coordinates[1])];
    return inSweden(point) ? { type: 'Point', coordinates: point } : null;
  }
  const polygons = polygonsFromGeoJson(raw);
  return polygons?.every((p) => p.every((r) => r.every(inSweden))) ? polygonsToGeoJson(polygons) : null;
}

function base(op: UtilityOperator, id: string, utility: UtilityKind, kind: OutageKind, state: OutageState, geometry: GeoJsonGeometry): NormalizedUtilityOutage {
  return {
    operatorId: op.id, externalId: `${op.id}:${id}`, utility, kind, state, geometry,
    precision: geometry.type === 'Point' ? 'point' : 'polygon',
    affectedCustomers: null, areaCustomerTotal: null, reportedAt: null, plannedStart: null, plannedEnd: null,
    actualStart: null, estimatedRestore: null, restoredAt: null, addresses: null, postalCodes: [], municipalityCode: null,
    placeLabel: null, operatorText: null, cause: null, sourceUrl: op.mapUrl, upstream: {},
  };
}

const UmeaRow = z.object({
  id: z.number().int(), domain: z.number().int(), state: z.number().int(), type: z.number().int(),
  startDate: z.string().nullish(), endDate: z.string().nullish(), affectedCount: z.number().nonnegative().nullish(),
  title: z.string().nullish(), message: z.string().nullish(), geoCoordinates: z.unknown(), geoCoordinatesHistory: z.unknown().optional(),
}).passthrough();

/** Map bundle: domain 0 power, 2 heat, 3 cooling; state 0 restored, 1 active, 2 planned; type 0 planned, 1 fault. */
export function parseUmea(raw: unknown, op: UtilityOperator, now: Date): OutageFetchResult | null {
  if (!Array.isArray(raw)) return null;
  const result: OutageFetchResult = { outages: [], skipped: 0, ignored: 0, sourceUpdatedAt: null };
  for (const item of raw) {
    const parsed = UmeaRow.safeParse(item);
    if (!parsed.success) { result.skipped++; continue; }
    const row = parsed.data;
    const utility = ({ 0: 'electricity', 2: 'district_heating', 3: 'district_cooling' } as Record<number, UtilityKind | undefined>)[row.domain];
    if (!utility || !op.utilities.includes(utility)) { result.ignored++; continue; }
    const kind: OutageKind = row.type === 0 ? 'planned' : row.type === 1 ? 'unplanned' : 'unknown';
    const start = publishedLocalTime(row.startDate), end = publishedLocalTime(row.endDate);
    let state: OutageState = row.state === 0 ? 'restored' : row.state === 1 ? 'ongoing' : row.state === 2 && kind === 'planned' && start ? (Date.parse(start) > now.getTime() ? 'upcoming' : 'ongoing') : 'unknown';
    if (state === 'ongoing' && kind === 'planned' && end && Date.parse(end) < now.getTime() - 86_400_000) state = 'unknown';
    const geometry = geometryOf(row.geoCoordinates) ?? (state === 'restored' ? geometryOf(row.geoCoordinatesHistory) : null);
    if (!geometry) { result.skipped++; continue; }
    const outage = base(op, String(row.id), utility, kind, state, geometry);
    result.outages.push({ ...outage,
      affectedCustomers: row.affectedCount && row.affectedCount > 0 ? row.affectedCount : null,
      plannedStart: kind === 'planned' ? start : null, plannedEnd: kind === 'planned' ? end : null,
      actualStart: state !== 'upcoming' ? start : null, estimatedRestore: state !== 'restored' ? end : null,
      restoredAt: state === 'restored' ? end : null,
      operatorText: htmlToText(row.message), placeLabel: row.title ?? null,
      upstream: { state: row.state, type: row.type, domain: row.domain },
    });
  }
  return result;
}

const SkekraftPayload = z.object({ count: z.number().int().nonnegative(), total: z.number().int().nonnegative(), results: z.array(z.unknown()) }).passthrough();
const LatLng = z.object({ lat: z.number(), lng: z.number() });
const SkekraftRow = z.object({
  Id: z.union([z.string().min(1), z.number().int()]), Type: z.number().int(), Status: z.number().int(), Fixed: z.boolean(),
  StartDate: z.string().nullish(), StopDate: z.string().nullish(), PlannedStopDate: z.string().nullish(),
  AffectedCustomers: z.number().nonnegative().nullish(), CoordinatesLatLng: z.array(LatLng).nullish(), PointLatLng: LatLng.nullish(), Description: z.string().nullish(),
}).passthrough();

/** Map's public response: Type 1 planned / 2 fault; Fixed + Status 4 is explicit restoration, Status 2 ongoing. */
export function parseSkekraft(raw: unknown, op: UtilityOperator): OutageFetchResult | null {
  const payload = SkekraftPayload.safeParse(raw);
  if (!payload.success || payload.data.count < payload.data.results.length) return null;
  // total is the whole historical archive (18k+), count is the current returned scope.
  const result: OutageFetchResult = { outages: [], skipped: Math.max(0, payload.data.count - payload.data.results.length), ignored: 0, sourceUpdatedAt: null };
  for (const item of payload.data.results) {
    const parsed = SkekraftRow.safeParse(item);
    if (!parsed.success) { result.skipped++; continue; }
    const row = parsed.data;
    const kind: OutageKind = row.Type === 1 ? 'planned' : row.Type === 2 ? 'unplanned' : 'unknown';
    const state: OutageState = row.Fixed && row.Status === 4 ? 'restored' : !row.Fixed && row.Status === 2 ? 'ongoing' : 'unknown';
    const ring = row.CoordinatesLatLng?.length ? closeRing(row.CoordinatesLatLng.map((p) => [p.lng, p.lat] as LonLat)) : null;
    const geometry = ring && ring.every(inSweden) ? { type: 'Polygon' as const, coordinates: [ring] }
      : !row.CoordinatesLatLng?.length && row.PointLatLng && inSweden([row.PointLatLng.lng, row.PointLatLng.lat])
        ? { type: 'Point' as const, coordinates: [row.PointLatLng.lng, row.PointLatLng.lat] } : null;
    if (!geometry) { result.skipped++; continue; }
    const start = publishedLocalTime(row.StartDate), end = publishedLocalTime(row.StopDate), estimated = publishedLocalTime(row.PlannedStopDate);
    const outage = base(op, String(row.Id), 'electricity', kind, state, geometry);
    result.outages.push({ ...outage, affectedCustomers: row.AffectedCustomers && row.AffectedCustomers > 0 ? row.AffectedCustomers : null,
      plannedStart: kind === 'planned' ? start : null, plannedEnd: kind === 'planned' ? estimated : null,
      actualStart: start, estimatedRestore: state !== 'restored' ? estimated : null, restoredAt: state === 'restored' ? end : null,
      operatorText: htmlToText(row.Description), upstream: { status: row.Status, type: row.Type },
    });
  }
  return result;
}
