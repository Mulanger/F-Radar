import type { Queryable } from './migrations';

interface ForecastPoint {
  lat: number;
  lon: number;
}

export interface ForecastProperty extends ForecastPoint {
  property_id: string;
  organization_id: string;
}

export interface ForecastGridTarget extends ForecastPoint {
  id: string;
}

export interface ForecastChange {
  propertyId: string;
  organizationId: string;
}

/** Resolve only new or moved pins. A link with no point records a pin outside coverage. */
export async function propertiesNeedingForecastLink(db: Queryable, limit: number): Promise<ForecastProperty[]> {
  const { rows } = await db.query<ForecastProperty>(
    `SELECT p.id AS property_id, p.organization_id, ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lon
       FROM properties p LEFT JOIN property_forecast_links l ON l.property_id = p.id AND l.organization_id = p.organization_id
      WHERE p.status <> 'paused' AND (l.property_id IS NULL OR NOT ST_Equals(l.for_location::geometry, p.location::geometry))
      ORDER BY p.created_at, p.id LIMIT $1`, [limit],
  );
  return rows;
}

/** Attach pins and reserve each shared point atomically, including already-populated points. */
export async function linkForecastProperties(db: Queryable, links: { property: ForecastProperty; grid: ForecastPoint | null }[]): Promise<ForecastChange[]> {
  if (!links.length) return [];
  const input = links.map(({ property, grid }) => ({ ...property, grid_lat: grid?.lat ?? null, grid_lon: grid?.lon ?? null }));
  const { rows } = await db.query<ForecastChange>(
    `WITH current_pins AS MATERIALIZED (
       SELECT p.id, p.organization_id, p.location, x.grid_lat, x.grid_lon
         FROM jsonb_to_recordset($1::jsonb) AS x(property_id uuid, organization_id uuid, lat float8, lon float8, grid_lat float8, grid_lon float8)
         JOIN properties p ON p.id = x.property_id AND p.organization_id = x.organization_id
        WHERE p.status <> 'paused' AND ST_Equals(p.location::geometry, ST_SetSRID(ST_MakePoint(x.lon, x.lat), 4326))
        FOR SHARE OF p
     ), points AS (
       INSERT INTO forecast_grid_points (lat, lon)
       SELECT DISTINCT grid_lat, grid_lon FROM current_pins WHERE grid_lat IS NOT NULL ORDER BY grid_lat, grid_lon
       ON CONFLICT (lat, lon) DO UPDATE SET lat = EXCLUDED.lat
       RETURNING id, lat, lon, fetched_at
     ), attached AS (
       INSERT INTO property_forecast_links (property_id, organization_id, point_id, for_location, distance_m)
       SELECT p.id, p.organization_id, g.id, p.location,
              round(ST_Distance(p.location, ST_SetSRID(ST_MakePoint(g.lon, g.lat), 4326)::geography)::numeric, 0)
         FROM current_pins p LEFT JOIN points g ON g.lat = p.grid_lat AND g.lon = p.grid_lon
       ON CONFLICT (property_id) DO UPDATE SET point_id = EXCLUDED.point_id, for_location = EXCLUDED.for_location, distance_m = EXCLUDED.distance_m
       RETURNING property_id, organization_id, point_id
     )
     SELECT l.property_id AS "propertyId", l.organization_id AS "organizationId"
       FROM attached l JOIN points g ON g.id = l.point_id WHERE g.fetched_at IS NOT NULL`,
    [JSON.stringify(input)],
  );
  return rows;
}

export async function forecastPointsDue(db: Queryable, maxAgeSeconds: number, limit: number): Promise<ForecastGridTarget[]> {
  const { rows } = await db.query<ForecastGridTarget>(
    `SELECT g.id, g.lat, g.lon
       FROM forecast_grid_points g
      WHERE (g.fetched_at IS NULL OR g.fetched_at < now() - make_interval(secs => $1))
        AND EXISTS (SELECT 1 FROM property_forecast_links l JOIN properties p ON p.id = l.property_id AND p.organization_id = l.organization_id
                     WHERE l.point_id = g.id AND p.status <> 'paused' AND ST_Equals(l.for_location::geometry, p.location::geometry))
      ORDER BY g.fetched_at NULLS FIRST, g.id LIMIT $2`,
    [maxAgeSeconds, limit],
  );
  return rows;
}

