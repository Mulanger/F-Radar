import type { OutageKind, OutageState, UtilityKind } from '@fastighetsradar/domain';
import { looksLikeKml, parseKmlPlacemarks, polygonsToGeoJson, type KmlPlacemark } from '../geometry';
import { parseSwedishLocal } from '../time';
import type { ConcessionArea, NormalizedUtilityOutage, OutageFetchResult } from '../types';

/**
 * Digpro dpPower outage map KML (outagemap2). Used directly by many small/medium grid operators and,
 * behind its own proxy, by Göteborg Energi. Fields per Placemark (ExtendedData):
 *   status, type (1 = planned, 2 = fault), current/previously/future_affected_customers,
 *   occurred, reported, planned_occurred_time, planned_restored_time, restored,
 *   planned_not_started, planned_no_affected_customers, outage_id, outage_oid, note_external,
 *   (Göteborg) component_cause, simplified_cause.
 *
 * State is derived from fields, NOT from styleUrl: verified 2026-11-14 that `#active_outage` can carry
 * a past `restored` time. Rules:
 *   restored ≤ now                         → restored
 *   planned & (planned_not_started | start > now) → upcoming, else ongoing
 *   fault                                   → ongoing
 * Planned work flagged `planned_no_affected_customers=true` is ignored (no customer is cut off).
 */
const int = (v: string | undefined) => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const text = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
/** Planned work past its planned end by more than this, with no restored time, is not shown as ongoing. */
export const STALE_PLANNED_MS = 24 * 3_600_000;

export interface DigproParseOptions {
  operatorId: string;
  utility: UtilityKind;
  mapUrl: string;
  now: Date;
  /** External id prefix (defaults to operatorId); heating layers use `<operatorId>:dh`. */
  externalPrefix?: string;
}

export function digproPlacemarkToOutage(pm: KmlPlacemark, o: DigproParseOptions): NormalizedUtilityOutage | 'skip' | 'ignore' {
  const d = pm.data;
  const upstreamId = text(d.outage_id) ?? text(d.outage_oid);
  if (!upstreamId) return 'skip';
  if (d.planned_no_affected_customers === 'true') return 'ignore';
  const geometry = pm.polygons.length ? polygonsToGeoJson(pm.polygons) : pm.points.length ? { type: 'Point' as const, coordinates: pm.points[0] } : null;
  if (!geometry) return 'skip';

  const type = text(d.type);
  const kind: OutageKind = type === '1' ? 'planned' : type === '2' ? 'unplanned' : 'unknown';
  const occurred = parseSwedishLocal(d.occurred);
  const plannedStart = parseSwedishLocal(d.planned_occurred_time);
  const plannedEnd = parseSwedishLocal(d.planned_restored_time);
  const restored = parseSwedishLocal(d.restored);
  const nowMs = o.now.getTime();
  // Unparseable non-empty times are a data problem → skip rather than guess.
  for (const [raw, parsed] of [[d.occurred, occurred], [d.planned_occurred_time, plannedStart], [d.planned_restored_time, plannedEnd], [d.restored, restored]] as const) {
    if (text(raw) && !parsed) return 'skip';
  }

  let state: OutageState;
  if (restored && Date.parse(restored) <= nowMs) state = 'restored';
  else if (kind === 'planned') {
    const start = plannedStart ?? occurred;
    state = d.planned_not_started === 'true' || (start !== null && Date.parse(start) > nowMs) ? 'upcoming' : 'ongoing';
    // Seen live (Lerum 2026-11-14): planned work still "ongoing" 11 days after its planned end and
    // without a restored time. Do not present that as an ongoing outage – mark it unknown (panel only).
    if (state === 'ongoing' && plannedEnd && Date.parse(plannedEnd) < nowMs - STALE_PLANNED_MS) state = 'unknown';
  } else if (kind === 'unplanned') state = 'ongoing';
  else state = occurred && Date.parse(occurred) <= nowMs ? 'ongoing' : 'unknown';

  const customers =
    state === 'upcoming' ? int(d.future_affected_customers) : state === 'ongoing' ? int(d.current_affected_customers) ?? int(d.future_affected_customers) : int(d.previously_affected_customers);
  const planned = kind === 'planned';
  return {
    operatorId: o.operatorId,
    utility: o.utility,
    externalId: `${o.externalPrefix ?? o.operatorId}:${upstreamId}`,
    kind,
    state,
    affectedCustomers: customers,
    areaCustomerTotal: null,
    reportedAt: parseSwedishLocal(d.reported),
    plannedStart: planned ? (plannedStart ?? occurred) : null,
    plannedEnd: planned ? plannedEnd : null,
    actualStart: state === 'upcoming' ? null : occurred,
    estimatedRestore: planned ? null : plannedEnd,
    restoredAt: state === 'restored' ? restored : null,
    precision: pm.polygons.length ? 'polygon' : 'point',
    geometry,
    addresses: null,
    postalCodes: [],
    municipalityCode: null,
    placeLabel: null,
    operatorText: text(d.note_external),
    cause: text(d.simplified_cause),
    sourceUrl: o.mapUrl,
    upstream: { status: text(d.status), type, style: pm.styleUrl },
  };
}

export function parseDigproKml(kml: string, o: DigproParseOptions): OutageFetchResult | null {
  if (!looksLikeKml(kml)) return null;
  const outages: NormalizedUtilityOutage[] = [];
  let skipped = 0;
  let ignored = 0;
  for (const pm of parseKmlPlacemarks(kml)) {
    if (pm.invalidGeometry && !pm.polygons.length && !pm.points.length) {
      skipped++;
      continue;
    }
    const r = digproPlacemarkToOutage(pm, o);
    if (r === 'skip') skipped++;
    else if (r === 'ignore') ignored++;
    else outages.push(r);
  }
  // The same outage can appear twice (e.g. merged active + inactive Göteborg feeds): keep the latest state.
  const byId = new Map<string, NormalizedUtilityOutage>();
  for (const x of outages) {
    const prev = byId.get(x.externalId);
    if (!prev || (prev.state !== 'restored' && x.state === 'restored')) byId.set(x.externalId, x);
  }
  return { outages: [...byId.values()], skipped, ignored, sourceUpdatedAt: null };
}

/** Concession KML → polygons. */
export function parseConcessionKml(kml: string): ConcessionArea[] | null {
  if (!looksLikeKml(kml)) return null;
  const out: ConcessionArea[] = [];
  for (const pm of parseKmlPlacemarks(kml)) {
    const geometry = polygonsToGeoJson(pm.polygons);
    if (geometry) out.push({ externalRef: pm.data.name ?? null, geometry });
  }
  return out;
}
