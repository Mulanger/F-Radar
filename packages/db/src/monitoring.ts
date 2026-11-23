import { ACTIVITY, EventMapGeometrySchema, FEED_ACK_SEVERITY_RANK, WEATHER_WATER, eventPlaceFromHeadline, stationMatchDistance, trafficMapStyle, type ActivityItem, type EventMapItem, type PropertyEventMapEvent } from '@fastighetsradar/domain';
import { applyUtilityOutageRetention } from './utility-outages';
import { createHash } from 'node:crypto';
import type { Queryable } from './migrations';
import { loadPropertyForecasts, pruneForecastGridPoints, type OrgForecastRow } from './forecasts';

/**
 * Phase 3 monitoring repository.
 *
 * Two kinds of functions:
 *  - SYSTEM (collector) functions: operate across all organizations, never exposed to HTTP.
 *  - TENANT read functions (`load*ForOrg`): every statement filters `organization_id = $1`
 *    with the internal id resolved from a verified Clerk organization.
 */

/* ------------------------------------------------------------------ */
/* Jobs (leasing, run bookkeeping)                                     */
/* ------------------------------------------------------------------ */

export interface JobDefinition {
  jobId: string;
  sourceId: string | null;
  intervalSeconds: number;
  enabled: boolean;
}

export interface JobRow {
  job_id: string;
  source_id: string | null;
  interval_seconds: number;
  enabled: boolean;
  next_run_at: Date;
  lease_owner: string | null;
  lease_until: Date | null;
  last_started_at: Date | null;
  last_finished_at: Date | null;
  last_success_at: Date | null;
  last_status: 'ok' | 'partial' | 'error' | 'skipped' | null;
  last_error_code: string | null;
  last_error_detail: string | null;
  last_items: number | null;
  last_duration_ms: number | null;
  consecutive_failures: number;
  source_updated_at: Date | null;
}

/** Inserts missing job rows and syncs interval/enabled from code (schedule stays in code). */
export async function ensureJobs(db: Queryable, defs: JobDefinition[]): Promise<void> {
  if (!defs.length) return;
  await db.query(
    `INSERT INTO provider_jobs (job_id, source_id, interval_seconds, enabled)
     SELECT x.job_id, x.source_id, x.interval_seconds, x.enabled
     FROM jsonb_to_recordset($1::jsonb) AS x(job_id text, source_id text, interval_seconds integer, enabled boolean)
     ON CONFLICT (job_id) DO UPDATE SET interval_seconds = EXCLUDED.interval_seconds, enabled = EXCLUDED.enabled, source_id = EXCLUDED.source_id`,
    [JSON.stringify(defs.map((d) => ({ job_id: d.jobId, source_id: d.sourceId, interval_seconds: d.intervalSeconds, enabled: d.enabled })))],
  );
}

/**
 * Atomically leases a due job. Exactly one process wins; an expired lease (crashed process)
 * can be taken over. Returns null when the job is not due or leased elsewhere.
 */
export async function leaseDueJob(db: Queryable, jobId: string, owner: string, leaseSeconds: number): Promise<JobRow | null> {
  const { rows } = await db.query<JobRow>(
    `UPDATE provider_jobs
        SET lease_owner = $2, lease_until = now() + make_interval(secs => $3), last_started_at = now()
      WHERE job_id = $1 AND enabled AND next_run_at <= now()
        AND (lease_until IS NULL OR lease_until < now())
      RETURNING *`,
    [jobId, owner, leaseSeconds],
  );
  return rows[0] ?? null;
}

export interface JobOutcome {
  status: 'ok' | 'partial' | 'error' | 'skipped';
  items: number;
  durationMs: number;
  errorCode?: string | null;
  errorDetail?: string | null;
  sourceUpdatedAt?: string | null;
  /** Seconds until the next run (backoff already applied by the caller). */
  nextRunInSeconds: number;
}

export async function finishJob(db: Queryable, jobId: string, owner: string, o: JobOutcome): Promise<void> {
  const success = o.status === 'ok' || o.status === 'partial';
  await db.query(
    `UPDATE provider_jobs SET
        lease_owner = NULL, lease_until = NULL, last_finished_at = now(),
        next_run_at = now() + make_interval(secs => $3),
        last_status = $4, last_items = $5, last_duration_ms = $6,
        last_error_code = $7, last_error_detail = $8,
        last_success_at = CASE WHEN $9 THEN now() ELSE last_success_at END,
        consecutive_failures = CASE WHEN $9 THEN 0 WHEN $4 = 'skipped' THEN consecutive_failures ELSE consecutive_failures + 1 END,
        source_updated_at = COALESCE($10::timestamptz, source_updated_at)
      WHERE job_id = $1 AND lease_owner = $2`,
    [jobId, owner, Math.max(1, Math.round(o.nextRunInSeconds)), o.status, o.items, o.durationMs, o.errorCode ?? null, o.errorDetail?.slice(0, 500) ?? null, success, o.sourceUpdatedAt ?? null],
  );
  await db.query(
    `INSERT INTO integration_runs (source_id, job_id, started_at, finished_at, status, items, error_code, duration_ms, detail)
     SELECT source_id, job_id, last_started_at, now(), $2, $3, $4, $5, $6 FROM provider_jobs WHERE job_id = $1`,
    [jobId, o.status, o.items, o.errorCode ?? null, o.durationMs, o.errorDetail?.slice(0, 500) ?? null],
  );
}

/** Makes the given jobs due now (e.g. after a property was created or moved). */
export async function requestJobRun(db: Queryable, jobIds: string[]): Promise<void> {
  if (!jobIds.length) return;
  await db.query(`UPDATE provider_jobs SET next_run_at = now() WHERE job_id = ANY($1::text[]) AND next_run_at > now()`, [jobIds]);
}

export async function listJobs(db: Queryable): Promise<JobRow[]> {
  const { rows } = await db.query<JobRow>(`SELECT * FROM provider_jobs ORDER BY job_id`);
  return rows;
}

/**
 * Enabled jobs among `jobIds` that are past their due time, with how late they are (seconds,
 * database clock). A running job counts until it finishes: lateness is "not done yet", which is
 * what an alert waiting for it experiences. A job in backoff is not due and not listed.
 */
export async function listOverdueJobs(db: Queryable, jobIds: string[]): Promise<Array<{ jobId: string; overdueSeconds: number }>> {
  if (!jobIds.length) return [];
  const { rows } = await db.query<{ job_id: string; overdue_s: number }>(
    `SELECT job_id, extract(epoch FROM now() - next_run_at)::float8 AS overdue_s
       FROM provider_jobs WHERE job_id = ANY($1::text[]) AND enabled AND next_run_at < now()`,
    [jobIds],
  );
  return rows.map((r) => ({ jobId: r.job_id, overdueSeconds: Number(r.overdue_s) }));
}

/* ------------------------------------------------------------------ */
/* Monitoring targets (system)                                         */
/* ------------------------------------------------------------------ */

export interface MonitoringTarget {
  propertyId: string;
  organizationId: string;
  lat: number;
  lon: number;
  municipality: string | null;
  updatedAt: Date;
}

export async function listMonitoringTargets(db: Queryable): Promise<Array<MonitoringTarget & { /** The organization's Trafikverket distance (Inställningar). */ trafficRadiusM: number }>> {
  const { rows } = await db.query<{ id: string; organization_id: string; lat: number; lon: number; municipality: string | null; updated_at: Date; traffic_radius_m: number }>(
    `SELECT p.id, p.organization_id, ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lon, p.municipality, p.updated_at, o.traffic_radius_m
       FROM properties p JOIN organizations o ON o.id = p.organization_id
      WHERE p.status <> 'paused' ORDER BY p.created_at, p.id`,
  );
  return rows.map((r) => ({ propertyId: r.id, organizationId: r.organization_id, lat: r.lat, lon: r.lon, municipality: r.municipality, updatedAt: r.updated_at, trafficRadiusM: Number(r.traffic_radius_m) }));
}

/* ------------------------------------------------------------------ */
/* Reference areas                                                     */
/* ------------------------------------------------------------------ */

export async function upsertCountyAreas(db: Queryable, sourceId: string, areas: Array<{ code: string; name: string; sourceRef: string; geometry: unknown }>): Promise<number> {
  const { rowCount } = await db.query(
    `INSERT INTO admin_areas (id, kind, code, name, source_id, source_ref, geom, fetched_at)
     SELECT 'county:' || x.code, 'county', x.code, x.name, $1, x.source_ref,
            ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(x.geojson), 4326)), 3)), now()
       FROM jsonb_to_recordset($2::jsonb) AS x(code text, name text, source_ref text, geojson text)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, geom = EXCLUDED.geom, source_ref = EXCLUDED.source_ref, fetched_at = now()`,
    [sourceId, JSON.stringify(areas.map((a) => ({ code: a.code, name: a.name, source_ref: a.sourceRef, geojson: JSON.stringify(a.geometry) })))],
  );
  return rowCount ?? 0;
}

