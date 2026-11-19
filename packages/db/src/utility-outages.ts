import { createHash } from 'node:crypto';
import {
  isPositionConfirmed,
  matchAddressList,
  type OutageAddress,
  outageEffectiveSeverity,
  outageVanished,
  outageFeedTitle,
  outageHeadline,
  outageMatchLevel,
  type OutageKind,
  type OutageMatchMethod,
  type OutagePrecision,
  type OutageState,
  type UtilityKind,
  type UtilityNoticeKind,
} from '@fastighetsradar/domain';
import type { Queryable } from './migrations';
import type { MatchChange } from './monitoring';

/**
 * Storage, lifecycle and per-property matching for grid operators' outages
 * (docs/plans/stromavbrott.md §5.3–5.5).
 *
 *  - Each outage = one `source_events` row (source 'utility_outages', data class UTILITY_OUTAGE)
 *    plus a 1:1 `utility_outages` row with typed fields.
 *  - Versions change only on state/kind/utility or a material time change (planned window rounded to
 *    15 min, estimated restore rounded to 30 min). Customer counts, geometry and text never bump the
 *    version, so the feed is not flooded with "Uppdaterad" rows every poll.
 *  - An outage missing from a COMPLETE fetch is ended only after 2 consecutive misses.
 *  - Matching is purely geographic and independent of concession areas.
 */

export const UTILITY_OUTAGE_SOURCE = 'utility_outages';
/** Outside the polygon but within this distance → shown in the property panel only. */
export const OUTAGE_ADJACENT_M = 25;
/** Point-only outages (usually 1–few customers) within this distance → panel only. */
export const OUTAGE_POINT_RADIUS_M = 30;
export const OUTAGE_MISSING_POLLS_TO_END = 2;
/** Restored/withdrawn outages stay matched (panel "nyligen återställt") this long. */
export const OUTAGE_RECENT_HOURS = 24;
export const OUTAGE_RETENTION_DAYS = 30;

export interface UtilityOutageInput {
  noticeKind?: UtilityNoticeKind;
  operatorId: string;
  operatorName: string;
  utility: UtilityKind;
  externalId: string;
  kind: OutageKind;
  state: OutageState;
  affectedCustomers: number | null;
  areaCustomerTotal: number | null;
  reportedAt: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  estimatedRestore: string | null;
  restoredAt: string | null;
  precision: OutagePrecision;
  geometry: unknown | null;
  addresses: unknown | null;
  postalCodes: string[];
  municipalityCode: string | null;
  placeLabel: string | null;
  operatorText: string | null;
  cause: string | null;
  sourceUrl: string | null;
  attribution: string;
  /** Address-list outages: properties within this circle are compared by street address. */
  addressArea?: { lat: number; lon: number; radiusM: number } | null;
}

const round = (iso: string | null, minutes: number) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const step = minutes * 60_000;
  return new Date(Math.round(t / step) * step).toISOString();
};

/** Material version of an outage (see module doc). */
export function outageVersionHash(o: Pick<UtilityOutageInput, 'utility' | 'kind' | 'state' | 'plannedStart' | 'plannedEnd' | 'estimatedRestore' | 'noticeKind'>): string {
  return createHash('sha1')
    .update(JSON.stringify(['uo1', o.utility, o.kind, o.state, round(o.plannedStart, 15), round(o.plannedEnd, 15), round(o.estimatedRestore, 30), ...(o.noticeKind && o.noticeKind !== 'outage' ? [o.noticeKind] : [])]))
    .digest('hex');
}

/** Event-level severity (the per-property severity is computed during matching). */
export function outageEventSeverity(o: { kind: OutageKind; state: OutageState; noticeKind?: UtilityNoticeKind }): string {
  return outageEffectiveSeverity(o, 'high') ?? 'info';
}

const ENDED: OutageState[] = ['restored', 'withdrawn'];

export interface UtilityStoreResult {
  inserted: number;
  updated: number;
  unchanged: number;
  /** Ended because the feed said so (restored) in this run. */
  restored: number;
  /** Ended because they were missing from 2 consecutive complete fetches. */
  endedMissing: number;
}

/**
 * Stores one operator's complete or partial fetch. `complete = false` (partial/skipped records)
 * never touches outages that are missing from the payload.
 */
