import {
  HISTORY,
  WEATHER_WATER,
  aggregateTemperatureCrossings,
  swedishDateKey,
  type DailyValue,
  type HistoryEvent,
  type HistoryEventVersion,
  type HistoryPeriod,
  type HistoryStation,
  type HistoryHourly,
} from '@fastighetsradar/domain';
import type { Queryable } from './migrations';

export async function saveHistoryCatalog(
  db: Queryable,
  sourceId: string,
  parameter: string,
  stations: Array<{
    stationId: string;
    name: string;
    lat: number;
    lon: number;
    from: string | null;
    to: string | null;
  }>,
): Promise<void> {
  await db.query(
    `INSERT INTO history_stations (source_id,station_id,parameter,name,location,available_from,available_to)
     SELECT $1,x."stationId",$2,x.name,ST_SetSRID(ST_MakePoint(x.lon,x.lat),4326)::geography,x."from",x."to"
     FROM jsonb_to_recordset($3::jsonb) AS x("stationId" text,name text,lat double precision,lon double precision,"from" timestamptz,"to" timestamptz)
     ON CONFLICT (source_id,station_id,parameter) DO UPDATE SET
       name=EXCLUDED.name,location=EXCLUDED.location,available_from=EXCLUDED.available_from,
       available_to=EXCLUDED.available_to,catalog_checked_at=now()`,
    [sourceId, parameter, JSON.stringify(stations)],
  );
}

export async function historyCatalogDue(
  db: Queryable,
  sourceId: string,
  parameter: string,
): Promise<boolean> {
  const { rows } = await db.query<{ due: boolean }>(
    `SELECT NOT EXISTS (SELECT 1 FROM history_stations WHERE source_id=$1 AND parameter=$2
       AND catalog_checked_at > now() - make_interval(hours => $3)) AS due`,
    [sourceId, parameter, HISTORY.catalogRefreshHours],
  );
  return rows[0].due;
}

export interface HistoryBackfillTarget {
  sourceId: string;
  stationId: string;
  parameter: string;
  archiveFetched: boolean;
  normalDue: boolean;
}

/** Public station data is shared. A new property schedules work, never duplicates station series. */
export async function historyBackfillTargets(
  db: Queryable,
  parameters: Array<{ sourceId: string; key: string; distanceM: number }>,
): Promise<HistoryBackfillTarget[]> {
  const { rows } = await db.query<HistoryBackfillTarget>(
    `WITH parameters AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS x("sourceId" text,key text,"distanceM" integer)
     ), nearest AS (
       SELECT DISTINCT s.source_id,s.station_id,s.parameter
       FROM properties p CROSS JOIN parameters def
       CROSS JOIN LATERAL (
         SELECT s.* FROM history_stations s WHERE s.source_id=def."sourceId" AND s.parameter=def.key
           AND ST_DWithin(s.location,p.location,def."distanceM")
           AND s.available_from < now()-make_interval(days => $3)
         ORDER BY ST_Distance(s.location,p.location),s.station_id LIMIT $2
       ) s WHERE p.status <> 'paused'
     )
     SELECT n.source_id AS "sourceId",n.station_id AS "stationId",n.parameter,
       c.archive_fetched_at IS NOT NULL AS "archiveFetched",
       (nc.checked_at IS NULL OR nc.checked_at < now()-make_interval(years => $4)) AS "normalDue"
     FROM nearest n
     LEFT JOIN history_backfill_checks c USING(source_id,station_id,parameter)
     LEFT JOIN history_normal_checks nc USING(station_id)
     WHERE c.checked_at IS NULL OR c.checked_at < now()-make_interval(hours => CASE WHEN c.success THEN $5::integer ELSE $6::integer END)
     ORDER BY c.checked_at NULLS FIRST,n.source_id,n.station_id,n.parameter LIMIT $7`,
    [
      JSON.stringify(parameters),
      HISTORY.candidatesPerProperty,
      HISTORY.minimumHistoryDays,
      HISTORY.normalRefreshYears,
      HISTORY.catalogRefreshHours,
      HISTORY.retryHours,
      HISTORY.stationsPerRun,
    ],
  );
  return rows;
}