export async function countCountyAreas(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM admin_areas WHERE kind = 'county'`);
  return rows[0]?.n ?? 0;
}

/* ------------------------------------------------------------------ */
/* Source events (warnings, public events)                             */
/* ------------------------------------------------------------------ */

export interface SourceEventInput {
  externalId: string;
  dataClass: 'OFFICIAL_WARNING' | 'PUBLIC_EVENT';
  category: string;
  level: string | null;
  severity: string;
  eventType: string;
  headline: string;
  description: string | null;
  areaLabel: string | null;
  countyNames: string[];
  geometry: unknown | null;
  geometryWkt?: string | null;
  publishedAt: string | null;
  sourceUpdatedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  status: 'active' | 'cancelled';
  sourceUrl: string | null;
  attribution: string;
  extra: Record<string, unknown>;
}

/** Content hash used for versioning: any change of level/text/validity/geometry bumps the version. */
export function eventVersionHash(e: SourceEventInput): string {
  return createHash('sha1')
    .update(JSON.stringify([e.level, e.severity, e.eventType, e.headline, e.description, e.areaLabel, e.countyNames, e.validFrom, e.validTo, e.status, e.geometry ?? e.geometryWkt ?? null]))
    .digest('hex');
}

export interface UpsertEventsResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * Upper bounds for stored official texts. Real SMHI/Krisinformation/Trafikverket texts are far
 * shorter, so they are stored unaltered; the bound only protects the database (and the 24-month
 * per-property archive, which copies the text) against an abnormal upstream payload. A text that
 * hits the bound is visibly marked as shortened – it is never silently cut.
 */
export const OFFICIAL_TEXT_LIMITS = { headline: 1_000, description: 20_000 } as const;
export const SHORTENED_TEXT_MARKER = ' … [Texten är förkortad. Se källan för hela texten.]';

export function capOfficialText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - SHORTENED_TEXT_MARKER.length) + SHORTENED_TEXT_MARKER;
}

/** Upserts events in chunks. Events whose validity already ended are stored as `ended`. */
export async function upsertSourceEvents(db: Queryable, sourceId: string, events: SourceEventInput[]): Promise<UpsertEventsResult> {
  const result: UpsertEventsResult = { inserted: 0, updated: 0, unchanged: 0 };
  for (let i = 0; i < events.length; i += 100) {
    const chunk = events.slice(i, i + 100).map((e) => ({
      external_id: e.externalId,
      data_class: e.dataClass,
      category: e.category,
      level: e.level,
      severity: e.severity,
      event_type: e.eventType.slice(0, 200),
      headline: capOfficialText(e.headline, OFFICIAL_TEXT_LIMITS.headline),
      description: e.description === null ? null : capOfficialText(e.description, OFFICIAL_TEXT_LIMITS.description),
      area_label: e.areaLabel?.slice(0, 500) ?? null,
      county_names: e.countyNames,
      geojson: e.geometry ? JSON.stringify(e.geometry) : null,
      wkt: e.geometryWkt ?? null,
      published_at: e.publishedAt,
      source_updated_at: e.sourceUpdatedAt,
      valid_from: e.validFrom,
      valid_to: e.validTo,
      status: e.status,
      source_url: e.sourceUrl,
      attribution: e.attribution,
      extra: e.extra,
      version_hash: eventVersionHash(e),
    }));
    const { rows } = await db.query<{ inserted: boolean; changed: boolean }>(
      `WITH x AS (
         SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
           external_id text, data_class text, category text, level text, severity text, event_type text, headline text,
           description text, area_label text, county_names jsonb, geojson text, wkt text, published_at timestamptz,
           source_updated_at timestamptz, valid_from timestamptz, valid_to timestamptz, status text, source_url text,
           attribution text, extra jsonb, version_hash text)
       ), prev AS (
         SELECT e.external_id, e.version_hash FROM source_events e JOIN x USING (external_id) WHERE e.source_id = $1
       )
       INSERT INTO source_events AS e (source_id, external_id, data_class, category, level, severity, event_type, headline, description,
              area_label, county_names, geom, published_at, source_updated_at, valid_from, valid_to, status, ended_reason, ended_at,
              version_hash, source_url, attribution, extra, last_seen_at)
       SELECT $1, x.external_id, x.data_class, x.category, x.level, x.severity, x.event_type, x.headline, x.description, x.area_label,
              ARRAY(SELECT jsonb_array_elements_text(COALESCE(x.county_names, '[]'::jsonb))),
              CASE WHEN x.geojson IS NOT NULL THEN ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(x.geojson), 4326))
                   WHEN x.wkt IS NOT NULL THEN ST_MakeValid(ST_GeomFromText(x.wkt, 4326)) END,
              x.published_at, x.source_updated_at, x.valid_from, x.valid_to,
              CASE WHEN x.status = 'cancelled' THEN 'cancelled' WHEN x.valid_to IS NOT NULL AND x.valid_to < now() THEN 'ended' ELSE 'active' END,
              CASE WHEN x.status = 'cancelled' THEN 'cancelled_by_source' WHEN x.valid_to IS NOT NULL AND x.valid_to < now() THEN 'valid_to_passed' END,
              CASE WHEN x.status = 'cancelled' OR (x.valid_to IS NOT NULL AND x.valid_to < now()) THEN now() END,
              x.version_hash, x.source_url, x.attribution, COALESCE(x.extra, '{}'::jsonb), now()
         FROM x
       ON CONFLICT (source_id, external_id) DO UPDATE SET
              data_class = EXCLUDED.data_class, category = EXCLUDED.category, level = EXCLUDED.level, severity = EXCLUDED.severity,
              event_type = EXCLUDED.event_type, headline = EXCLUDED.headline, description = EXCLUDED.description,
              area_label = EXCLUDED.area_label, county_names = EXCLUDED.county_names, geom = EXCLUDED.geom,
              published_at = EXCLUDED.published_at, source_updated_at = EXCLUDED.source_updated_at,
              valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to, status = EXCLUDED.status,
              ended_reason = EXCLUDED.ended_reason, ended_at = CASE WHEN EXCLUDED.status = 'active' THEN NULL ELSE COALESCE(e.ended_at, now()) END,
              version = e.version + CASE WHEN e.version_hash <> EXCLUDED.version_hash THEN 1 ELSE 0 END,
              version_hash = EXCLUDED.version_hash, source_url = EXCLUDED.source_url, attribution = EXCLUDED.attribution,
              extra = EXCLUDED.extra, last_seen_at = now()
       RETURNING (xmax = 0) AS inserted,
                 NOT EXISTS (SELECT 1 FROM prev WHERE prev.external_id = e.external_id AND prev.version_hash = e.version_hash) AS changed`,
      [sourceId, JSON.stringify(chunk)],
    );
    for (const r of rows) {
      if (r.inserted) result.inserted++;
      else if (r.changed) result.updated++;
      else result.unchanged++;
    }
  }
  return result;
}

/**
 * Ends active events of a source that were NOT in the latest complete fetch (removed upstream).
 * Only call after a fully successful fetch – a failed/partial fetch must never end events.
 */
export async function endMissingEvents(db: Queryable, sourceId: string, seenExternalIds: string[], reason = 'removed_from_feed'): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE source_events SET status = 'ended', ended_reason = $3, ended_at = now()
      WHERE source_id = $1 AND status = 'active' AND NOT (external_id = ANY($2::text[]))`,
    [sourceId, seenExternalIds, reason],
  );
  return rowCount ?? 0;
}