/**
 * `reportsRestored`: the operator's platform reports restoration itself (PLATFORMS_REPORTING_RESTORED).
 * Then an outage that vanishes was merged/removed, not restored; otherwise removal reads as
 * "troligen tillbaka" (restored_inferred).
 */
export async function storeUtilityOutages(db: Queryable, operatorId: string, all: UtilityOutageInput[], complete: boolean, now = new Date(), opts: { reportsRestored?: boolean; utilities?: UtilityKind[] } = {}): Promise<UtilityStoreResult> {
  const result: UtilityStoreResult = { inserted: 0, updated: 0, unchanged: 0, restored: 0, endedMissing: 0 };
  // Some feeds include long history (Göteborg: restored outages from years ago). Only outages restored
  // within the retention window are stored; older ones are irrelevant and never shown.
  const cutoff = now.getTime() - OUTAGE_RETENTION_DAYS * 86_400_000;
  const outages = all.filter((o) => o.state !== 'restored' || !o.restoredAt || Date.parse(o.restoredAt) >= cutoff);
  for (let i = 0; i < outages.length; i += 100) {
    const chunk = outages.slice(i, i + 100).map((o) => {
      const ended = ENDED.includes(o.state);
      return {
        external_id: o.externalId,
        category: o.utility === 'electricity' ? 'Power' : o.utility === 'water' ? 'WaterSupply' : 'Heating',
        severity: outageEventSeverity(o),
        event_type: `${o.utility}:${o.kind}`,
        headline: outageHeadline(o, o.operatorName).slice(0, 500),
        description: o.operatorText?.slice(0, 4000) ?? null,
        area_label: o.placeLabel?.slice(0, 500) ?? null,
        geojson: o.geometry ? JSON.stringify(o.geometry) : null,
        published_at: o.reportedAt,
        valid_from: o.actualStart ?? o.plannedStart,
        status: ended ? 'ended' : 'active',
        ended_reason: ended ? (o.state === 'restored' ? 'restored' : 'withdrawn') : null,
        source_url: o.sourceUrl,
        attribution: o.attribution,
        extra: { operatorId: o.operatorId, operatorName: o.operatorName, utility: o.utility, noticeKind: o.noticeKind ?? 'outage', ...(o.addressArea ? { addressArea: o.addressArea } : {}) },
        version_hash: outageVersionHash(o),
        // utility_outages
        operator_id: o.operatorId,
        utility: o.utility,
        notice_kind: o.noticeKind ?? 'outage',
        kind: o.kind,
        state: o.state,
        precision: o.precision,
        affected_customers: o.affectedCustomers,
        area_customer_total: o.areaCustomerTotal,
        reported_at: o.reportedAt,
        planned_start: o.plannedStart,
        planned_end: o.plannedEnd,
        actual_start: o.actualStart,
        estimated_restore: o.estimatedRestore,
        restored_at: o.restoredAt,
        addresses: o.addresses ?? null,
        postal_codes: o.postalCodes,
        municipality_code: o.municipalityCode,
        place_label: o.placeLabel,
        operator_text: o.operatorText,
        cause: o.cause,
      };
    });
    const { rows } = await db.query<{ inserted: boolean; changed: boolean; was_active: boolean | null; ended: boolean }>(
      `WITH x AS (
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
           external_id text, category text, severity text, event_type text, headline text, description text, area_label text,
           geojson text, published_at timestamptz, valid_from timestamptz, status text, ended_reason text, source_url text,
           attribution text, extra jsonb, version_hash text,
           operator_id text, utility text, notice_kind text, kind text, state text, precision text, affected_customers integer,
           area_customer_total integer, reported_at timestamptz, planned_start timestamptz, planned_end timestamptz,
           actual_start timestamptz, estimated_restore timestamptz, restored_at timestamptz, addresses jsonb,
           postal_codes jsonb, municipality_code text, place_label text, operator_text text, cause text)
       ), prev AS (
         SELECT e.external_id, e.version_hash, e.status FROM source_events e JOIN x USING (external_id) WHERE e.source_id = '${UTILITY_OUTAGE_SOURCE}'
       ), ev AS (
         INSERT INTO source_events AS e (source_id, external_id, data_class, category, level, severity, event_type, headline, description,
                area_label, county_names, geom, published_at, source_updated_at, valid_from, valid_to, status, ended_reason, ended_at,
                version_hash, source_url, attribution, extra, last_seen_at)
         SELECT '${UTILITY_OUTAGE_SOURCE}', x.external_id, 'UTILITY_OUTAGE', x.category, NULL, x.severity, x.event_type, x.headline,
                x.description, x.area_label, '{}',
                CASE WHEN x.geojson IS NOT NULL THEN ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(x.geojson), 4326)) END,
                x.published_at, now(), x.valid_from, NULL, x.status, x.ended_reason,
                -- Ended by the operator: use its restored time so old history never looks "recent".
                CASE WHEN x.status = 'ended' THEN LEAST(COALESCE(x.restored_at, now()), now()) END,
                x.version_hash, x.source_url, x.attribution, x.extra, now()
           FROM x
         ON CONFLICT (source_id, external_id) DO UPDATE SET
                category = EXCLUDED.category, severity = EXCLUDED.severity, event_type = EXCLUDED.event_type,
                headline = EXCLUDED.headline, description = EXCLUDED.description, area_label = EXCLUDED.area_label,
                geom = EXCLUDED.geom, published_at = EXCLUDED.published_at,
                source_updated_at = CASE WHEN e.version_hash <> EXCLUDED.version_hash THEN now() ELSE e.source_updated_at END,
                valid_from = EXCLUDED.valid_from, status = EXCLUDED.status, ended_reason = EXCLUDED.ended_reason,
                ended_at = CASE WHEN EXCLUDED.status = 'active' THEN NULL ELSE COALESCE(e.ended_at, EXCLUDED.ended_at, now()) END,
                version = e.version + CASE WHEN e.version_hash <> EXCLUDED.version_hash THEN 1 ELSE 0 END,
                version_hash = EXCLUDED.version_hash, source_url = EXCLUDED.source_url, attribution = EXCLUDED.attribution,
                extra = EXCLUDED.extra, last_seen_at = now()
         RETURNING e.id, e.external_id, (xmax = 0) AS inserted, e.status
       ), uo AS (
         INSERT INTO utility_outages AS u (event_id, operator_id, utility, notice_kind, kind, state, precision, affected_customers, area_customer_total,
                reported_at, planned_start, planned_end, actual_start, estimated_restore, restored_at, addresses, postal_codes,
                municipality_code, place_label, operator_text, cause, missing_polls, updated_at)
         SELECT ev.id, x.operator_id, x.utility, x.notice_kind, x.kind, x.state, x.precision, x.affected_customers, x.area_customer_total,
                x.reported_at, x.planned_start, x.planned_end, x.actual_start, x.estimated_restore, x.restored_at, x.addresses,
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(x.postal_codes, '[]'::jsonb))),
                x.municipality_code, x.place_label, x.operator_text, x.cause, 0, now()
           FROM ev JOIN x USING (external_id)
         ON CONFLICT (event_id) DO UPDATE SET
                operator_id = EXCLUDED.operator_id, utility = EXCLUDED.utility, notice_kind = EXCLUDED.notice_kind, kind = EXCLUDED.kind, state = EXCLUDED.state,
                precision = EXCLUDED.precision, affected_customers = EXCLUDED.affected_customers,
                area_customer_total = EXCLUDED.area_customer_total, reported_at = EXCLUDED.reported_at,
                planned_start = EXCLUDED.planned_start, planned_end = EXCLUDED.planned_end, actual_start = EXCLUDED.actual_start,
                estimated_restore = EXCLUDED.estimated_restore, restored_at = EXCLUDED.restored_at, addresses = EXCLUDED.addresses,
                postal_codes = EXCLUDED.postal_codes, municipality_code = EXCLUDED.municipality_code,
                place_label = EXCLUDED.place_label, operator_text = EXCLUDED.operator_text, cause = EXCLUDED.cause,
                missing_polls = 0, restored_inferred = false, updated_at = now()
         RETURNING 1
       )
       SELECT ev.inserted,
              NOT EXISTS (SELECT 1 FROM prev p JOIN x ON x.external_id = p.external_id WHERE p.external_id = ev.external_id AND p.version_hash = x.version_hash) AS changed,
              (SELECT p.status = 'active' FROM prev p WHERE p.external_id = ev.external_id) AS was_active,
              ev.status = 'ended' AS ended
         FROM ev`,
      [JSON.stringify(chunk)],
    );
    for (const r of rows) {
      if (r.inserted) result.inserted++;
      else if (r.changed) result.updated++;
      else result.unchanged++;
      if (r.ended && r.was_active) result.restored++;
    }
  }
  if (complete) result.endedMissing = await countMissingAndEnd(db, operatorId, all.map((o) => o.externalId), opts.reportsRestored, opts.utilities);
  return result;
}

