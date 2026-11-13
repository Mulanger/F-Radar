import { createHash } from 'node:crypto';
import type { Queryable } from './migrations';

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

export async function listMonitoringTargets(db: Queryable): Promise<MonitoringTarget[]> {
  const { rows } = await db.query<{ id: string; organization_id: string; lat: number; lon: number; municipality: string | null; updated_at: Date }>(
    `SELECT id, organization_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon, municipality, updated_at
       FROM properties WHERE status <> 'paused' ORDER BY created_at, id`,
  );
  return rows.map((r) => ({ propertyId: r.id, organizationId: r.organization_id, lat: r.lat, lon: r.lon, municipality: r.municipality, updatedAt: r.updated_at }));
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
      headline: e.headline.slice(0, 500),
      description: e.description?.slice(0, 8000) ?? null,
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

/** Traffic events are matched within 2 km (central-city 5 km produced ~50 mostly irrelevant events). */
export const TRAFFIC_MATCH_RADIUS_M = 2_000;

export interface MatchChange {
  organizationId: string;
  propertyId: string;
  sourceId: string;
  changeType: 'new' | 'updated' | 'ended' | 'cancelled';
}

/**
 * Recomputes property ↔ event matches for all active events in ONE statement (consistent snapshot):
 *  - smhi_warnings:   ST_Intersects(warning polygon, property point)
 *  - trafikverket:    ST_DWithin(deviation geometry, point, 5 km) + exact distance
 *  - krisinformation: property county (ST_Covers on county polygons) ∈ published counties,
 *                     '*' (national), or municipality name match
 * and writes one monitoring_changes row per new/updated/ended match (dedup_key is unique, so
 * re-running never duplicates). Returns the changes written.
 */
export async function rematchEvents(db: Queryable): Promise<MatchChange[]> {
  const { rows } = await db.query<{ organization_id: string; property_id: string; source_id: string; change_type: MatchChange['changeType'] }>(
    `WITH props AS (
       SELECT p.id, p.organization_id, p.location, lower(regexp_replace(coalesce(p.municipality, ''), '\\s+(kommun|stad)$', '')) AS muni,
              (SELECT a.name FROM admin_areas a WHERE a.kind = 'county' AND ST_Covers(a.geom, p.location::geometry) LIMIT 1) AS county
         FROM properties p WHERE p.status <> 'paused'
     ), cand AS (
       SELECT pr.id AS property_id, pr.organization_id, e.id AS event_id, e.version,
              CASE WHEN e.source_id = 'smhi_warnings' THEN 'polygon_intersection'
                   WHEN e.source_id = 'trafikverket' THEN 'within_radius'
                   -- Krisinformation: 'municipality' = the message covers the property's municipality (it names it,
                   -- or names no municipality and so covers the whole county/country); 'county' = same county but
                   -- only OTHER municipalities are named. A VMA there is not shown as a crisis (ADR 0003).
                   WHEN jsonb_array_length(COALESCE(e.extra->'municipalities', '[]'::jsonb)) = 0 THEN 'municipality'
                   WHEN pr.muni <> '' AND EXISTS (
                        SELECT 1 FROM jsonb_array_elements_text(e.extra->'municipalities') m
                         WHERE lower(regexp_replace(m, '\\s+(kommun|stad)$', '')) = pr.muni) THEN 'municipality'
                   ELSE 'county' END AS match_method,
              CASE WHEN e.source_id = 'trafikverket' THEN round(ST_Distance(e.geom::geography, pr.location)::numeric, 0)
                   WHEN e.source_id = 'smhi_warnings' THEN 0 END AS distance_m
         FROM props pr
         JOIN source_events e ON e.status = 'active' AND (
              (e.source_id = 'smhi_warnings' AND e.geom IS NOT NULL AND ST_Intersects(e.geom, pr.location::geometry))
           OR (e.source_id = 'trafikverket' AND e.geom IS NOT NULL AND ST_DWithin(e.geom::geography, pr.location, ${TRAFFIC_MATCH_RADIUS_M}))
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
       RETURNING m.property_id, m.event_id, m.organization_id, m.matched_version
     ), end_changes AS (
       INSERT INTO monitoring_changes (organization_id, property_id, event_id, source_id, change_type, data_class, severity, headline, dedup_key)
       SELECT g.organization_id, g.property_id, g.event_id, e.source_id,
              CASE WHEN e.status = 'cancelled' THEN 'cancelled' ELSE 'ended' END, e.data_class, e.severity, e.headline,
              g.property_id || ':' || g.event_id || ':v' || g.matched_version || ':end'
         FROM gone g JOIN source_events e ON e.id = g.event_id
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
         observed_at = EXCLUDED.observed_at, quality = EXCLUDED.quality, extra = EXCLUDED.extra, fetched_at = now()`,
      [
        sourceId,
        JSON.stringify(
          chunk.map((o) => ({ station_id: o.stationId, parameter: o.parameter, name: o.name, lat: o.lat, lon: o.lon, value: o.value, unit: o.unit, observed_at: o.observedAt, quality: o.quality, extra: o.extra })),
        ),
      ],
    );
    n += rowCount ?? 0;
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
  dataClass: 'FORECAST' | 'OBSERVATION' | 'STATIC_GEODATA' | 'REGIONAL_STATISTIC';
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

/** Same as above for forecasts. */
export async function propertiesNeedingForecast(db: Queryable, maxAgeSeconds: number, limit: number): Promise<MonitoringTarget[]> {
  const { rows } = await db.query<{ id: string; organization_id: string; lat: number; lon: number; municipality: string | null; updated_at: Date }>(
    `SELECT p.id, p.organization_id, ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lon, p.municipality, p.updated_at
       FROM properties p LEFT JOIN property_forecasts f ON f.property_id = p.id
      WHERE p.status <> 'paused'
        AND (f.property_id IS NULL OR f.fetched_at < now() - make_interval(secs => $1) OR f.fetched_at < p.updated_at)
      ORDER BY f.fetched_at NULLS FIRST, p.created_at
      LIMIT $2`,
    [maxAgeSeconds, limit],
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
} as const;

export async function applyRetention(db: Queryable): Promise<Record<string, number>> {
  const del = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rowCount ?? 0;
  return {
    events: await del(`DELETE FROM source_events WHERE status <> 'active' AND ended_at < now() - make_interval(days => $1)`, [RETENTION.endedEventsDays]),
    changes: await del(`DELETE FROM monitoring_changes WHERE created_at < now() - make_interval(days => $1)`, [RETENTION.changesDays]),
    runs: await del(`DELETE FROM integration_runs WHERE started_at < now() - make_interval(days => $1)`, [RETENTION.runsDays]),
    nowcast: await del(`DELETE FROM nowcast_points WHERE fetched_at < now() - make_interval(days => $1)`, [RETENTION.nowcastDays]),
    stations: await del(`DELETE FROM observation_stations WHERE fetched_at < now() - make_interval(days => $1)`, [RETENTION.stationSilentDays]),
  };
}

/* ------------------------------------------------------------------ */
/* TENANT reads (organization-scoped)                                  */
/* ------------------------------------------------------------------ */

export interface OrgForecastRow {
  property_id: string;
  source_id: string;
  reference_time: Date | null;
  created_time: Date | null;
  grid_lat: number | null;
  grid_lon: number | null;
  distance_m: string | null;
  series: unknown;
  fetched_at: Date;
}

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
  nowcasts?: Array<NowcastRow & { property_id: string }>;
  forecasts: OrgForecastRow[];
  events: OrgEventRow[];
  contexts: OrgContextRow[];
  observations: OrgObservationRow[];
  counties: Array<{ property_id: string; code: string; name: string }>;
}

/** Parameters looked up per property: [source, parameter, max age (h)]. */
export const NEAREST_PARAMETERS: Array<[string, string, number]> = [
  ['smhi_oceanography', 'sea_level', 3],
  ['smhi_observations', 'air_temperature', 3],
  ['smhi_observations', 'wind_speed', 3],
  ['smhi_observations', 'wind_gust', 3],
  ['smhi_observations', 'wind_direction', 3],
  ['smhi_observations', 'relative_humidity', 3],
  ['smhi_observations', 'precipitation_1h', 3],
  ['air_quality', 'pm25', 6],
  ['air_quality', 'pm10', 6],
  ['air_quality', 'no2', 6],
  ['air_quality', 'o3', 6],
];

/**
 * Loads every monitoring record for an organization (optionally one property) with 5 queries.
 * No external API is called on this path.
 */
export async function loadOrgMonitoring(db: Queryable, organizationId: string, propertyId?: string): Promise<OrgMonitoringData> {
  const pid = propertyId ?? null;
  const [forecasts, events, contexts, observations, counties, nowcasts] = await Promise.all([
    db.query<OrgForecastRow>(
      `SELECT f.property_id, f.source_id, f.reference_time, f.created_time, ST_Y(f.grid_point::geometry) AS grid_lat, ST_X(f.grid_point::geometry) AS grid_lon,
              f.distance_m, f.series, f.fetched_at
         FROM property_forecasts f WHERE f.organization_id = $1 AND ($2::uuid IS NULL OR f.property_id = $2)`,
      [organizationId, pid],
    ),
    db.query<OrgEventRow>(
      `SELECT m.property_id, m.match_method, m.distance_m, m.first_matched_at,
              e.id, e.source_id, e.external_id, e.data_class, e.category, e.level, e.severity, e.event_type, e.headline, e.description,
              e.area_label, e.published_at, e.source_updated_at, e.valid_from, e.valid_to, e.version, e.source_url, e.attribution, e.extra, e.last_seen_at,
              CASE WHEN e.source_id = 'trafikverket' AND e.geom IS NOT NULL THEN ST_Y(ST_ClosestPoint(e.geom, p.location::geometry)) END AS point_lat,
              CASE WHEN e.source_id = 'trafikverket' AND e.geom IS NOT NULL THEN ST_X(ST_ClosestPoint(e.geom, p.location::geometry)) END AS point_lon
         FROM property_event_matches m
         JOIN source_events e ON e.id = m.event_id AND e.status = 'active'
         JOIN properties p ON p.id = m.property_id AND p.organization_id = $1
        WHERE m.organization_id = $1 AND ($2::uuid IS NULL OR m.property_id = $2)
        ORDER BY e.severity DESC, m.distance_m NULLS LAST, e.published_at DESC NULLS LAST`,
      [organizationId, pid],
    ),
    db.query<OrgContextRow>(
      `SELECT property_id, source_id, context_key, data_class, status, payload, source_timestamp, fetched_at
         FROM property_context WHERE organization_id = $1 AND ($2::uuid IS NULL OR property_id = $2)`,
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
        WHERE p.organization_id = $1 AND ($2::uuid IS NULL OR p.id = $2)`,
      [organizationId, pid, JSON.stringify(NEAREST_PARAMETERS.map(([source_id, parameter, max_age_h]) => ({ source_id, parameter, max_age_h })))],
    ),
    db.query<{ property_id: string; code: string; name: string }>(
      `SELECT p.id AS property_id, a.code, a.name
         FROM properties p JOIN admin_areas a ON a.kind = 'county' AND ST_Covers(a.geom, p.location::geometry)
        WHERE p.organization_id = $1 AND ($2::uuid IS NULL OR p.id = $2)`,
      [organizationId, pid],
    ),
    db.query<NowcastRow & { property_id: string }>(
      `SELECT p.id AS property_id, n.* FROM properties p JOIN nowcast_points n ON n.point_key =
        round(ST_Y(p.location::geometry)::numeric,2)::text || ',' || round(ST_X(p.location::geometry)::numeric,2)::text
        WHERE p.organization_id = $1 AND ($2::uuid IS NULL OR p.id = $2)`, [organizationId, pid]),
  ]);
  return { nowcasts: nowcasts.rows, forecasts: forecasts.rows, events: events.rows, contexts: contexts.rows, observations: observations.rows, counties: counties.rows };
}

export async function listRecentChangesForOrg(db: Queryable, organizationId: string, limit = 50) {
  const { rows } = await db.query<{ id: string; property_id: string; source_id: string; change_type: string; data_class: string; severity: string; headline: string; created_at: Date }>(
    `SELECT id::text, property_id, source_id, change_type, data_class, severity, headline, created_at
       FROM monitoring_changes WHERE organization_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [organizationId, limit],
  );
  return rows;
}

/* Shared public radar-grid cache. Reads for snapshots remain organization scoped above. */
export interface NowcastRow {
  point_key: string; radar_coverage: 'ok' | 'temporarily unavailable' | 'no coverage';
  series: { temperature: number | null; points: Array<{ validAt: string; rateMmH: number | null }> };
  source_updated_at: Date | null; fetched_at: Date; expires_at: Date; last_modified: string | null;
}
export async function loadNowcastCache(db: Queryable): Promise<NowcastRow[]> {
  return (await db.query<NowcastRow>('SELECT point_key, radar_coverage, series, source_updated_at, fetched_at, expires_at, last_modified FROM nowcast_points')).rows;
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