/** Ends active events whose published validity has passed. */
export async function expireEvents(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE source_events SET status = 'ended', ended_reason = 'valid_to_passed', ended_at = now()
      WHERE status = 'active' AND valid_to IS NOT NULL AND valid_to < now()`,
  );
  return rowCount ?? 0;
}

/** Marks specific events as ended (e.g. Trafikverket situations flagged Deleted). */
export async function endEventsById(db: Queryable, sourceId: string, externalIds: string[], reason: string): Promise<number> {
  if (!externalIds.length) return 0;
  const { rowCount } = await db.query(
    `UPDATE source_events SET status = 'ended', ended_reason = $3, ended_at = now()
      WHERE source_id = $1 AND status = 'active' AND external_id = ANY($2::text[])`,
    [sourceId, externalIds, reason],
  );
  return rowCount ?? 0;
}

/* ------------------------------------------------------------------ */
/* Geographic matching (PostGIS) + de-duplicated change log            */
/* ------------------------------------------------------------------ */

/**
 * Traffic events are matched within the organization's distance (organizations.traffic_radius_m,
 * TRAFFIC_RADIUS in the domain: 100–3000 m, default 500 m).
 */

export interface MatchChange {
  organizationId: string;
  propertyId: string;
  sourceId: string;
  changeType: 'new' | 'updated' | 'ended' | 'cancelled';
}

/**
 * Recomputes property ↔ event matches for all active events in ONE statement (consistent snapshot):
 *  - smhi_warnings:   ST_Intersects(warning polygon, property point)
 *  - trafikverket:    ST_DWithin(deviation geometry, point, organization's traffic radius) + exact distance
 *  - krisinformation: property county (ST_Covers on county polygons) ∈ published counties,
 *                     '*' (national), or municipality name match
 * and writes one monitoring_changes row per new/updated/ended match (dedup_key is unique, so
 * re-running never duplicates). Returns the changes written.
 */
export async function rematchEvents(db: Queryable, options: { organizationId?: string } = {}): Promise<MatchChange[]> {
  const { rows } = await db.query<{ organization_id: string; property_id: string; source_id: string; change_type: MatchChange['changeType'] }>(
    `WITH props AS (
       SELECT p.id, p.organization_id, p.location, lower(regexp_replace(coalesce(p.municipality, ''), '\\s+(kommun|stad)$', '')) AS muni,
              (SELECT a.name FROM admin_areas a WHERE a.kind = 'county' AND ST_Covers(a.geom, p.location::geometry) LIMIT 1) AS county,
              o.traffic_radius_m
         FROM properties p JOIN organizations o ON o.id = p.organization_id
        WHERE p.status <> 'paused' AND ($1::uuid IS NULL OR p.organization_id = $1)
     ), cand AS (
       SELECT pr.id AS property_id, pr.organization_id, e.id AS event_id, e.version,
              CASE WHEN e.source_id = 'smhi_warnings' THEN 'polygon_intersection'
                   WHEN e.source_id IN ('trafikverket', 'sl_deviations') THEN 'within_radius'
                   -- Krisinformation: 'municipality' = the message covers the property's municipality (it names it,
                   -- or names no municipality and so covers the whole county/country); 'county' = same county but
                   -- only OTHER municipalities are named. A VMA there is not shown as a crisis (ADR 0003).
                   WHEN jsonb_array_length(COALESCE(e.extra->'municipalities', '[]'::jsonb)) = 0 THEN 'municipality'
                   WHEN pr.muni <> '' AND EXISTS (
                        SELECT 1 FROM jsonb_array_elements_text(e.extra->'municipalities') m
                         WHERE lower(regexp_replace(m, '\\s+(kommun|stad)$', '')) = pr.muni) THEN 'municipality'
                   ELSE 'county' END AS match_method,
              CASE WHEN e.source_id IN ('trafikverket', 'sl_deviations') THEN round(ST_Distance(e.geom::geography, pr.location)::numeric, 0)
                   WHEN e.source_id = 'smhi_warnings' THEN 0 END AS distance_m
         FROM props pr
         JOIN source_events e ON e.status = 'active' AND (
              (e.source_id = 'smhi_warnings' AND e.geom IS NOT NULL AND ST_Intersects(e.geom, pr.location::geometry))
           OR (e.source_id IN ('trafikverket', 'sl_deviations') AND e.geom IS NOT NULL AND ST_DWithin(e.geom::geography, pr.location, pr.traffic_radius_m))
           OR (e.source_id = 'krisinformation' AND (
                 pr.county = ANY(e.county_names) OR '*' = ANY(e.county_names)
                 OR (pr.muni <> '' AND EXISTS (
                      SELECT 1 FROM jsonb_array_elements_text(COALESCE(e.extra->'municipalities', '[]'::jsonb)) m
                       WHERE lower(regexp_replace(m, '\\s+(kommun|stad)$', '')) = pr.muni)))))
     ), old AS (
       SELECT * FROM property_event_matches
     ), new_changes AS (
       INSERT INTO monitoring_changes (organization_id, property_id, event_id, source_id, change_type, data_class, severity, headline, dedup_key)
       SELECT c.organization_id, c.property_id, c.event_id, e.source_id,
              CASE WHEN o.property_id IS NULL THEN 'new' ELSE 'updated' END, e.data_class, e.severity, e.headline,
              c.property_id || ':' || c.event_id || ':v' || c.version
         FROM cand c JOIN source_events e ON e.id = c.event_id
         LEFT JOIN old o ON o.property_id = c.property_id AND o.event_id = c.event_id
        WHERE o.property_id IS NULL OR o.matched_version < c.version
       ON CONFLICT (dedup_key) DO NOTHING
       RETURNING organization_id, property_id, source_id, change_type
     ), gone AS (
       DELETE FROM property_event_matches m
        WHERE NOT EXISTS (SELECT 1 FROM cand c WHERE c.property_id = m.property_id AND c.event_id = m.event_id)
          -- Scoped to one organization (a property was saved): never touch other organizations' matches.
          AND ($1::uuid IS NULL OR m.organization_id = $1)
          -- Utility outages are matched by rematchUtilityOutages (per-property precision/severity).
          AND NOT EXISTS (SELECT 1 FROM source_events se WHERE se.id = m.event_id AND se.source_id = 'utility_outages')
       RETURNING m.property_id, m.event_id, m.organization_id, m.matched_version
     ), end_changes AS (
       INSERT INTO monitoring_changes (organization_id, property_id, event_id, source_id, change_type, data_class, severity, headline, dedup_key)
       SELECT g.organization_id, g.property_id, g.event_id, e.source_id,
              CASE WHEN e.status = 'cancelled' THEN 'cancelled' ELSE 'ended' END, e.data_class, e.severity, e.headline,
              g.property_id || ':' || g.event_id || ':v' || g.matched_version || ':end'
         FROM gone g JOIN source_events e ON e.id = g.event_id
        -- A traffic event that is still active but no longer within the distance did not end.
        WHERE NOT (e.status = 'active' AND e.source_id IN ('trafikverket', 'sl_deviations'))
       ON CONFLICT (dedup_key) DO NOTHING
       RETURNING organization_id, property_id, source_id, change_type
     ), up AS (
       INSERT INTO property_event_matches (property_id, event_id, organization_id, match_method, distance_m, matched_version)
       SELECT property_id, event_id, organization_id, match_method, distance_m, version FROM cand
       ON CONFLICT (property_id, event_id) DO UPDATE SET
         last_matched_at = now(), match_method = EXCLUDED.match_method, distance_m = EXCLUDED.distance_m, matched_version = EXCLUDED.matched_version
       RETURNING 1
     )
     SELECT organization_id, property_id, source_id, change_type FROM new_changes
     UNION ALL
     SELECT organization_id, property_id, source_id, change_type FROM end_changes`,
    [options.organizationId ?? null],
  );
  return rows.map((r) => ({ organizationId: r.organization_id, propertyId: r.property_id, sourceId: r.source_id, changeType: r.change_type }));
}

/* ------------------------------------------------------------------ */
/* Station observations (central snapshots)                            */
/* ------------------------------------------------------------------ */

export interface StationObservationInput {
  stationId: string;
  parameter: string;
  name: string;
  lat: number;
  lon: number;
  value: number | null;
  unit: string | null;
  observedAt: string | null;
  quality: string | null;
  extra: Record<string, unknown>;
}

export async function upsertStationObservations(db: Queryable, sourceId: string, obs: StationObservationInput[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < obs.length; i += 500) {
    const chunk = obs.slice(i, i + 500).filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon) && Math.abs(o.lat) <= 90 && Math.abs(o.lon) <= 180);
    if (!chunk.length) continue;
    const { rowCount } = await db.query(
      `INSERT INTO observation_stations (source_id, station_id, parameter, name, location, value, unit, observed_at, quality, extra, fetched_at)
       SELECT $1, x.station_id, x.parameter, x.name, ST_SetSRID(ST_MakePoint(x.lon, x.lat), 4326)::geography,
              x.value, x.unit, x.observed_at, x.quality, COALESCE(x.extra, '{}'::jsonb), now()
         FROM jsonb_to_recordset($2::jsonb) AS x(station_id text, parameter text, name text, lat double precision, lon double precision,
              value double precision, unit text, observed_at timestamptz, quality text, extra jsonb)
       ON CONFLICT (source_id, station_id, parameter) DO UPDATE SET
         name = EXCLUDED.name, location = EXCLUDED.location, value = EXCLUDED.value, unit = EXCLUDED.unit,
         observed_at = EXCLUDED.observed_at, quality = EXCLUDED.quality, extra = EXCLUDED.extra, fetched_at = now()
       WHERE observation_stations.observed_at IS NULL OR EXCLUDED.observed_at >= observation_stations.observed_at`,
      [
        sourceId,
        JSON.stringify(
          chunk.map((o) => ({ station_id: o.stationId, parameter: o.parameter, name: o.name, lat: o.lat, lon: o.lon, value: o.value, unit: o.unit, observed_at: o.observedAt, quality: o.quality, extra: o.extra })),
        ),
      ],
    );
    n += rowCount ?? 0;
    if (sourceId === 'air_quality') {
      // ADR 0007: the shared observation_history lacks unit/extra and uses rounded values.
      // The index needs revisable, original-precision hourly inputs with station metadata.
      await db.query(
        `INSERT INTO station_observation_history (source_id, station_id, parameter, observed_at, value, unit, quality, extra)
         SELECT $1, x.station_id, x.parameter, x.observed_at, x.value, x.unit, x.quality, x.extra
           FROM jsonb_to_recordset($2::jsonb) AS x(station_id text, parameter text, observed_at timestamptz,
                value double precision, unit text, quality text, extra jsonb)
          WHERE x.value IS NOT NULL AND x.observed_at IS NOT NULL AND x.extra->>'resolution' = 'hour'
         ON CONFLICT (source_id, station_id, parameter, observed_at) DO UPDATE SET
           value = EXCLUDED.value, unit = EXCLUDED.unit, quality = EXCLUDED.quality, extra = EXCLUDED.extra, fetched_at = now()`,
        [sourceId, JSON.stringify(chunk.map((o) => ({ station_id: o.stationId, parameter: o.parameter, observed_at: o.observedAt,
          value: typeof o.extra.rawValue === 'number' ? o.extra.rawValue : o.value, unit: o.unit, quality: o.quality, extra: o.extra })))],
      );
    }
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Per-property forecast / context (system writes)                     */
/* ------------------------------------------------------------------ */

export async function upsertPropertyForecast(
  db: Queryable,
  f: { propertyId: string; organizationId: string; sourceId: string; referenceTime: string | null; createdTime: string | null; grid: { lat: number; lon: number } | null; series: unknown },
): Promise<void> {
  await db.query(
    `INSERT INTO property_forecasts (property_id, organization_id, source_id, reference_time, created_time, grid_point, distance_m, series, fetched_at)
     SELECT p.id, p.organization_id, $3, $4, $5, g.pt,
            CASE WHEN g.pt IS NULL THEN NULL ELSE round(ST_Distance(g.pt, p.location)::numeric, 0) END, $8::jsonb, now()
       FROM properties p
       CROSS JOIN LATERAL (SELECT CASE WHEN $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7::float8, $6::float8), 4326)::geography END AS pt) g
      WHERE p.id = $1 AND p.organization_id = $2
     ON CONFLICT (property_id) DO UPDATE SET
       reference_time = EXCLUDED.reference_time, created_time = EXCLUDED.created_time, grid_point = EXCLUDED.grid_point,
       distance_m = EXCLUDED.distance_m, series = EXCLUDED.series, fetched_at = now(), source_id = EXCLUDED.source_id`,
    [f.propertyId, f.organizationId, f.sourceId, f.referenceTime, f.createdTime, f.grid?.lat ?? null, f.grid?.lon ?? null, JSON.stringify(f.series)],
  );
}

export interface ContextInput {
  propertyId: string;
  organizationId: string;
  sourceId: string;
  contextKey: string;
  dataClass: 'FORECAST' | 'MODEL' | 'OBSERVATION' | 'STATIC_GEODATA' | 'REGIONAL_STATISTIC';
  status: 'ok' | 'no_coverage' | 'source_unavailable' | 'not_applicable' | 'unknown';
  payload: Record<string, unknown>;
  sourceTimestamp: string | null;
}

export async function upsertPropertyContext(db: Queryable, c: ContextInput): Promise<void> {
  await db.query(
    `INSERT INTO property_context (property_id, organization_id, source_id, context_key, data_class, status, payload, source_timestamp, fetched_at, for_location)
     SELECT p.id, p.organization_id, $3, $4, $5, $6, $7::jsonb, $8, now(), p.location
       FROM properties p WHERE p.id = $1 AND p.organization_id = $2
     ON CONFLICT (property_id, source_id, context_key) DO UPDATE SET
       data_class = EXCLUDED.data_class, status = EXCLUDED.status, payload = EXCLUDED.payload,
       source_timestamp = EXCLUDED.source_timestamp, fetched_at = now(), for_location = EXCLUDED.for_location`,
    [c.propertyId, c.organizationId, c.sourceId, c.contextKey, c.dataClass, c.status, JSON.stringify(c.payload), c.sourceTimestamp],
  );
}

/**
 * Properties whose context for (source, key) is missing, older than `maxAgeSeconds`, or was
 * computed for a different location (pin moved). Oldest first, capped at `limit`.
 */
export async function propertiesNeedingContext(db: Queryable, sourceId: string, contextKey: string, maxAgeSeconds: number, limit: number): Promise<MonitoringTarget[]> {
  const { rows } = await db.query<{ id: string; organization_id: string; lat: number; lon: number; municipality: string | null; updated_at: Date }>(
    `SELECT p.id, p.organization_id, ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lon, p.municipality, p.updated_at
       FROM properties p
       LEFT JOIN property_context c ON c.property_id = p.id AND c.source_id = $1 AND c.context_key = $2
      WHERE p.status <> 'paused'
        AND (c.property_id IS NULL OR c.fetched_at < now() - make_interval(secs => $3)
             OR c.for_location IS NULL OR NOT ST_DWithin(c.for_location, p.location, 1))
      ORDER BY c.fetched_at NULLS FIRST, p.created_at
      LIMIT $4`,
    [sourceId, contextKey, maxAgeSeconds, limit],
  );
  return rows.map((r) => ({ propertyId: r.id, organizationId: r.organization_id, lat: r.lat, lon: r.lon, municipality: r.municipality, updatedAt: r.updated_at }));
}

/* ------------------------------------------------------------------ */
/* Retention                                                           */
/* ------------------------------------------------------------------ */

export const RETENTION = {
  endedEventsDays: 7,
  changesDays: 30,
  runsDays: 14,
  stationSilentDays: 2,
  nowcastDays: 1,
  observationHistoryDays: 35,
} as const;

// Use exactly the same rounding for cache writes, tenant reads, change hints and retention.
const NOWCAST_POINT_KEY = `round(ST_Y(p.location::geometry)::numeric,2)::text || ',' || round(ST_X(p.location::geometry)::numeric,2)::text`;

export async function applyRetention(db: Queryable): Promise<Record<string, number>> {
  const del = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rowCount ?? 0;
  return {
    // Utility outages keep 30 days of history (applyUtilityOutageRetention).
    events: await del(`DELETE FROM source_events WHERE status <> 'active' AND source_id <> 'utility_outages' AND ended_at < now() - make_interval(days => $1)`, [RETENTION.endedEventsDays]),
    utilityOutages: await applyUtilityOutageRetention(db),
    changes: await del(`DELETE FROM monitoring_changes WHERE created_at < now() - make_interval(days => $1)`, [RETENTION.changesDays]),
    runs: await del(`DELETE FROM integration_runs WHERE started_at < now() - make_interval(days => $1)`, [RETENTION.runsDays]),
    observationHistory: await del(`DELETE FROM observation_history WHERE observed_at < now() - make_interval(days => $1)`, [RETENTION.observationHistoryDays]),
    // Still honour Expires if a pin is reactivated or added again before that time.
    nowcast: await del(`DELETE FROM nowcast_points n WHERE n.expires_at <= now()
      AND (n.fetched_at < now() - make_interval(days => $1)
        OR NOT EXISTS (SELECT 1 FROM properties p WHERE p.status <> 'paused' AND (${NOWCAST_POINT_KEY}) = n.point_key))`, [RETENTION.nowcastDays]),
    forecastGrid: await pruneForecastGridPoints(db),
    stations: await del(`DELETE FROM observation_stations WHERE fetched_at < now() - make_interval(days => $1)`, [RETENTION.stationSilentDays]),
    stationHistory: await del(`DELETE FROM station_observation_history WHERE observed_at < now() - interval '7 days'`, []),
  };
}

/* ------------------------------------------------------------------ */
/* TENANT reads (organization-scoped)                                  */
/* ------------------------------------------------------------------ */

export interface OrgEventRow {
  property_id: string;
  match_method: string;
  distance_m: string | null;
  first_matched_at: Date;
  id: string;
  source_id: string;
  external_id: string;
  data_class: 'OFFICIAL_WARNING' | 'PUBLIC_EVENT';
  category: string;
  level: string | null;
  severity: string;
  event_type: string;
  headline: string;
  description: string | null;
  area_label: string | null;
  published_at: Date | null;
  source_updated_at: Date | null;
  valid_from: Date | null;
  valid_to: Date | null;
  version: number;
  source_url: string | null;
  attribution: string;
  extra: Record<string, unknown>;
  last_seen_at: Date;
  point_lat: number | null;
  point_lon: number | null;
}

export interface OrgContextRow {
  property_id: string;
  source_id: string;
  context_key: string;
  data_class: string;
  status: string;
  payload: Record<string, unknown>;
  source_timestamp: Date | null;
  fetched_at: Date;
}

export interface OrgObservationRow {
  property_id: string;
  source_id: string;
  parameter: string;
  station_id: string;
  name: string;
  value: number | null;
  unit: string | null;
  observed_at: Date | null;
  quality: string | null;
  extra: Record<string, unknown>;
  fetched_at: Date;
  distance_m: number;
}

export interface OrgMonitoringData {
  history?: ObservationHistoryRow[];
  hydrologyReferences?: HydrologyReferenceRow[];
  nowcasts?: Array<NowcastRow & { property_id: string }>;
  forecasts: OrgForecastRow[];
  events: OrgEventRow[];
  contexts: OrgContextRow[];
  observations: OrgObservationRow[];
  airHistory?: OrgObservationRow[];
  counties: Array<{ property_id: string; code: string; name: string }>;
}

/** Parameters looked up per property: [source, parameter, max age (h)]. */
export const NEAREST_PARAMETERS: Array<[string, string, number]> = [
  ['smhi_hydrology', 'water_flow', 3],
  ['smhi_oceanography', 'sea_level', 3],
  ['smhi_observations', 'air_temperature', 3],
  ['smhi_observations', 'wind_speed', 3],
  ['smhi_observations', 'wind_gust', 3],
  ['smhi_observations', 'wind_direction', 3],
  ['smhi_observations', 'relative_humidity', 3],
  ['smhi_observations', 'precipitation_1h', 3],
  ['smhi_observations', 'precipitation_15min', 3],
  ['air_quality', 'pm25', 6],
  ['air_quality', 'pm10', 6],
  ['air_quality', 'no2', 6],
  ['air_quality', 'o3', 6],
  ['air_quality', 'so2', 6],
];

/**
 * Loads every monitoring record for an organization (optionally one property) with 5 queries.
 * No external API is called on this path.
 */
/**
 * What the portfolio LIST reads (docs/plans/skalning.md, Fas 3 steg 3 / S-16). The list leaves out the
 * forecast series beyond the next day, measured rain and nearby observations (`listSnapshot`), so
 * it does not need to load them:
 *  - nearest stations only for flood (water flow, sea level), the air-quality metrics and the risk index;
 *  - station history only for the flood trends (not 15-minute rain);
 *  - forecast steps from 3 h ago to 54 h ahead: the current hour, the next 24 h (metrics, risk) and
 *    48 h (upcoming conditions, incl. a frost spell), with a margin for 6-hour steps.
 * The list built this way equals `listSnapshot` of the full build (checked at 500 properties by
 * tests/perf/portfolio-scale.ts `profile`).
 */
export const LIST_NEAREST_PARAMETERS = NEAREST_PARAMETERS.filter(([source, parameter]) =>
  (source === 'smhi_hydrology' && parameter === 'water_flow') || (source === 'smhi_oceanography' && parameter === 'sea_level')
  || (source === 'air_quality' && ['pm25', 'pm10', 'no2'].includes(parameter)));
export const LIST_FORECAST_WINDOW_H = { before: 3, after: 54 } as const;

export interface LoadMonitoringOptions {
  /** Load only what the portfolio list reads, for the list at this time. */
  list?: { now: Date };
}

/**
 * Everything the snapshot builder needs for an organization – or for some of its properties
 * (one property page, or the rows a live update patches: docs/plans/skalning.md, S-12).
 */
export async function loadOrgMonitoring(db: Queryable, organizationId: string, propertyIds?: string | string[], options: LoadMonitoringOptions = {}): Promise<OrgMonitoringData> {
  const pid = propertyIds === undefined ? null : Array.isArray(propertyIds) ? propertyIds : [propertyIds];
  const list = options.list;
  const window = list ? {
    from: new Date(list.now.getTime() - LIST_FORECAST_WINDOW_H.before * 3_600_000).toISOString(),
    to: new Date(list.now.getTime() + LIST_FORECAST_WINDOW_H.after * 3_600_000).toISOString(),
  } : undefined;
  const nearest = list ? LIST_NEAREST_PARAMETERS : NEAREST_PARAMETERS;
  const historyParameters = list ? ['sea_level', 'water_flow'] : ['sea_level', 'water_flow', 'precipitation_15min'];
  const [forecasts, events, contexts, observations, counties, nowcasts, hydrologyReferences, history, airHistory] = await Promise.all([
    loadPropertyForecasts(db, organizationId, pid, window),
    db.query<OrgEventRow>(
      `SELECT m.property_id, m.match_method, m.distance_m, m.first_matched_at,
              e.id, e.source_id, e.external_id, e.data_class, e.category, e.level, e.severity, e.event_type, e.headline, e.description,
              e.area_label, e.published_at, e.source_updated_at, e.valid_from, e.valid_to, e.version, e.source_url, e.attribution, e.extra, e.last_seen_at,
              CASE WHEN e.source_id IN ('trafikverket', 'sl_deviations') AND e.geom IS NOT NULL THEN ST_Y(ST_ClosestPoint(e.geom, p.location::geometry)) END AS point_lat,
              CASE WHEN e.source_id IN ('trafikverket', 'sl_deviations') AND e.geom IS NOT NULL THEN ST_X(ST_ClosestPoint(e.geom, p.location::geometry)) END AS point_lon
         FROM property_event_matches m
         JOIN source_events e ON e.id = m.event_id AND e.status = 'active'
         JOIN properties p ON p.id = m.property_id AND p.organization_id = $1
        WHERE m.organization_id = $1 AND ($2::uuid[] IS NULL OR m.property_id = ANY($2::uuid[]))
        ORDER BY e.severity DESC, m.distance_m NULLS LAST, e.published_at DESC NULLS LAST`,
      [organizationId, pid],
    ),
    db.query<OrgContextRow>(
      `SELECT property_id, source_id, context_key, data_class, status, payload, source_timestamp, fetched_at
         FROM property_context WHERE organization_id = $1 AND ($2::uuid[] IS NULL OR property_id = ANY($2::uuid[]))`,
      [organizationId, pid],
    ),
    db.query<OrgObservationRow>(
      `SELECT p.id AS property_id, par.source_id, par.parameter, o.station_id, o.name, o.value, o.unit, o.observed_at, o.quality, o.extra, o.fetched_at, o.distance_m
         FROM properties p
        CROSS JOIN jsonb_to_recordset($3::jsonb) AS par(source_id text, parameter text, max_age_h integer)
        CROSS JOIN LATERAL (
          SELECT s.station_id, s.name, s.value, s.unit, s.observed_at, s.quality, s.extra, s.fetched_at,
                 ST_Distance(s.location, p.location) AS distance_m
            FROM observation_stations s
           WHERE s.source_id = par.source_id AND s.parameter = par.parameter AND s.value IS NOT NULL
             AND s.observed_at > now() - make_interval(hours => par.max_age_h)
           ORDER BY s.location <-> p.location
           LIMIT 1) o
        WHERE p.organization_id = $1 AND ($2::uuid[] IS NULL OR p.id = ANY($2::uuid[]))`,
      [organizationId, pid, JSON.stringify(nearest.map(([source_id, parameter, max_age_h]) => ({ source_id, parameter, max_age_h })))],
    ),
    db.query<{ property_id: string; code: string; name: string }>(
      `SELECT p.id AS property_id, a.code, a.name
         FROM properties p JOIN admin_areas a ON a.kind = 'county' AND ST_Covers(a.geom, p.location::geometry)
        WHERE p.organization_id = $1 AND ($2::uuid[] IS NULL OR p.id = ANY($2::uuid[]))`,
      [organizationId, pid],
    ),
    loadOrgNowcasts(db, organizationId, pid ?? undefined),
    db.query<HydrologyReferenceRow>(`SELECT r.* FROM hydrology_references r JOIN observation_stations s ON s.source_id=r.source_id AND s.station_id=r.station_id AND s.parameter='water_flow'
      WHERE EXISTS(SELECT 1 FROM properties p WHERE p.organization_id=$1 AND ($2::uuid[] IS NULL OR p.id = ANY($2::uuid[])) AND ST_DWithin(s.location,p.location,$3))`,[organizationId,pid,WEATHER_WATER.flowDistanceM]),
    db.query<ObservationHistoryRow>(`SELECT h.* FROM observation_history h JOIN observation_stations s ON s.source_id=h.source_id AND s.station_id=h.station_id AND s.parameter=h.parameter
      WHERE h.parameter = ANY($6::text[]) AND h.observed_at > now()-interval '73 hours'
        AND EXISTS(SELECT 1 FROM properties p WHERE p.organization_id=$1 AND ($2::uuid[] IS NULL OR p.id = ANY($2::uuid[]))
          AND ST_DWithin(p.location,s.location,CASE h.source_id WHEN 'smhi_oceanography' THEN $3::double precision WHEN 'smhi_hydrology' THEN $4::double precision ELSE $5::double precision END))
      ORDER BY h.source_id,h.station_id,h.parameter,h.observed_at`,[organizationId,pid,WEATHER_WATER.seaDistanceM,WEATHER_WATER.flowDistanceM,WEATHER_WATER.observationDistanceM,historyParameters]),
    db.query<OrgObservationRow>(
      `SELECT p.id AS property_id, h.source_id, h.station_id, h.parameter, s.name, h.value, h.unit,
              h.observed_at, h.quality, h.extra, h.fetched_at, ST_Distance(s.location, p.location) AS distance_m
         FROM properties p JOIN observation_stations s ON s.source_id = 'air_quality'
          AND ST_DWithin(s.location, p.location, 25000)
         JOIN station_observation_history h ON h.source_id = s.source_id AND h.station_id = s.station_id AND h.parameter = s.parameter
        WHERE p.organization_id = $1 AND ($2::uuid[] IS NULL OR p.id = ANY($2::uuid[]))
          AND h.observed_at >= now() - interval '3 hours' AND h.observed_at <= now()`,
      [organizationId, pid],
    ),
  ]);
  return { history:history.rows, hydrologyReferences:hydrologyReferences.rows, nowcasts, forecasts, events: events.rows, contexts: contexts.rows, observations: observations.rows, counties: counties.rows, airHistory: airHistory.rows };
}

/** The stored radar nowcast of an organization's properties (all, or the given ones). */
export async function loadOrgNowcasts(db: Queryable, organizationId: string, propertyIds?: string[]): Promise<Array<NowcastRow & { property_id: string }>> {
  const { rows } = await db.query<NowcastRow & { property_id: string }>(
    `SELECT p.id AS property_id, n.* FROM properties p JOIN nowcast_points n ON n.point_key = (${NOWCAST_POINT_KEY})
      WHERE p.organization_id = $1 AND ($2::uuid[] IS NULL OR p.id = ANY($2::uuid[]))`, [organizationId, propertyIds ?? null]);
  return rows;
}

/**
 * One feed event: the same revision of the same source event, over every property it reaches (a
 * change without an event is its own). Matches how the dashboard groups feed rows into one card.
 */
const feedEventKey = (t: string) => `CASE WHEN ${t}.event_id IS NULL THEN ${t}.id::text
  ELSE ${t}.source_id || ':' || ${t}.event_id || ':' || ${t}.change_type || ':'
    || COALESCE(substring(${t}.dedup_key from ':v([0-9]+)(:|$)'), extract(epoch from ${t}.created_at)::text) END`;
/** Rows of the feed's events at most (a few county warnings over 1000 properties fit). */
export const FEED_ROW_CAP = 5_000;

export async function listRecentChangesForOrg(db: Queryable, organizationId: string, limit = 50, viewerId?: string) {
  const forPortfolio = viewerId !== undefined;
  const changeKey = `CASE WHEN c.source_id = 'trafikverket' AND c.event_id IS NOT NULL
    THEN c.property_id || ':' || c.event_id ELSE c.id::text END`;
  // Limit the feed by EVENT (docs/plans/skalning.md, Fas 2 / S-04): one revision of one event over 300
  // properties is one of the `limit` events – with all 300 rows – instead of taking every place.
  // Then fetch the rows needed for each traffic event's lifecycle. Keep the first visible row even
  // when it predates the recent window.
  const portfolioRows = `WITH latest AS (
    SELECT DISTINCT ON (${changeKey}) c.*
    FROM monitoring_changes c WHERE c.organization_id = $1
      AND (c.source_id <> 'trafikverket' OR c.severity IN ('warning', 'critical'))
    ORDER BY ${changeKey}, c.created_at DESC, c.id DESC
  ), events AS (
    SELECT ${feedEventKey('l')} AS feed_key FROM latest l
    GROUP BY 1 ORDER BY max(l.created_at) DESC, max(l.id) DESC LIMIT $2
  ), recent AS (
    SELECT l.* FROM latest l WHERE ${feedEventKey('l')} IN (SELECT feed_key FROM events)
    ORDER BY l.created_at DESC, l.id DESC LIMIT ${FEED_ROW_CAP}
  ), feed_changes AS (
    SELECT * FROM recent
    UNION
    SELECT related.* FROM recent r CROSS JOIN LATERAL (
      WITH versions AS (
        SELECT c.* FROM monitoring_changes c
        WHERE r.source_id = 'trafikverket' AND c.organization_id = r.organization_id
          AND c.source_id = r.source_id AND c.event_id = r.event_id AND c.property_id = r.property_id
      )
      (SELECT * FROM versions WHERE severity IN ('warning', 'critical') AND change_type IN ('new', 'updated')
       ORDER BY created_at, id LIMIT 1)
      UNION
      (SELECT DISTINCT ON (change_type) * FROM versions ORDER BY change_type, created_at DESC, id DESC)
    ) related
  )`;
  const { rows } = await db.query<{
    id: string; property_id: string; event_id: string | null; source_id: string; change_type: string; data_class: string; severity: string; headline: string; created_at: Date;
    event_ended_on_map: boolean; outage_on_map: boolean; event_active: boolean; superseded: boolean; acknowledged_at: Date | null; update_read?: boolean;
    dedup_key: string;
    event_type: string | null; situation_id: string | null; event_valid_from: Date | null; event_valid_to: Date | null; event_description: string | null;
  }>(
    `${forPortfolio ? portfolioRows : ''}
     SELECT c.id::text, c.property_id, c.event_id::text AS event_id, c.source_id, c.change_type, c.data_class, c.severity, c.headline, c.created_at, c.dedup_key,
            COALESCE(e.status <> 'active' AND e.geom IS NOT NULL AND e.source_id IN ${FEED_MAP_SOURCES_SQL}, false) AS event_ended_on_map,
            COALESCE(e.status = 'active' AND e.geom IS NOT NULL AND e.source_id = 'utility_outages', false) AS outage_on_map,
            COALESCE(e.status = 'active', false) AS event_active,
            ${forPortfolio ? `EXISTS (SELECT 1 FROM feed_update_reads r WHERE r.organization_id = c.organization_id AND r.viewer_id = $3 AND r.change_id = c.id) AS update_read,` : ''}
            e.event_type, e.extra->>'situationId' AS situation_id, e.valid_from AS event_valid_from, e.valid_to AS event_valid_to, e.description AS event_description,
            EXISTS (SELECT 1 FROM monitoring_changes l
                     WHERE l.event_id = c.event_id AND l.property_id = c.property_id AND l.organization_id = c.organization_id
                       AND (l.created_at, l.id) > (c.created_at, c.id)) AS superseded,
            ack.acknowledged_at
       FROM ${forPortfolio ? 'feed_changes' : 'monitoring_changes'} c
       LEFT JOIN source_events e ON e.id = c.event_id
       LEFT JOIN feed_acknowledgements ack ON ack.organization_id = c.organization_id AND ack.change_id = c.id
      WHERE c.organization_id = $1 ORDER BY c.created_at DESC, c.id DESC ${forPortfolio ? '' : 'LIMIT $2'}`,
    forPortfolio ? [organizationId, limit, viewerId] : [organizationId, limit],
  );
  return rows;
}

/** Records exactly the traffic revision this viewer opened. Reopening it is idempotent. */
export async function markFeedUpdateRead(db: Queryable, organizationId: string, changeId: string, viewerId: string): Promise<void> {
  await db.query(
    `INSERT INTO feed_update_reads (organization_id, change_id, viewer_id)
     SELECT c.organization_id, c.id, $3 FROM monitoring_changes c
     WHERE c.organization_id = $1 AND c.id = $2::bigint AND c.source_id = 'trafikverket' AND c.change_type IN ('new', 'updated')
     ON CONFLICT DO NOTHING`,
    [organizationId, changeId, viewerId],
  );
}

const severityRankSql = (t: string) =>
  `CASE ${t}.severity ${Object.entries(FEED_ACK_SEVERITY_RANK).map(([k, v]) => `WHEN '${k}' THEN ${v}`).join(' ')} ELSE 0 END`;

/** Current alarms are independent of the history feed limit. Only a start or escalation creates a new unread id. */
export async function listActiveAlarmChangesForOrg(db: Queryable, organizationId: string, viewerId: string) {
  const { rows } = await db.query<{
    id: string; event_id: string; property_id: string; source_id: string; change_type: string;
    severity: string; headline: string; created_at: Date; event_active: boolean; outage_on_map: boolean;
    acknowledged_at: Date | null; unread_alarm_id: string | null;
    dedup_key: string | null;
  }>(
    `SELECT COALESCE(latest.id::text, 'alarm-' || m.property_id || ':' || e.id) AS id,
            e.id::text AS event_id, m.property_id, e.source_id,
            COALESCE(latest.change_type, 'active') AS change_type,
            COALESCE(m.effective_severity, e.severity) AS severity, COALESCE(latest.headline, e.headline) AS headline,
            COALESCE(latest.created_at, m.first_matched_at) AS created_at, true AS event_active,
            latest.dedup_key,
            e.source_id = 'utility_outages' AND e.geom IS NOT NULL AS outage_on_map,
            CASE WHEN seen.change_id IS NULL THEN notification.id::text END AS unread_alarm_id,
            ack.acknowledged_at
       FROM property_event_matches m
       JOIN source_events e ON e.id = m.event_id AND e.status = 'active'
       JOIN properties p ON p.id = m.property_id AND p.organization_id = m.organization_id AND p.status <> 'paused'
       LEFT JOIN LATERAL (
         SELECT c.id, c.created_at, c.change_type, c.severity, c.headline, c.dedup_key FROM monitoring_changes c
         WHERE c.organization_id = m.organization_id AND c.event_id = m.event_id AND c.property_id = m.property_id
           AND c.created_at >= m.first_matched_at
         ORDER BY c.created_at DESC, c.id DESC LIMIT 1
       ) latest ON true
       LEFT JOIN feed_acknowledgements ack ON ack.organization_id = m.organization_id AND ack.change_id = latest.id
       LEFT JOIN LATERAL (
         SELECT ranked.id FROM (
           SELECT c.id, c.created_at, c.change_type, ${severityRankSql('c')} AS rank,
                  lag(CASE WHEN c.change_type IN ('ended', 'cancelled') THEN 0 ELSE ${severityRankSql('c')} END)
                    OVER (ORDER BY c.created_at, c.id) AS previous_rank
           FROM monitoring_changes c
           WHERE c.organization_id = m.organization_id AND c.event_id = m.event_id AND c.property_id = m.property_id
             AND c.created_at >= m.first_matched_at
         ) ranked
         WHERE ranked.rank >= CASE WHEN e.source_id = 'utility_outages' THEN 2 ELSE 1 END
           AND (ranked.change_type = 'new' OR (ranked.change_type = 'updated' AND ranked.rank > ranked.previous_rank))
         ORDER BY ranked.created_at DESC, ranked.id DESC LIMIT 1
       ) notification ON true
       LEFT JOIN feed_update_reads seen ON seen.organization_id = m.organization_id AND seen.viewer_id = $2 AND seen.change_id = notification.id
      WHERE m.organization_id = $1 AND (
        (e.data_class = 'OFFICIAL_WARNING' AND e.level IS NOT NULL AND e.level <> 'Info')
        OR (e.source_id = 'utility_outages' AND m.effective_severity IN ('warning', 'critical'))
      )
      ORDER BY COALESCE(latest.created_at, m.first_matched_at) DESC, m.property_id, m.event_id`,
    [organizationId, viewerId],
  );
  return rows;
}

/** Mark the alarm revisions rendered for this viewer. A later revision has a different id. */
export async function markAlarmChangesRead(db: Queryable, organizationId: string, changeIds: string[], viewerId: string): Promise<void> {
  await db.query(
    `INSERT INTO feed_update_reads (organization_id, change_id, viewer_id)
     SELECT c.organization_id, c.id, $3 FROM monitoring_changes c
     WHERE c.organization_id = $1 AND c.id = ANY($2::bigint[])
       AND c.change_type IN ('new', 'updated')
       AND (c.data_class = 'OFFICIAL_WARNING' OR c.source_id = 'utility_outages')
     ON CONFLICT DO NOTHING`,
    [organizationId, changeIds, viewerId],
  );
}

/**
 * TENANT write: acknowledge a feed row for the whole organization (only a row of its own feed).
 * Returns the acknowledgement time, or null when the row is not the organization's.
 */
export async function acknowledgeFeedChange(db: Queryable, organizationId: string, changeId: string, userId: string): Promise<Date | null> {
  const { rows } = await db.query<{ acknowledged_at: Date }>(
    `INSERT INTO feed_acknowledgements (organization_id, change_id, acknowledged_by)
     SELECT c.organization_id, c.id, $3 FROM monitoring_changes c WHERE c.id = $2::bigint AND c.organization_id = $1
     ON CONFLICT (organization_id, change_id) DO UPDATE SET change_id = EXCLUDED.change_id
     RETURNING acknowledged_at`,
    [organizationId, changeId, userId],
  );
  return rows[0]?.acknowledged_at ?? null;
}

/**
 * TENANT write: undo the acknowledgement of this feed row.
 */
export async function unacknowledgeFeedChange(db: Queryable, organizationId: string, changeId: string, userId: string): Promise<void> {
  await db.query(
    `WITH removed AS (
       DELETE FROM feed_acknowledgements a
       WHERE a.organization_id = $1 AND a.change_id = $2::bigint
       RETURNING a.change_id, a.acknowledged_at
     )
     UPDATE feed_acknowledgement_history h
     SET undone_at = GREATEST(clock_timestamp(), h.acknowledged_at), undone_by = $3
     FROM removed r
     WHERE h.organization_id = $1 AND h.change_id = r.change_id AND h.acknowledged_at = r.acknowledged_at AND h.undone_at IS NULL`,
    [organizationId, changeId, userId],
  );
}

/** At most this many feed rows per batch acknowledgement (a county warning over 1000 properties). */
export const FEED_ACK_BATCH_MAX = 1_000;

/**
 * TENANT write: acknowledge many feed rows at once – "Kvittera alla" on an event over many properties
 * (docs/plans/skalning.md, Fas 2 / S-05). One statement, so all or none; only rows of the organization.
 * The history trigger still writes one row per property (the report needs them). Rows already
 * acknowledged keep their time. Returns each acknowledged row's time.
 */
export async function acknowledgeFeedChanges(db: Queryable, organizationId: string, changeIds: string[], userId: string): Promise<Array<{ change_id: string; acknowledged_at: Date }>> {
  const { rows } = await db.query<{ change_id: string; acknowledged_at: Date }>(
    `INSERT INTO feed_acknowledgements (organization_id, change_id, acknowledged_by)
     SELECT c.organization_id, c.id, $3 FROM monitoring_changes c WHERE c.organization_id = $1 AND c.id = ANY($2::bigint[])
     ON CONFLICT (organization_id, change_id) DO UPDATE SET change_id = EXCLUDED.change_id
     RETURNING change_id::text, acknowledged_at`,
    [organizationId, changeIds, userId],
  );
  return rows;
}

/** TENANT write: undo the acknowledgement of many feed rows ("Ångra" for a whole event), in one statement. */
export async function unacknowledgeFeedChanges(db: Queryable, organizationId: string, changeIds: string[], userId: string): Promise<string[]> {
  const { rows } = await db.query<{ change_id: string }>(
    `WITH removed AS (
       DELETE FROM feed_acknowledgements a
       WHERE a.organization_id = $1 AND a.change_id = ANY($2::bigint[])
       RETURNING a.change_id, a.acknowledged_at
     ), archived AS (
       UPDATE feed_acknowledgement_history h
       SET undone_at = GREATEST(clock_timestamp(), h.acknowledged_at), undone_by = $3
       FROM removed r
       WHERE h.organization_id = $1 AND h.change_id = r.change_id AND h.acknowledged_at = r.acknowledged_at AND h.undone_at IS NULL
     )
     SELECT change_id::text FROM removed`,
    [organizationId, changeIds, userId],
  );
  return rows.map((r) => r.change_id);
}

/**
 * TENANT read: a property's short activity log ("Tidslinje") – stored monitoring changes plus SMS
 * alerts that named the property, newest first. Traffic (several changes a day, already listed under
 * local events) and regional news are left out so warnings stay visible: Krisinformation only as VMA.
 */
export async function listPropertyActivity(db: Queryable, organizationId: string, propertyId: string, days: number = ACTIVITY.days, limit: number = ACTIVITY.limit): Promise<ActivityItem[]> {
  const [changes, sms] = await Promise.all([
    db.query<{ id: string; source_id: string; change_type: 'new' | 'updated' | 'ended' | 'cancelled'; severity: string; headline: string; created_at: Date; level: string | null; attribution: string | null }>(
      `SELECT c.id::text, c.source_id, c.change_type, c.severity, c.headline, c.created_at, e.level, e.attribution
         FROM monitoring_changes c LEFT JOIN source_events e ON e.id = c.event_id
        WHERE c.organization_id = $1 AND c.property_id = $2 AND c.created_at > now() - make_interval(days => $3)
          AND (c.source_id IN ('smhi_warnings', 'utility_outages') OR (c.source_id = 'krisinformation' AND c.severity = 'critical'))
        ORDER BY c.created_at DESC, c.id DESC LIMIT $4`,
      [organizationId, propertyId, days, limit],
    ),
    db.query<{ id: string; rule_name: string; status: string; is_test: boolean; at: Date; recipients: number }>(
      `SELECT min(n.id::text) AS id, n.rule_name, n.status, n.is_test, date_trunc('minute', n.created_at) AS at, count(*)::int AS recipients
         FROM notification_outbox n
         JOIN notification_properties np ON np.organization_id = n.organization_id AND np.notification_id = n.id
        WHERE n.organization_id = $1 AND np.property_id = $2 AND n.created_at > now() - make_interval(days => $3)
          AND n.status NOT IN ('queued', 'processing', 'retry')
        GROUP BY n.rule_name, n.status, n.is_test, date_trunc('minute', n.created_at)
        ORDER BY at DESC LIMIT $4`,
      [organizationId, propertyId, days, limit],
    ),
  ]);
  const items: ActivityItem[] = [
    ...changes.rows.map((r) => ({ kind: 'change' as const, id: `c${r.id}`, at: r.created_at.toISOString(), sourceId: r.source_id, changeType: r.change_type, severity: r.severity, level: r.level, headline: r.headline, attribution: r.attribution })),
    ...sms.rows.map((r) => ({ kind: 'sms' as const, id: `s${r.id}`, at: r.at.toISOString(), ruleName: r.rule_name, status: r.status, recipients: r.recipients, isTest: r.is_test })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Most map items returned per property; the matched list is already limited to events within 2 km. */
export const EVENT_MAP_LIMIT = 40;

/**
 * Published geometry of the property's matched traffic events for "Visa på karta" (organization
 * scoped through the property). Lines are simplified to ~1 m and rounded to 6 decimals.
 */
/** Sources whose published geometry is drawn in the property's "Visa på karta" (traffic). */
const MAP_SOURCES_SQL = `('trafikverket', 'sl_deviations')`;
/** …and from the dashboard feed, one event at a time: also utility outage areas. */
const FEED_MAP_SOURCES_SQL = `('trafikverket', 'sl_deviations', 'utility_outages')`;

/** Geometry SQL shared by the map reads: one drawable Point/LineString/area per event, simplified. */
const MAP_GEOMETRY_SQL = `ST_AsGeoJSON(CASE WHEN GeometryType(e.geom) = 'MULTIPOINT' THEN ST_GeometryN(e.geom, 1)
                              WHEN GeometryType(e.geom) = 'MULTILINESTRING' THEN ST_LineMerge(ST_SimplifyPreserveTopology(e.geom, 0.00001))
                              WHEN GeometryType(e.geom) = 'GEOMETRYCOLLECTION' THEN ST_SimplifyPreserveTopology(ST_CollectionExtract(e.geom, 3), 0.00005)
                              WHEN GeometryType(e.geom) IN ('POLYGON', 'MULTIPOLYGON') THEN ST_SimplifyPreserveTopology(e.geom, 0.00005)
                              ELSE ST_SimplifyPreserveTopology(e.geom, 0.00001) END, 6)::json AS geometry,
            CASE WHEN GeometryType(e.geom) IN ('LINESTRING', 'MULTILINESTRING') THEN round(ST_Length(e.geom::geography))::int END AS length_m`;

interface MapEventRow {
  event_id: string; source_id: string; event_type: string | null; headline: string; description: string | null; area_label: string | null;
  valid_from: Date | null; valid_to: Date | null; extra: Record<string, unknown> | null; geometry: unknown; length_m: number | null;
}

function mapItemOf(r: MapEventRow): EventMapItem | null {
  const g = EventMapGeometrySchema.safeParse(r.geometry);
  // Anything else (e.g. a GeometryCollection) cannot be drawn as a stretch or point: left out.
  if (!g.success) return null;
  const x = r.extra ?? {};
  const str = (k: string) => (typeof x[k] === 'string' && (x[k] as string).trim() ? (x[k] as string).trim() : null);
  const style = trafficMapStyle({ sourceId: r.source_id, messageCodeValue: str('messageCodeValue'), iconId: str('iconId'), transportMode: str('transportMode') });
  return {
    eventId: r.event_id,
    geometry: g.data,
    radiusM: null,
    lengthM: r.length_m === null ? null : Number(r.length_m),
    label: r.event_type?.trim() || 'Trafikhändelse',
    icon: style.icon,
    hue: style.hue,
    impact: str('severityText'),
    where: r.area_label?.trim() || eventPlaceFromHeadline(r.headline, r.event_type),
    description: r.description?.trim() || null,
    validFrom: r.valid_from ? r.valid_from.toISOString() : null,
    validTo: r.valid_to ? r.valid_to.toISOString() : null,
  };
}

interface OutageMapRow {
  utility: string | null; outage_kind: string | null; outage_state: string | null; outage_precision: string | null; affected_customers: number | null;
  actual_start: Date | null; planned_start: Date | null; planned_end: Date | null; estimated_restore: Date | null; restored_at: Date | null;
  place_label: string | null; cause: string | null;
}

const OUTAGE_EXTENT: Record<string, string> = {
  polygon: 'Område enligt nätbolaget',
  area: 'Ungefärligt område enligt nätbolaget',
  postal_area: 'Postnummerområde (ungefärligt)',
  point: 'Punkt enligt nätbolaget',
};
const UTILITY_LABEL: Record<string, string> = { electricity: 'strömavbrott', district_heating: 'fjärrvärmeavbrott', district_cooling: 'fjärrkyleavbrott', gas: 'gasavbrott', water: 'vattenavbrott' };

/** A utility outage on the map: its area, operator, customers and expected restoration. */
function outageItemOf(r: MapEventRow & OutageMapRow): EventMapItem | null {
  const g = EventMapGeometrySchema.safeParse(r.geometry);
  if (!g.success) return null;
  const noun = UTILITY_LABEL[r.utility ?? ''] ?? 'avbrott';
  const planned = r.outage_kind === 'planned';
  const noticeKind = r.extra?.noticeKind;
  const information = noticeKind === 'information' || noticeKind === 'water_restriction';
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    eventId: r.event_id,
    geometry: g.data,
    radiusM: null,
    lengthM: null,
    label: noticeKind === 'boil_water' ? 'Kokningsrekommendation' : information ? 'Vatten- och avloppsmeddelande' : planned ? (r.utility === 'water' ? 'Planerad vattenavstängning' : `Planerat ${noun}`) : noun[0]!.toUpperCase() + noun.slice(1),
    icon: r.utility === 'district_heating' ? 'heat' : r.utility === 'district_cooling' ? 'frost' : r.utility === 'water' ? 'water' : r.utility === 'gas' ? 'fire' : 'power',
    hue: information ? 'blue' : planned || r.outage_state === 'upcoming' ? 'orange' : 'red',
    impact: r.affected_customers ? `${r.affected_customers.toLocaleString('sv-SE')} kunder` : null,
    where: r.place_label?.trim() || (typeof r.extra?.operatorName === 'string' ? r.extra.operatorName : null),
    description: r.cause?.trim() || null,
    validFrom: iso(r.actual_start ?? r.planned_start ?? r.valid_from),
    validTo: iso(r.estimated_restore ?? r.planned_end ?? r.restored_at ?? r.valid_to),
    extent: OUTAGE_EXTENT[r.outage_precision ?? ''] ?? 'Område enligt nätbolaget',
  };
}

/**
 * TENANT read: one event from the organization's feed for this property, on the map – active or
 * ended (an ended event keeps its stretch until retention). Access: the event is in this property's
 * own feed rows (matches of an ended traffic event are gone) or matched to it (outages keep theirs).
 */
export async function getPropertyEventMapEvent(db: Queryable, organizationId: string, propertyId: string, eventId: string): Promise<PropertyEventMapEvent | null> {
  const { rows } = await db.query<MapEventRow & { status: string; ended_at: Date | null; distance_m: number | null } & OutageMapRow>(
    `SELECT e.id::text AS event_id, e.source_id, e.event_type, e.headline, e.description, e.area_label, e.valid_from, e.valid_to, e.extra,
            e.status, e.ended_at, round(ST_Distance(e.geom::geography, p.location))::int AS distance_m,
            u.utility, u.kind AS outage_kind, u.state AS outage_state, u.precision AS outage_precision, u.affected_customers,
            u.actual_start, u.planned_start, u.planned_end, u.estimated_restore, u.restored_at, u.place_label, u.cause,
            ${MAP_GEOMETRY_SQL}
       FROM source_events e
       JOIN properties p ON p.id = $2 AND p.organization_id = $1
       LEFT JOIN utility_outages u ON u.event_id = e.id
      WHERE e.id = $3 AND e.geom IS NOT NULL AND e.source_id IN ${FEED_MAP_SOURCES_SQL}
        AND (EXISTS (SELECT 1 FROM monitoring_changes c WHERE c.organization_id = $1 AND c.property_id = $2 AND c.event_id = e.id)
             OR EXISTS (SELECT 1 FROM property_event_matches m WHERE m.organization_id = $1 AND m.property_id = $2 AND m.event_id = e.id))`,
    [organizationId, propertyId, eventId],
  );
  const r = rows[0];
  const item = r ? (r.source_id === 'utility_outages' ? outageItemOf(r) : mapItemOf(r)) : null;
  if (!r || !item) return null;
  return {
    propertyId,
    item,
    title: r.headline,
    sourceId: r.source_id,
    sourceLabel: r.source_id === 'utility_outages' ? (typeof r.extra?.operatorName === 'string' ? r.extra.operatorName : null) : null,
    active: r.status === 'active',
    endedAt: r.status === 'active' ? null : (r.ended_at ?? r.valid_to)?.toISOString() ?? null,
    distanceM: r.distance_m === null ? null : Number(r.distance_m),
  };
}

/** One source event, as an event page shows it (docs/plans/skalning.md, Fas 2 / S-09). */
export interface EventPageEventRow {
  id: string; source_id: string; data_class: string; level: string | null; severity: string; headline: string; description: string | null;
  area_label: string | null; published_at: Date | null; valid_from: Date | null; valid_to: Date | null; status: string; source_url: string | null;
  extra: Record<string, unknown> | null;
}
/** A property the event reaches (or reached): its newest feed row of the event and that row's acknowledgement. */
export interface EventPagePropertyRow {
  property_id: string; name: string; address: string; lat: number; lon: number; matched: boolean;
  change_id: string | null; change_type: string | null; change_severity: string | null; superseded: boolean; acknowledged_at: Date | null;
}

const ORG_HAS_EVENT = `(EXISTS (SELECT 1 FROM property_event_matches m WHERE m.organization_id = $1 AND m.event_id = e.id)
  OR EXISTS (SELECT 1 FROM monitoring_changes c WHERE c.organization_id = $1 AND c.event_id = e.id))`;

/**
 * TENANT read: an event and every property of the organization it reaches – null when the event never
 * reached the organization (another tenant's event is indistinguishable from a missing one).
 */
export async function loadOrgEvent(db: Queryable, organizationId: string, eventId: string): Promise<{ event: EventPageEventRow; properties: EventPagePropertyRow[] } | null> {
  const [events, properties] = await Promise.all([
    db.query<EventPageEventRow>(
      `SELECT e.id::text, e.source_id, e.data_class, e.level, e.severity, e.headline, e.description, e.area_label,
              e.published_at, e.valid_from, e.valid_to, e.status, e.source_url, e.extra
         FROM source_events e WHERE e.id = $2::uuid AND ${ORG_HAS_EVENT}`,
      [organizationId, eventId],
    ),
    db.query<EventPagePropertyRow>(
      `SELECT p.id AS property_id, p.name, p.address, ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lon,
              m.event_id IS NOT NULL AS matched, latest.id::text AS change_id, latest.change_type, latest.severity AS change_severity,
              false AS superseded, ack.acknowledged_at
         FROM properties p
         LEFT JOIN property_event_matches m ON m.organization_id = $1 AND m.property_id = p.id AND m.event_id = $2::uuid
         LEFT JOIN LATERAL (
           SELECT c.id, c.change_type, c.severity FROM monitoring_changes c
            WHERE c.organization_id = $1 AND c.property_id = p.id AND c.event_id = $2::uuid
            ORDER BY c.created_at DESC, c.id DESC LIMIT 1
         ) latest ON true
         LEFT JOIN feed_acknowledgements ack ON ack.organization_id = $1 AND ack.change_id = latest.id
        WHERE p.organization_id = $1 AND (m.event_id IS NOT NULL OR latest.id IS NOT NULL)
        ORDER BY p.name, p.id`,
      [organizationId, eventId],
    ),
  ]);
  const event = events.rows[0];
  return event ? { event, properties: properties.rows } : null;
}

/** TENANT read: the event behind an SMS link key (`eventLinkKey`), only when it reached the organization and the key is unique. */
export async function findOrgEventByLinkKey(db: Queryable, organizationId: string, key: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT e.id::text FROM source_events e WHERE left(replace(e.id::text, '-', ''), 16) = $2 AND ${ORG_HAS_EVENT} LIMIT 2`,
    [organizationId, key],
  );
  return rows.length === 1 ? rows[0]!.id : null;
}