export async function saveForecastGridPoint(db: Queryable, id: string, forecast: { referenceTime: string; createdTime: string; series: unknown }): Promise<ForecastChange[]> {
  const { rows } = await db.query<ForecastChange>(
    `WITH refreshed AS (
       UPDATE forecast_grid_points SET reference_time = $2, created_time = $3, series = $4::jsonb, fetched_at = now()
        WHERE id = $1 RETURNING id
     )
     SELECT l.property_id AS "propertyId", l.organization_id AS "organizationId"
       FROM refreshed g JOIN property_forecast_links l ON l.point_id = g.id
       JOIN properties p ON p.id = l.property_id AND p.organization_id = l.organization_id
      WHERE ST_Equals(l.for_location::geometry, p.location::geometry)
      ORDER BY l.organization_id, l.property_id`,
    [id, forecast.referenceTime, forecast.createdTime, JSON.stringify(forecast.series)],
  );
  return rows;
}

export async function pruneForecastGridPoints(db: Queryable): Promise<number> {
  // Skip points being attached or refreshed. The foreign key also protects concurrent links.
  const result = await db.query(`DELETE FROM forecast_grid_points WHERE id IN (
    SELECT g.id FROM forecast_grid_points g
     WHERE NOT EXISTS (SELECT 1 FROM property_forecast_links l WHERE l.point_id = g.id)
     FOR UPDATE OF g SKIP LOCKED)`);
  return result.rowCount ?? 0;
}

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

type SharedForecastRow = Omit<OrgForecastRow, 'property_id' | 'distance_m'> & { properties: [string, string | null][] };

/** The same property-shaped rows for the dashboard and SMS. Load each series once per query. */
export async function loadPropertyForecasts(db: Queryable, org: string, propertyIds: string[] | null, window?: { from: string; to: string }): Promise<OrgForecastRow[]> {
  const narrow = `CASE WHEN $3::text IS NULL OR jsonb_typeof(f.series->'steps') IS DISTINCT FROM 'array' THEN f.series
    ELSE jsonb_set(f.series, '{steps}', jsonb_path_query_array(f.series->'steps', '$[*] ? (@.time >= $from && @.time <= $to)', jsonb_build_object('from', $3::text, 'to', $4::text))) END`;
  const { rows } = await db.query<SharedForecastRow>(
    `WITH ready_links AS MATERIALIZED (
       SELECT l.property_id, l.point_id, l.distance_m
         FROM property_forecast_links l JOIN forecast_grid_points g ON g.id = l.point_id AND g.fetched_at IS NOT NULL
        WHERE l.organization_id = $1 AND ($2::uuid[] IS NULL OR l.property_id = ANY($2::uuid[]))
     ), by_point AS (
       SELECT point_id, json_agg(json_build_array(property_id, distance_m::text)) AS properties
         FROM ready_links GROUP BY point_id
     )
     SELECT p.properties, 'smhi_forecast' AS source_id, f.reference_time, f.created_time,
            f.lat AS grid_lat, f.lon AS grid_lon, f.fetched_at, ${narrow} AS series
       FROM by_point p JOIN forecast_grid_points f ON f.id = p.point_id
     UNION ALL
     SELECT json_build_array(json_build_array(f.property_id, f.distance_m::text)), f.source_id, f.reference_time, f.created_time,
            ST_Y(f.grid_point::geometry), ST_X(f.grid_point::geometry), f.fetched_at, ${narrow}
       FROM property_forecasts f
      WHERE f.organization_id = $1 AND ($2::uuid[] IS NULL OR f.property_id = ANY($2::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM ready_links l WHERE l.property_id = f.property_id)`,
    [org, propertyIds, window?.from ?? null, window?.to ?? null],
  );
  return rows.flatMap(({ properties, ...f }) => properties.map(([property_id, distance_m]) => ({ ...f, property_id, distance_m })));
}