/** Increments `missing_polls` for active outages absent from a complete fetch; ends those reaching the threshold. */
async function countMissingAndEnd(db: Queryable, operatorId: string, seen: string[], reportsRestored = false, utilities?: UtilityKind[]): Promise<number> {
  await db.query(
    `UPDATE utility_outages u SET missing_polls = u.missing_polls + 1, updated_at = now()
       FROM source_events e
      WHERE e.id = u.event_id AND u.operator_id = $1 AND e.status = 'active' AND NOT (e.external_id = ANY($2::text[]))
        AND ($3::text[] IS NULL OR u.utility = ANY($3::text[]))`,
    [operatorId, seen, utilities ?? null],
  );
  const { rows } = await db.query<{ id: string; utility: UtilityKind; notice_kind: UtilityNoticeKind; kind: OutageKind; state: OutageState; planned_start: Date | null; planned_end: Date | null; operator_name: string | null }>(
    `SELECT e.id, u.utility, u.notice_kind, u.kind, u.state, u.planned_start, u.planned_end, e.extra->>'operatorName' AS operator_name
       FROM utility_outages u JOIN source_events e ON e.id = u.event_id
      WHERE u.operator_id = $1 AND e.status = 'active' AND u.missing_polls >= $2
        AND ($3::text[] IS NULL OR u.utility = ANY($3::text[]))`,
    [operatorId, OUTAGE_MISSING_POLLS_TO_END, utilities ?? null],
  );
  for (const r of rows) {
    // Vanishing is never the operator saying power is back. Operators that report restoration
    // themselves merge and re-issue tickets (Ellevio 2026-11-17), so their vanished outages are
    // 'withdrawn'. For the others removal is the only end signal: 'restored', but inferred
    // ("troligen tillbaka"). Planned work that never started, and notices of unknown state, are withdrawn.
    const inferred = !reportsRestored && r.notice_kind !== 'boil_water' && r.state !== 'upcoming' && r.state !== 'unknown';
    const state: OutageState = inferred ? 'restored' : 'withdrawn';
    const o = { utility: r.utility, noticeKind: r.notice_kind, kind: r.kind, state, plannedStart: r.planned_start?.toISOString() ?? null, plannedEnd: r.planned_end?.toISOString() ?? null, estimatedRestore: null };
    await db.query(
      `WITH u AS (UPDATE utility_outages SET state = $2, restored_inferred = $5, updated_at = now() WHERE event_id = $1 RETURNING 1)
       UPDATE source_events SET status = 'ended', ended_reason = 'missing_from_feed', ended_at = now(),
              severity = 'info', headline = $3, version = version + 1, version_hash = $4, source_updated_at = now()
        WHERE id = $1`,
      [r.id, state, outageHeadline({ ...o, restoredInferred: inferred }, r.operator_name ?? 'nätbolaget').slice(0, 500), outageVersionHash(o), inferred],
    );
  }
  return rows.length;
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

interface CandidateRow {
  notice_kind?: UtilityNoticeKind;
  property_id: string;
  organization_id: string;
  event_id: string;
  version: number;
  match_method: OutageMatchMethod;
  distance_m: string | null;
  geocode_precision: string | null;
  position_source: string | null;
  kind: OutageKind;
  state: OutageState;
  headline: string;
  affected_customers: number | null;
  area_customer_total: number | null;
  place_label: string | null;
  operator_id: string;
  utility: UtilityKind;
}

/**
 * Address-list outages (no geometry): properties inside the operator's address area whose stored
 * street (+ house number) is listed. Exact street names only; a listed street without numbers gives a
 * street-level (medium) match.
 */
async function addressCandidates(db: Queryable): Promise<CandidateRow[]> {
  const { rows } = await db.query<Omit<CandidateRow, 'match_method' | 'distance_m'> & { street: string | null; housenumber: string | null; addresses: OutageAddress[] | null }>(
    `SELECT p.id AS property_id, p.organization_id, e.id AS event_id, e.version, p.geocode_precision, p.position_source,
            u.kind, u.state, u.notice_kind, e.headline, u.affected_customers, u.area_customer_total, u.place_label, u.operator_id, u.utility, u.addresses,
            p.street, p.housenumber
       FROM source_events e JOIN utility_outages u ON u.event_id = e.id
       JOIN properties p ON p.status <> 'paused' AND p.street IS NOT NULL
        AND ST_DWithin(p.location, ST_SetSRID(ST_MakePoint((e.extra->'addressArea'->>'lon')::float8, (e.extra->'addressArea'->>'lat')::float8), 4326)::geography,
                       (e.extra->'addressArea'->>'radiusM')::float8)
      WHERE e.source_id = '${UTILITY_OUTAGE_SOURCE}' AND u.precision = 'address_list' AND u.addresses IS NOT NULL
        AND e.extra ? 'addressArea'
        AND (e.status = 'active' OR e.ended_at > now() - make_interval(hours => ${OUTAGE_RECENT_HOURS}))`,
  );
  const out: CandidateRow[] = [];
  for (const r of rows) {
    const m = Array.isArray(r.addresses) ? matchAddressList(r.street, r.housenumber, r.addresses) : null;
    if (!m) continue;
    const { street: _s, housenumber: _h, addresses: _a, ...rest } = r;
    void _s;
    void _h;
    void _a;
    out.push({ ...rest, match_method: m, distance_m: null });
  }
  return out;
}

interface ExistingMatch {
  property_id: string;
  event_id: string;
  organization_id: string;
  match_method: string;
  matched_version: number;
  effective_severity: string | null;
  event_status: string;
  headline: string;
  utility: UtilityKind;
  operator_name: string | null;
}

const key = (p: string, e: string) => `${p}|${e}`;

/**
 * Recomputes property ↔ outage matches and writes monitoring_changes rows for feed-visible changes.
 * Feed rows are written only for matches with an effective severity (panel-only matches get none).
 */
export async function rematchUtilityOutages(db: Queryable): Promise<MatchChange[]> {
  const { rows: cand } = await db.query<CandidateRow>(
    `WITH props AS (
       SELECT p.id, p.organization_id, p.location, p.geocode_precision, p.position_source FROM properties p WHERE p.status <> 'paused'
     ), ev AS (
       SELECT e.id, e.version, e.geom, e.headline, u.kind, u.state, u.notice_kind, u.precision, u.affected_customers, u.area_customer_total, u.place_label, u.operator_id, u.utility
         FROM source_events e JOIN utility_outages u ON u.event_id = e.id
        WHERE e.source_id = '${UTILITY_OUTAGE_SOURCE}' AND e.geom IS NOT NULL
          AND (e.status = 'active' OR e.ended_at > now() - make_interval(hours => ${OUTAGE_RECENT_HOURS}))
     )
     SELECT pr.id AS property_id, pr.organization_id, ev.id AS event_id, ev.version, pr.geocode_precision, pr.position_source,
            ev.kind, ev.state, ev.notice_kind, ev.headline, ev.affected_customers, ev.area_customer_total, ev.place_label, ev.operator_id, ev.utility,
            CASE WHEN ev.precision = 'polygon' AND ST_Intersects(ev.geom, pr.location::geometry) THEN 'outage_polygon'
                 WHEN ev.precision = 'polygon' THEN 'outage_adjacent'
                 WHEN ev.precision = 'point' THEN 'outage_point'
                 WHEN ev.precision = 'postal_area' THEN 'outage_postal_area'
                 ELSE 'outage_area' END AS match_method,
            CASE WHEN ev.precision IN ('polygon','point') AND NOT ST_Intersects(ev.geom, pr.location::geometry)
                 THEN round(ST_Distance(ev.geom::geography, pr.location)::numeric, 0) ELSE 0 END AS distance_m
       FROM props pr JOIN ev ON (
            (ev.precision = 'polygon' AND ST_DWithin(ev.geom::geography, pr.location, ${OUTAGE_ADJACENT_M}))
         OR (ev.precision = 'point' AND ST_DWithin(ev.geom::geography, pr.location, ${OUTAGE_POINT_RADIUS_M}))
         OR (ev.precision IN ('postal_area','area') AND ST_Intersects(ev.geom, pr.location::geometry)))`,
  );
  cand.push(...(await addressCandidates(db)));
  const { rows: existing } = await db.query<ExistingMatch>(
    `SELECT m.property_id, m.event_id, m.organization_id, m.match_method, m.matched_version, m.effective_severity,
            e.status AS event_status, e.headline, u.utility, e.extra->>'operatorName' AS operator_name
       FROM property_event_matches m JOIN source_events e ON e.id = m.event_id JOIN utility_outages u ON u.event_id = e.id
      WHERE e.source_id = '${UTILITY_OUTAGE_SOURCE}'`,
  );
  const old = new Map(existing.map((m) => [key(m.property_id, m.event_id), m]));
  const changes: Array<{ organization_id: string; property_id: string; event_id: string; change_type: MatchChange['changeType']; severity: string; headline: string; dedup_key: string }> = [];
  const upserts: Array<{ property_id: string; event_id: string; organization_id: string; match_method: string; distance_m: number | null; version: number; effective_severity: string | null }> = [];
  const seen = new Set<string>();

  const levelOf = (c: CandidateRow) => outageMatchLevel(c.match_method, isPositionConfirmed(c.geocode_precision, c.position_source), c.affected_customers, c.notice_kind);
  // Operators merge and re-issue tickets: an outage that vanished from the list while another one from
  // the same operator still covers the property was replaced, not resolved. It gets no feed row and is
  // not shown (Ellevio 2026-11-17: ticket 581219 vanished, 581216 continued until power was back).
  const covering = new Set(
    cand
      .filter((c) => (c.state === 'ongoing' || c.state === 'unknown') && outageEffectiveSeverity({ kind: c.kind, state: c.state, noticeKind: c.notice_kind }, levelOf(c)))
      .map((c) => `${c.property_id}|${c.operator_id}|${c.utility}`),
  );

  for (const c of cand) {
    const k = key(c.property_id, c.event_id);
    seen.add(k);
    const level = levelOf(c);
    const superseded = outageVanished(c) && covering.has(`${c.property_id}|${c.operator_id}|${c.utility}`);
    const severity = superseded ? null : outageEffectiveSeverity({ kind: c.kind, state: c.state, noticeKind: c.notice_kind }, level);
    const o = old.get(k);
    upserts.push({ property_id: c.property_id, event_id: c.event_id, organization_id: c.organization_id, match_method: c.match_method, distance_m: c.distance_m === null ? null : Number(c.distance_m), version: c.version, effective_severity: severity });
    if (!severity) continue;
    const ended = c.state === 'restored' || c.state === 'withdrawn';
    const versionChanged = !o || o.matched_version < c.version;
    const becameVisible = !!o && !o.effective_severity;
    if (!versionChanged && !becameVisible) continue;
    // A restored outage that was never visible for this property produces no feed row.
    if (ended && (!o || !o.effective_severity)) continue;
    changes.push({
      organization_id: c.organization_id,
      property_id: c.property_id,
      event_id: c.event_id,
      change_type: ended ? 'ended' : !o || becameVisible ? 'new' : 'updated',
      severity,
      // "Strömmen är tillbaka …" needs no position caveat; area-level rows keep theirs (where it applied).
      headline: (ended && level !== 'area' ? c.headline : outageFeedTitle(c.headline, level, c.match_method, c.place_label, c.notice_kind)).slice(0, 500),
      dedup_key: `${c.property_id}:${c.event_id}:v${c.version}:${level}`,
    });
  }

  const gone = existing.filter((m) => !seen.has(key(m.property_id, m.event_id)));
  for (const g of gone) {
    // Ended outages age out silently; an active outage that no longer covers the property gets one row.
    if (g.event_status !== 'active' || !g.effective_severity) continue;
    changes.push({
      organization_id: g.organization_id,
      property_id: g.property_id,
      event_id: g.event_id,
      change_type: 'ended',
      severity: 'info',
      headline: `Avbrottsområdet omfattar inte längre fastigheten (${g.operator_name ?? 'nätbolaget'})`,
      dedup_key: `${g.property_id}:${g.event_id}:v${g.matched_version}:gone`,
    });
  }

  if (gone.length) {
    await db.query(
      `DELETE FROM property_event_matches m USING jsonb_to_recordset($1::jsonb) AS x(property_id uuid, event_id uuid)
        WHERE m.property_id = x.property_id AND m.event_id = x.event_id`,
      [JSON.stringify(gone.map((g) => ({ property_id: g.property_id, event_id: g.event_id })))],
    );
  }
  for (let i = 0; i < upserts.length; i += 500) {
    await db.query(
      `INSERT INTO property_event_matches (property_id, event_id, organization_id, match_method, distance_m, matched_version, effective_severity)
       SELECT x.property_id, x.event_id, x.organization_id, x.match_method, x.distance_m, x.version, x.effective_severity
         FROM jsonb_to_recordset($1::jsonb) AS x(property_id uuid, event_id uuid, organization_id uuid, match_method text,
              distance_m numeric, version integer, effective_severity text)
       ON CONFLICT (property_id, event_id) DO UPDATE SET last_matched_at = now(), match_method = EXCLUDED.match_method,
              distance_m = EXCLUDED.distance_m, matched_version = EXCLUDED.matched_version, effective_severity = EXCLUDED.effective_severity`,
      [JSON.stringify(upserts.slice(i, i + 500))],
    );
  }
  if (!changes.length) return [];
  const { rows } = await db.query<{ organization_id: string; property_id: string; change_type: MatchChange['changeType'] }>(
    `INSERT INTO monitoring_changes (organization_id, property_id, event_id, source_id, change_type, data_class, severity, headline, dedup_key)
     SELECT x.organization_id, x.property_id, x.event_id, '${UTILITY_OUTAGE_SOURCE}', x.change_type, 'UTILITY_OUTAGE', x.severity, x.headline, x.dedup_key
       FROM jsonb_to_recordset($1::jsonb) AS x(organization_id uuid, property_id uuid, event_id uuid, change_type text, severity text,
            headline text, dedup_key text)
     ON CONFLICT (dedup_key) DO NOTHING
     RETURNING organization_id, property_id, change_type`,
    [JSON.stringify(changes)],
  );
  return rows.map((r) => ({ organizationId: r.organization_id, propertyId: r.property_id, sourceId: UTILITY_OUTAGE_SOURCE, changeType: r.change_type }));
}

/* ------------------------------------------------------------------ */
/* Concession areas                                                    */
/* ------------------------------------------------------------------ */

/** Replaces one operator's concession areas from a given source. Geometries are GeoJSON (lon/lat). */
export async function replaceConcessionAreas(
  db: Queryable,
  operatorId: string,
  utility: UtilityKind,
  source: 'operator_feed' | 'national_dataset',
  areas: Array<{ externalRef: string | null; geometry: unknown }>,
): Promise<number> {
  if (!areas.length) return 0;
  await db.query(`DELETE FROM grid_concession_areas WHERE operator_id = $1 AND utility = $2 AND source = $3`, [operatorId, utility, source]);
  const { rowCount } = await db.query(
    `INSERT INTO grid_concession_areas (operator_id, utility, source, external_ref, geom)
     SELECT $1, $2, $3, x.external_ref, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(x.geojson), 4326)), 3))
       FROM jsonb_to_recordset($4::jsonb) AS x(external_ref text, geojson text)`,
    [operatorId, utility, source, JSON.stringify(areas.map((a) => ({ external_ref: a.externalRef, geojson: JSON.stringify(a.geometry) })))],
  );
  return rowCount ?? 0;
}

/**
 * Replaces the national concession dataset (Energimarknadsinspektionen, SWEREF 99 TM / EPSG:3006).
 * Each area arrives as its rings (MultiLineString); PostGIS assembles polygons with holes
 * (ST_BuildArea), simplifies to 5 m and transforms to WGS84. Runs in one transaction-free batch:
 * old rows are deleted only after the new set was inserted.
 */
export async function replaceNationalConcessions(
  db: Queryable,
  areas: Array<{ operatorId: string; operatorName: string; externalRef: string | null; rings: number[][][] }>,
  utility: UtilityKind = 'electricity',
): Promise<number> {
  if (!areas.length) return 0;
  const stamp = new Date().toISOString();
  let inserted = 0;
  for (let i = 0; i < areas.length; i += 10) {
    const chunk = areas.slice(i, i + 10).map((a) => ({
      operator_id: a.operatorId,
      operator_name: a.operatorName,
      external_ref: a.externalRef,
      geojson: JSON.stringify({ type: 'MultiLineString', coordinates: a.rings }),
    }));
    const { rowCount } = await db.query(
      `INSERT INTO grid_concession_areas (operator_id, operator_name, utility, source, external_ref, geom, fetched_at)
       SELECT x.operator_id, x.operator_name, $2, 'national_dataset', x.external_ref, g.geom, $3::timestamptz
         FROM jsonb_to_recordset($1::jsonb) AS x(operator_id text, operator_name text, external_ref text, geojson text)
         CROSS JOIN LATERAL (
           SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Transform(
                    ST_SimplifyPreserveTopology(ST_BuildArea(ST_SetSRID(ST_GeomFromGeoJSON(x.geojson), 3006)), 5), 4326)), 3)) AS geom
         ) g
        WHERE g.geom IS NOT NULL AND NOT ST_IsEmpty(g.geom)`,
      [JSON.stringify(chunk), utility, stamp],
    );
    inserted += rowCount ?? 0;
  }
  await db.query(`DELETE FROM grid_concession_areas WHERE source = 'national_dataset' AND utility = $1 AND fetched_at <> $2::timestamptz`, [utility, stamp]);
  return inserted;
}

/* ------------------------------------------------------------------ */
/* Reads for the snapshot                                              */
/* ------------------------------------------------------------------ */

export interface OrgUtilityOutageRow {
  last_seen_at?: Date;
  notice_kind?: UtilityNoticeKind;
  property_id: string;
  event_id: string;
  match_method: OutageMatchMethod;
  distance_m: string | null;
  effective_severity: string | null;
  operator_id: string;
  operator_name: string | null;
  utility: UtilityKind;
  kind: OutageKind;
  state: OutageState;
  affected_customers: number | null;
  area_customer_total: number | null;
  reported_at: Date | null;
  planned_start: Date | null;
  planned_end: Date | null;
  actual_start: Date | null;
  estimated_restore: Date | null;
  restored_at: Date | null;
  restored_inferred: boolean;
  ended_at: Date | null;
  place_label: string | null;
  operator_text: string | null;
  cause: string | null;
  source_url: string | null;
  geometry: unknown | null;
  geocode_precision: string | null;
  position_source: string | null;
}

/** Matched outages (active + ended within 24 h) for an organization's properties. */
export async function listOrgUtilityOutages(db: Queryable, organizationId: string): Promise<OrgUtilityOutageRow[]> {
  const { rows } = await db.query<OrgUtilityOutageRow>(
    `SELECT m.property_id, m.event_id, m.match_method, m.distance_m, m.effective_severity,
            u.operator_id, e.extra->>'operatorName' AS operator_name, u.utility, u.kind, u.state, u.notice_kind, u.affected_customers,
            u.area_customer_total, u.reported_at, u.planned_start, u.planned_end, u.actual_start, u.estimated_restore,
            u.restored_at, u.restored_inferred, e.ended_at, u.place_label, u.operator_text, u.cause, e.source_url, e.last_seen_at,
            CASE WHEN e.geom IS NOT NULL AND ST_NPoints(e.geom) <= 5000 THEN ST_AsGeoJSON(e.geom, 6)::jsonb END AS geometry,
            p.geocode_precision, p.position_source
       FROM property_event_matches m
       JOIN source_events e ON e.id = m.event_id
       JOIN utility_outages u ON u.event_id = e.id
       JOIN properties p ON p.id = m.property_id
      WHERE m.organization_id = $1 AND e.source_id = '${UTILITY_OUTAGE_SOURCE}'
        AND (e.status = 'active' OR e.ended_at > now() - make_interval(hours => ${OUTAGE_RECENT_HOURS}))
      ORDER BY coalesce(u.actual_start, u.planned_start) NULLS LAST`,
    [organizationId],
  );
  return rows;
}

export interface PropertyConcessionRow {
  property_id: string;
  operator_id: string;
  operator_name: string | null;
  utility: UtilityKind;
}

/** Operators whose concession area covers each property of the organization. */
export async function listOrgPropertyConcessions(db: Queryable, organizationId: string): Promise<PropertyConcessionRow[]> {
  const { rows } = await db.query<PropertyConcessionRow>(
    `SELECT p.id AS property_id, g.operator_id, max(g.operator_name) AS operator_name, g.utility
       FROM properties p JOIN grid_concession_areas g ON ST_Covers(g.geom, p.location::geometry)
      WHERE p.organization_id = $1
      GROUP BY p.id, g.operator_id, g.utility`,
    [organizationId],
  );
  return rows;
}

/** Deletes ended outages older than the retention window. */
export async function applyUtilityOutageRetention(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM source_events WHERE source_id = '${UTILITY_OUTAGE_SOURCE}' AND status <> 'active'
        AND ended_at < now() - make_interval(days => ${OUTAGE_RETENTION_DAYS})`,
  );
  return rowCount ?? 0;
}