export async function listPropertyEventMap(db: Queryable, organizationId: string, propertyId: string): Promise<EventMapItem[]> {
  const { rows } = await db.query<MapEventRow>(
    `SELECT e.id::text AS event_id, e.source_id, e.event_type, e.headline, e.description, e.area_label, e.valid_from, e.valid_to, e.extra,
            ${MAP_GEOMETRY_SQL}
       FROM property_event_matches m
       JOIN source_events e ON e.id = m.event_id AND e.status = 'active'
       JOIN properties p ON p.id = m.property_id AND p.organization_id = $1
      WHERE m.organization_id = $1 AND m.property_id = $2
        AND e.source_id IN ${MAP_SOURCES_SQL} AND e.geom IS NOT NULL
      ORDER BY m.distance_m NULLS LAST, e.id
      LIMIT $3`,
    [organizationId, propertyId, EVENT_MAP_LIMIT],
  );
  return rows.map(mapItemOf).filter((x): x is EventMapItem => x !== null);
}

/* Shared public radar-grid cache. Reads for snapshots remain organization scoped above. */
export interface NowcastRow {
  point_key: string; radar_coverage: 'ok' | 'temporarily unavailable' | 'no coverage';
  series: { temperature: number | null; points: Array<{ validAt: string; rateMmH: number | null }> };
  source_updated_at: Date | null; fetched_at: Date; expires_at: Date; last_modified: string | null;
}
export type NowcastTarget = Pick<NowcastRow, 'point_key' | 'last_modified'> & { fetched_at: Date | null };