export async function saveStationDaily(
  db: Queryable,
  sourceId: string,
  stationId: string,
  parameter: string,
  definition: string,
  days: DailyValue[],
): Promise<number> {
  if (!days.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO station_daily (source_id,station_id,parameter,day_definition,date,value,min,max,coverage,origin)
     SELECT $1,$2,$3,$4,x.date,x.value,x.min,x.max,x.coverage,x.origin
     FROM jsonb_to_recordset($5::jsonb) AS x(date date,value double precision,min double precision,max double precision,coverage double precision,origin text)
     WHERE x.date >= (now()-make_interval(years => $6))::date
     ON CONFLICT (source_id,station_id,parameter,day_definition,date) DO UPDATE SET
       value=EXCLUDED.value,min=EXCLUDED.min,max=EXCLUDED.max,coverage=EXCLUDED.coverage,
       origin=EXCLUDED.origin,updated_at=now()
     WHERE station_daily.coverage < EXCLUDED.coverage
        OR (EXCLUDED.origin='smhi_archive' AND station_daily.origin <> 'smhi_archive')`,
    [sourceId, stationId, parameter, definition, JSON.stringify(days), HISTORY.dailyRetentionYears],
  );
  return rowCount ?? 0;
}

export async function markHistoryBackfill(
  db: Queryable,
  target: HistoryBackfillTarget,
  success: boolean,
  archiveFetched: boolean,
): Promise<void> {
  await db.query(
    `INSERT INTO history_backfill_checks(source_id,station_id,parameter,success,archive_fetched_at)
     VALUES($1,$2,$3,$4,CASE WHEN $5 THEN now() END)
     ON CONFLICT(source_id,station_id,parameter) DO UPDATE SET checked_at=now(),success=$4,
       archive_fetched_at=COALESCE(history_backfill_checks.archive_fetched_at,EXCLUDED.archive_fetched_at)`,
    [target.sourceId, target.stationId, target.parameter, success, archiveFetched],
  );
}

export async function saveHistoryNormals(
  db: Queryable,
  stationId: string,
  normals: Array<{ month: number; value: number; years: number }>,
  success: boolean,
): Promise<void> {
  // A failed source read is retried next run; a valid but insufficient archive is checked annually.
  if (!success) return;
  await db.query(`DELETE FROM station_precipitation_normals WHERE station_id=$1`, [stationId]);
  await db.query(
    `INSERT INTO station_precipitation_normals(station_id,month,value,years,period_from,period_to)
     SELECT $1,x.month,x.value,x.years,$3,$4 FROM jsonb_to_recordset($2::jsonb) AS x(month integer,value double precision,years integer)
     ON CONFLICT(source_id,station_id,month) DO UPDATE SET value=EXCLUDED.value,years=EXCLUDED.years,calculated_at=now()`,
    [stationId, JSON.stringify(normals), HISTORY.normalFromYear, HISTORY.normalToYear],
  );
  await db.query(
    `INSERT INTO history_normal_checks(station_id,success) VALUES($1,true)
    ON CONFLICT(station_id) DO UPDATE SET checked_at=now(),success=true`,
    [stationId],
  );
}

/** One nightly SQL aggregate, before raw retention. Definitions stay separate from native SMHI days. */
export async function aggregateStoredHistory(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `WITH raw AS (
       SELECT h.*,
         ((h.observed_at-interval '1 millisecond') AT TIME ZONE 'Europe/Stockholm')::date AS date,
         CASE WHEN h.parameter='precipitation_15min' THEN 15
              WHEN h.parameter IN ('sea_level','water_flow') THEN 10 ELSE 60 END AS step
       FROM observation_history h
       WHERE h.observed_at > now()-make_interval(years => $1)
         AND h.observed_at <= date_trunc('day',now() AT TIME ZONE 'Europe/Stockholm') AT TIME ZONE 'Europe/Stockholm'
         -- RW long series uses hourly samples. Do not silently replace its extrema with 10-min extrema.
         AND (h.parameter <> 'sea_level' OR extract(minute FROM h.observed_at)=0)
     ), grouped AS (
       SELECT source_id,station_id,parameter,date,
         CASE WHEN parameter='sea_level' THEN 60
              WHEN parameter='water_flow' THEN 15 ELSE max(step) END AS step,
         count(*) AS samples,
         sum(value) AS total,avg(value) AS mean,min(value) AS min,max(value) AS max
       FROM raw GROUP BY source_id,station_id,parameter,date
     ), daily AS (
       SELECT *,extract(epoch FROM (
         ((date+1)::timestamp AT TIME ZONE 'Europe/Stockholm')-(date::timestamp AT TIME ZONE 'Europe/Stockholm')
       ))/(step*60) AS expected FROM grouped
     )
     INSERT INTO station_daily(source_id,station_id,parameter,day_definition,date,value,min,max,coverage,origin)
     SELECT source_id,station_id,parameter,'swedish_calendar',date,
       CASE WHEN samples=expected THEN
         CASE WHEN parameter LIKE 'precipitation_%' THEN total WHEN parameter='wind_gust' THEN max ELSE mean END END,
       CASE WHEN samples=expected THEN min END,CASE WHEN samples=expected THEN max END,
       LEAST(1,samples/expected),'own_aggregate' FROM daily
     ON CONFLICT(source_id,station_id,parameter,day_definition,date) DO UPDATE SET
       value=EXCLUDED.value,min=EXCLUDED.min,max=EXCLUDED.max,coverage=EXCLUDED.coverage,updated_at=now()
     WHERE station_daily.origin='own_aggregate' AND station_daily.coverage < EXCLUDED.coverage`,
    [HISTORY.dailyRetentionYears],
  );
  await refreshHistoryFlowReferences(db);
  return (rowCount ?? 0) + (await aggregateStoredTemperatureCrossings(db));
}

async function refreshHistoryFlowReferences(db: Queryable): Promise<void> {
  await db.query(
    `INSERT INTO history_flow_references(station_id,month,p75,p95,samples,years)
     SELECT station_id,extract(month FROM date)::int,
       percentile_cont($2) WITHIN GROUP(ORDER BY value),percentile_cont($3) WITHIN GROUP(ORDER BY value),
       count(*)::int,count(DISTINCT extract(year FROM date))::int
     FROM station_daily WHERE source_id='smhi_hydrology' AND parameter='water_flow' AND day_definition='smhi_hydro_cest'
       AND coverage=1 AND value IS NOT NULL AND date >= (now()-make_interval(years => $1))::date
     GROUP BY station_id,extract(month FROM date)
     HAVING count(*) >= $4 AND count(DISTINCT extract(year FROM date)) >= $5
     ON CONFLICT(station_id,month) DO UPDATE SET p75=EXCLUDED.p75,p95=EXCLUDED.p95,
       samples=EXCLUDED.samples,years=EXCLUDED.years,calculated_at=now()
     WHERE history_flow_references.calculated_at < now()-make_interval(years => $6)`,
    [
      HISTORY.dailyRetentionYears,
      WEATHER_WATER.flowNormalPercentile,
      WEATHER_WATER.flowHighPercentile,
      WEATHER_WATER.referenceMinDays,
      WEATHER_WATER.referenceMinYears,
      HISTORY.flowReferenceRefreshYears,
    ],
  );
}

async function aggregateStoredTemperatureCrossings(db: Queryable): Promise<number> {
  const { rows } = await db.query<{
    sourceId: string;
    stationId: string;
    points: Array<{ at: string; value: number }>;
  }>(
    `SELECT source_id AS "sourceId",station_id AS "stationId",
       jsonb_agg(jsonb_build_object('at',observed_at,'value',value) ORDER BY observed_at) AS points
     FROM observation_history WHERE parameter='air_temperature'
       AND quality IN ('G','Y')
       AND observed_at >= now()-make_interval(years => $1)
       AND observed_at <= date_trunc('day',now() AT TIME ZONE 'Europe/Stockholm') AT TIME ZONE 'Europe/Stockholm'
       AND extract(minute FROM observed_at)=0 AND extract(second FROM observed_at)=0
     GROUP BY source_id,station_id`,
    [HISTORY.dailyRetentionYears],
  );
  let items = 0;
  const today = swedishDateKey(new Date());
  for (const row of rows) {
    const days = new Map<string, Array<{ at: string; value: number }>>();
    for (const point of row.points) {
      const dates = new Set([swedishDateKey(point.at), swedishDateKey(new Date(Date.parse(point.at) - 1))]);
      for (const date of dates) {
        if (date >= today) continue;
        const points = days.get(date) ?? [];
        points.push(point);
        days.set(date, points);
      }
    }
    items += await saveStationDaily(
      db,
      row.sourceId,
      row.stationId,
      'temperature_crossings',
      'swedish_calendar',
      [...days].map(([date, points]) => aggregateTemperatureCrossings(points, date)),
    );
  }
  return items;
}

export interface HistoryStationCandidate extends HistoryStation {
  historyDays: number;
  normalMonths: number;
}

export async function propertyHistoryStations(
  db: Queryable,
  organizationId: string,
  propertyId: string,
  parameters: Array<{ sourceId: string; key: string; distanceM: number }>,
): Promise<HistoryStationCandidate[]> {
  const { rows } = await db.query<HistoryStationCandidate>(
    `SELECT s.source_id || ':' || s.station_id || ':' || s.parameter AS id,
       s.source_id AS "sourceId",s.station_id AS "stationId",s.parameter,s.name,
       ST_Distance(s.location,p.location) AS "distanceMeters",
       (SELECT count(*)::int FROM station_daily d WHERE d.source_id=s.source_id AND d.station_id=s.station_id
         AND d.parameter=s.parameter AND d.coverage=1 AND d.value IS NOT NULL
         AND d.date >= (now()-make_interval(days => $4))::date) AS "historyDays",
       CASE WHEN s.parameter='precipitation' THEN
         (SELECT count(*)::int FROM station_precipitation_normals n WHERE n.source_id=s.source_id
           AND n.station_id=s.station_id AND n.years >= $5) ELSE 0 END AS "normalMonths"
     FROM properties p
     CROSS JOIN jsonb_to_recordset($3::jsonb) AS def("sourceId" text,key text,"distanceM" integer)
     JOIN history_stations s ON s.source_id=def."sourceId" AND s.parameter=def.key
       AND ST_DWithin(s.location,p.location,def."distanceM")
     WHERE p.id=$2 AND p.organization_id=$1 ORDER BY "distanceMeters",s.station_id`,
    [
      organizationId,
      propertyId,
      JSON.stringify(parameters),
      HISTORY.selectionWindowDays,
      HISTORY.normalMinimumYears,
    ],
  );
  return rows;
}

export async function propertyDailySeries(
  db: Queryable,
  organizationId: string,
  propertyId: string,
  station: HistoryStation,
  definition: string,
  period: HistoryPeriod,
) {
  const { rows } = await db.query<DailyValue & { since: string | null }>(
    `SELECT d.date::text,d.value,d.min,d.max,d.coverage,d.origin,
       (SELECT min(a.date)::text FROM station_daily a WHERE a.source_id=$3 AND a.station_id=$4
         AND a.parameter=$5 AND a.day_definition=$6) AS since
     FROM station_daily d WHERE d.source_id=$3 AND d.station_id=$4 AND d.parameter=$5 AND d.day_definition=$6
       AND d.date BETWEEN $7::date AND $8::date
       AND EXISTS(SELECT 1 FROM properties p WHERE p.id=$2 AND p.organization_id=$1)
     ORDER BY d.date`,
    [
      organizationId,
      propertyId,
      station.sourceId,
      station.stationId,
      station.parameter,
      definition,
      period.from,
      period.to,
    ],
  );
  return rows;
}

export async function propertyHistoryNormals(
  db: Queryable,
  organizationId: string,
  propertyId: string,
  stationId: string,
) {
  const { rows } = await db.query<{ month: number; value: number; years: number }>(
    `SELECT month,value,years FROM station_precipitation_normals
     WHERE station_id=$3 AND years >= $4 AND EXISTS(SELECT 1 FROM properties WHERE id=$2 AND organization_id=$1)`,
    [organizationId, propertyId, stationId, HISTORY.normalMinimumYears],
  );
  return rows;
}

/** Return every version of overlapping events, including earlier versions outside the selected range. */
export async function propertyHistoryEvents(
  db: Queryable,
  organizationId: string,
  propertyId: string,
  period: HistoryPeriod,
): Promise<HistoryEvent[]> {
  const { rows } = await db.query<{ event: HistoryEvent }>(
    `WITH relevant AS (
       SELECT DISTINCT source_id,external_id FROM property_event_history
       WHERE organization_id=$1 AND property_id=$2
         AND COALESCE(valid_from,published_at,changed_at) < (($4::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm')
         AND COALESCE(LEAST(valid_to,ended_at,matched_until),'infinity') >= ($3::date::timestamp AT TIME ZONE 'Europe/Stockholm')
     )
     SELECT jsonb_build_object(
       'id',h.source_id||':'||h.external_id,'sourceId',h.source_id,'externalId',h.external_id,
       'sourceLabel',CASE h.source_id WHEN 'smhi_warnings' THEN 'SMHI' WHEN 'trafikverket' THEN 'Trafikverket' ELSE 'Krisinformation.se' END,
       'category',(array_agg(h.category ORDER BY h.version DESC))[1],
       'official',(array_agg(h.official ORDER BY h.version DESC))[1],
       'attribution',(array_agg(h.attribution ORDER BY h.version DESC))[1],
       'versions',jsonb_agg(jsonb_build_object(
         'version',h.version,'changedAt',h.changed_at,'level',h.level,'title',h.headline,'text',h.description,
         'eventType',h.event_type,'area',h.area_label,'validFrom',h.valid_from,'validTo',h.valid_to,'publishedAt',h.published_at,
         'endedAt',h.ended_at,'matchedUntil',h.matched_until,'matches',h.match_intervals,'endType',h.end_type,'matchMethod',h.match_method,'distanceMeters',h.distance_m,'sourceUrl',h.source_url
       ) ORDER BY h.version)) AS event
     FROM property_event_history h JOIN relevant r USING(source_id,external_id)
     WHERE h.organization_id=$1 AND h.property_id=$2
     GROUP BY h.source_id,h.external_id
     ORDER BY max(h.changed_at) DESC`,
    [organizationId, propertyId, period.from, period.to],
  );
  // PostgreSQL JSON timestamps use +00:00; normalize to the contract's UTC ISO representation.
  return rows.map(({ event }) => ({
    ...event,
    versions: event.versions.map((v) => {
      const dates = ['changedAt', 'validFrom', 'validTo', 'publishedAt', 'endedAt', 'matchedUntil'] as const;
      const version: HistoryEventVersion = { ...v };
      for (const key of dates) {
        if (version[key]) version[key] = new Date(version[key]!).toISOString();
      }
      version.matches = version.matches.map((match) => ({
        from: new Date(match.from).toISOString(),
        to: match.to ? new Date(match.to).toISOString() : null,
      }));
      return version;
    }),
  }));
}

export async function historyArchiveStartedAt(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ started_at: Date }>(`SELECT started_at FROM history_archive_state`);
  return rows[0].started_at.toISOString();
}

/** Recent quarter-hour rain is an independent series, never joined to the 06 UTC daily archive. */
export async function propertyHourlyHistory(
  db: Queryable,
  organizationId: string,
  propertyId: string,
  period: HistoryPeriod,
): Promise<HistoryHourly | null> {
  const from = new Date(period.from + 'T12:00:00Z');
  const to = new Date(period.to + 'T12:00:00Z');
  if (
    (+to - +from) / HISTORY.dayMs >= HISTORY.hourlyDetailMaxDays ||
    +from < Date.now() - HISTORY.rawRetentionDays * HISTORY.dayMs
  )
    return null;
  const { rows: stations } = await db.query<HistoryStation>(
    `SELECT s.source_id||':'||s.station_id||':'||s.parameter AS id,s.source_id AS "sourceId",
       s.station_id AS "stationId",s.name,s.parameter,ST_Distance(s.location,p.location) AS "distanceMeters"
     FROM properties p JOIN observation_stations s ON s.source_id='smhi_observations' AND s.parameter='precipitation_15min'
       AND ST_DWithin(s.location,p.location,$3)
     WHERE p.organization_id=$1 AND p.id=$2 ORDER BY ST_Distance(s.location,p.location),s.station_id LIMIT 1`,
    [organizationId, propertyId, HISTORY.rainDistanceM],
  );
  const station = stations[0];
  if (!station) return null;
  const { rows } = await db.query<{ from: Date; to: Date; value: number | null; coverage: number }>(
    `WITH hours AS (
       SELECT t-interval '1 hour' AS "from",t AS "to" FROM generate_series(
         ($3::date::timestamp AT TIME ZONE 'Europe/Stockholm')+interval '1 hour',
         (($4::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm'),interval '1 hour') t
     )
     SELECT hours."from",hours."to",CASE WHEN count(h.value)=4 THEN round(sum(h.value)::numeric,1)::double precision END AS value,
       count(h.value)::double precision/4 AS coverage
     FROM hours LEFT JOIN observation_history h ON h.source_id=$5 AND h.station_id=$6 AND h.parameter='precipitation_15min'
       AND h.observed_at > hours."from" AND h.observed_at <= hours."to"
       AND extract(minute FROM h.observed_at)::int % 15=0 AND extract(second FROM h.observed_at)=0
       AND h.quality IN ('G','Y')
     WHERE EXISTS(SELECT 1 FROM properties WHERE organization_id=$1 AND id=$2)
     GROUP BY hours."from",hours."to" ORDER BY hours."to"`,
    [organizationId, propertyId, period.from, period.to, station.sourceId, station.stationId],
  );
  if (!rows.length) return null;
  return {
    station,
    from: rows[0].from.toISOString(),
    to: rows.at(-1)!.to.toISOString(),
    stepMinutes: 60,
    values: rows.map((r) => r.value),
    coverage: rows.map((r) => r.coverage),
  };
}

export async function propertyFlowReferences(
  db: Queryable,
  organizationId: string,
  propertyId: string,
  stationId: string,
) {
  const { rows } = await db.query<{
    month: number;
    p75: number;
    p95: number;
    years: number;
    samples: number;
  }>(
    `SELECT month,p75,p95,years,samples FROM history_flow_references WHERE station_id=$3
     AND EXISTS(SELECT 1 FROM properties WHERE id=$2 AND organization_id=$1)`,
    [organizationId, propertyId, stationId],
  );
  return rows;
}

export async function saveHistoryFlowReferences(
  db: Queryable,
  stationId: string,
  references: Array<{ month: number; p75: number; p95: number; years: number; samples: number }>,
): Promise<void> {
  if (!references.length) return;
  await db.query(
    `INSERT INTO history_flow_references(station_id,month,p75,p95,years,samples)
     SELECT $1,x.month,x.p75,x.p95,x.years,x.samples
     FROM jsonb_to_recordset($2::jsonb) AS x(month integer,p75 double precision,p95 double precision,years integer,samples integer)
     ON CONFLICT(station_id,month) DO UPDATE SET p75=EXCLUDED.p75,p95=EXCLUDED.p95,
       years=EXCLUDED.years,samples=EXCLUDED.samples,calculated_at=now()`,
    [stationId, JSON.stringify(references)],
  );
}