/** Only request points with active pins, and only after their upstream cache expires. */
export async function nowcastPointsDue(db: Queryable, at: Date, limit: number): Promise<NowcastTarget[]> {
  const { rows } = await db.query<NowcastTarget>(
    `WITH active_points AS (
       SELECT DISTINCT ${NOWCAST_POINT_KEY} AS point_key FROM properties p WHERE p.status <> 'paused'
     )
     SELECT p.point_key, n.last_modified, n.fetched_at
       FROM active_points p LEFT JOIN nowcast_points n ON n.point_key = p.point_key
      WHERE p.point_key IS NOT NULL AND (n.expires_at IS NULL OR n.expires_at <= $1)
      ORDER BY n.fetched_at NULLS FIRST, p.point_key LIMIT $2`,
    [at.toISOString(), limit],
  );
  return rows;
}

/** Find the current consumers of the refreshed points rather than the pins from before fetching. */
export async function nowcastPropertiesAtPoints(db: Queryable, keys: string[]): Promise<Array<{ organizationId: string; propertyId: string }>> {
  const { rows } = await db.query<{ organizationId: string; propertyId: string }>(
    `SELECT p.organization_id AS "organizationId", p.id AS "propertyId" FROM properties p
      WHERE (${NOWCAST_POINT_KEY}) = ANY($1::text[]) ORDER BY p.id`, [keys],
  );
  return rows;
}
export async function saveNowcastPoint(db: Queryable, pointKey: string, lat: number, lon: number, data: { coverage: string; updatedAt: string; temperature: number | null; points: unknown[] }, fetchedAt: string, expiresAt: string, lastModified: string | null) {
  await db.query(`INSERT INTO nowcast_points (point_key, location, radar_coverage, series, source_updated_at, fetched_at, expires_at, last_modified)
    VALUES ($1, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, $4, $5::jsonb, $6, $7, $8, $9)
    ON CONFLICT(point_key) DO UPDATE SET radar_coverage=EXCLUDED.radar_coverage, series=EXCLUDED.series,
      source_updated_at=EXCLUDED.source_updated_at, fetched_at=EXCLUDED.fetched_at, expires_at=EXCLUDED.expires_at, last_modified=EXCLUDED.last_modified`,
    [pointKey, lon, lat, data.coverage, JSON.stringify({temperature:data.temperature,points:data.points}), data.updatedAt, fetchedAt, expiresAt, lastModified]);
}
export async function revalidateNowcastPoint(db: Queryable, key: string, fetchedAt: string, expiresAt: string, lastModified: string | null) {
  await db.query('UPDATE nowcast_points SET fetched_at=$2, expires_at=$3, last_modified=$4 WHERE point_key=$1', [key,fetchedAt,expiresAt,lastModified]);
}

export interface HydrologyReferenceRow { source_id:string; station_id:string; month:number; p75:number; p95:number; samples:number; years:number; fetched_at:Date }
export async function stationsNeedingFlowReference(db:Queryable,distance:number,days:number,limit:number):Promise<string[]> {
  const {rows}=await db.query<{station_id:string}>(`SELECT s.station_id FROM observation_stations s LEFT JOIN hydrology_reference_checks c ON c.station_id=s.station_id
    WHERE s.source_id='smhi_hydrology' AND s.parameter='water_flow' AND s.observed_at>now()-interval '3 hours'
      AND (c.checked_at IS NULL OR c.checked_at<now()-make_interval(days=>$2))
      AND EXISTS(SELECT 1 FROM properties p WHERE p.status<>'paused' AND ST_DWithin(p.location,s.location,$1))
    ORDER BY c.checked_at NULLS FIRST,s.station_id LIMIT $3`,[distance,days,limit]);
  return rows.map(r=>r.station_id);
}
export async function saveFlowReferences(db:Queryable,stationId:string,months:Array<{month:number;reference:{p75:number;p95:number;samples:number;years:number}|null}>,success:boolean) {
  // A failed or insufficient archive never clears prior references.
  if(success)for(const m of months)if(m.reference)await db.query(`INSERT INTO hydrology_references(source_id,station_id,month,p75,p95,samples,years) VALUES('smhi_hydrology',$1,$2,$3,$4,$5,$6)
    ON CONFLICT(source_id,station_id,month) DO UPDATE SET p75=EXCLUDED.p75,p95=EXCLUDED.p95,samples=EXCLUDED.samples,years=EXCLUDED.years,fetched_at=now()`,[stationId,m.month,m.reference.p75,m.reference.p95,m.reference.samples,m.reference.years]);
  await db.query('INSERT INTO hydrology_reference_checks(station_id,success) VALUES($1,$2) ON CONFLICT(station_id) DO UPDATE SET checked_at=now(),success=EXCLUDED.success',[stationId,success]);
}

/* ------------------------------------------------------------------ */
/* History backfill (system)                                           */
/* ------------------------------------------------------------------ */

export interface BackfillStation { stationId: string; name: string; lat: number; lon: number; stored: number }

/**
 * Stations whose recent history should be backfilled: for every active property, the SAME station
 * the snapshot shows (nearest station of `parameter` with a value in the last `maxAgeHours`, within
 * `distanceM`), when fewer than `minCoverage` of the expected quarter-hours of the last `hours` are
 * stored and the station was not tried within `retryHours`. Least recently tried first.
 */
export async function stationsNeedingBackfill(
  db: Queryable,
  o: { sourceId: string; parameter: string; distanceM: number; maxAgeHours: number; hours: number; minCoverage: number; retryHours: number; limit: number },
): Promise<BackfillStation[]> {
  const { rows } = await db.query<{ station_id: string; name: string; lat: number; lon: number; stored: number }>(
    `WITH nearest AS (
       SELECT DISTINCT o.station_id, o.name, ST_Y(o.location::geometry) AS lat, ST_X(o.location::geometry) AS lon
         FROM properties p
         CROSS JOIN LATERAL (
           SELECT s.station_id, s.name, s.location FROM observation_stations s
            WHERE s.source_id = $1 AND s.parameter = $2 AND s.value IS NOT NULL
              AND s.observed_at > now() - make_interval(hours => $4)
            ORDER BY s.location <-> p.location
            LIMIT 1) o
        WHERE p.status <> 'paused' AND ST_DWithin(o.location, p.location, $3::double precision)
     )
     SELECT n.station_id, n.name, n.lat, n.lon, x.stored
       FROM nearest n
       CROSS JOIN LATERAL (
         SELECT count(*)::int AS stored FROM observation_history h
          WHERE h.source_id = $1 AND h.station_id = n.station_id AND h.parameter = $2
            AND h.observed_at > now() - make_interval(hours => $5)) x
       LEFT JOIN observation_backfill_checks c ON c.source_id = $1 AND c.station_id = n.station_id AND c.parameter = $2
      WHERE x.stored < $6::double precision * $5 * 4
        AND (c.checked_at IS NULL OR c.checked_at < now() - make_interval(hours => $7))
      ORDER BY c.checked_at NULLS FIRST, n.station_id
      LIMIT $8`,
    [o.sourceId, o.parameter, o.distanceM, o.maxAgeHours, o.hours, o.minCoverage, o.retryHours, o.limit],
  );
  return rows.map((r) => ({ stationId: r.station_id, name: r.name, lat: Number(r.lat), lon: Number(r.lon), stored: r.stored }));
}

/** Records a backfill attempt (success or not) so the station is not retried before the retry window. */
export async function markBackfillChecked(db: Queryable, sourceId: string, stationId: string, parameter: string, success: boolean): Promise<void> {
  await db.query(
    `INSERT INTO observation_backfill_checks (source_id, station_id, parameter, success) VALUES ($1, $2, $3, $4)
     ON CONFLICT (source_id, station_id, parameter) DO UPDATE SET checked_at = now(), success = EXCLUDED.success`,
    [sourceId, stationId, parameter, success],
  );
}

export interface ObservationHistoryRow { source_id:string; station_id:string; parameter:string; observed_at:Date; value:number; quality:string|null }
/** System write: history is retained only around active monitored properties; deduplicates retries. */
export async function insertObservationHistory(db:Queryable,sourceId:string,obs:StationObservationInput[]):Promise<number> {
  const filtered=obs.filter(o=>o.value!=null&&Number.isFinite(o.value)&&o.observedAt&&(sourceId!=='smhi_oceanography'||Date.parse(o.observedAt)%600000===0));
  let count=0;
  for(let i=0;i<filtered.length;i+=500){
    const values=filtered.slice(i,i+500).map(o=>({station_id:o.stationId,parameter:o.parameter,observed_at:o.observedAt,value:o.value,quality:o.quality,lat:o.lat,lon:o.lon}));
    const r=await db.query(`INSERT INTO observation_history(source_id,station_id,parameter,observed_at,value,quality)
      SELECT $1,x.station_id,x.parameter,x.observed_at,x.value,x.quality FROM jsonb_to_recordset($2::jsonb)
        AS x(station_id text,parameter text,observed_at timestamptz,value double precision,quality text,lat double precision,lon double precision)
      WHERE x.observed_at>=now()-make_interval(days=>$4) AND x.observed_at<=now()
        AND EXISTS(SELECT 1 FROM properties p WHERE p.status<>'paused' AND ST_DWithin(p.location,ST_SetSRID(ST_MakePoint(x.lon,x.lat),4326)::geography,$3))
      ON CONFLICT(source_id,station_id,parameter,observed_at) DO NOTHING`,[sourceId,JSON.stringify(values),stationMatchDistance(sourceId),RETENTION.observationHistoryDays]);
    count+=r.rowCount??0;
  }
  return count;
}
