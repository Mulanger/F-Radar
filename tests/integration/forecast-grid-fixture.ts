import { performance } from 'node:perf_hooks';
import type pg from 'pg';
import { loadServerEnv } from '../../packages/config/src';
import { ensureOrganization } from '../../packages/db/src';
import { buildJobs, type JobContext } from '../../apps/api/src/monitoring/jobs';

// A deterministic ~2.5 km lattice around Stockholm. Vary the positions within each cell so the
// predecessor's 3-decimal cache does not accidentally deduplicate these distinct properties.
const grid = Array.from({ length: 49 }, (_, i) => ({ lat: 59.26 + Math.floor(i / 7) * 0.0225, lon: 17.94 + (i % 7) * 0.044 }));
const env = loadServerEnv({ NODE_ENV: 'test' });
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

export const forecastFixtureAt = (i: number) => grid[i]!;

export function stubForecasts(db: JobContext['db'], now: Date) {
  let pointRequests = 0;
  let gridRequests = 0;
  const pointQueries: Array<{ lat: number; lon: number }> = [];
  const fixture = (point: { lat: number; lon: number }) => ({
    createdTime: now.toISOString(), referenceTime: now.toISOString(), geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
    timeSeries: Array.from({ length: 10 }, (_, i) => ({
      time: new Date(+now + (i + 1) * 3_600_000).toISOString(), intervalParametersStartTime: new Date(+now + i * 3_600_000).toISOString(),
      data: { air_temperature: i < 4 ? -2 : 2, wind_speed: 5, wind_speed_of_gust: 23, relative_humidity: 85, precipitation_amount_mean: 2 },
    })),
  });
  const request: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/multipoint.json')) {
      gridRequests++;
      return Response.json({ type: 'MultiPoint', coordinates: grid.map(({ lon, lat }) => [lon, lat]) });
    }
    const m = /\/point\/lon\/([-\d.]+)\/lat\/([-\d.]+)\/data\.json$/.exec(url);
    if (!m) throw new Error('Unexpected forecast request');
    const lon = Number(m[1]), lat = Number(m[2]);
    const col = Math.round((lon - grid[0]!.lon) / 0.044), row = Math.round((lat - grid[0]!.lat) / 0.0225);
    if (col < 0 || col > 6 || row < 0 || row > 6) return new Response(null, { status: 400 });
    pointQueries.push({ lat, lon });
    pointRequests++;
    return Response.json(fixture(grid[row * 7 + col]!));
  };
  const run = buildJobs(env).find((job) => job.jobId === 'smhi_forecast')!.run;
  return { run: () => run({ db, adapter: { env, now: () => now, fetch: request, logger: quiet } }), fixture, pointQueries,
    counts: () => ({ pointRequests, gridRequests }) };
}

/** Run the scheduled job to completion on PostgreSQL, with no upstream timing or scheduler delay. */
export async function measureForecastCycle(pool: pg.Pool, properties: number) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("UPDATE properties SET status='paused' WHERE status<>'paused'");
    const org = await ensureOrganization(db, 'org_forecastscale');
    const positions = Array.from({ length: properties }, (_, i) => {
      const point = grid[i % grid.length]!, offset = Math.floor(i / grid.length);
      return { lat: point.lat + (Math.floor(offset / 5) - 2) * 0.003 + 0.00008, lon: point.lon + (offset % 5 - 2) * 0.003 + 0.00012 };
    });
    await db.query(`INSERT INTO properties (organization_id, name, address, geocode_provider, geocode_precision, location)
      SELECT $1, 'Prognosprov', 'Prognosprov', 'manual_pin', 'unknown', ST_SetSRID(ST_MakePoint(p.lon,p.lat),4326)::geography
        FROM jsonb_to_recordset($2::jsonb) AS p(lat double precision, lon double precision)`, [org, JSON.stringify(positions)]);
    const stub = stubForecasts(db, new Date());
    const touched = new Set<string>();
    const start = performance.now();
    let runs = 0;
    let moreWork: boolean;
    do {
      const r = await stub.run();
      if (r.status !== 'ok') throw new Error(`Forecast measurement: ${r.status} ${r.errorCode ?? ''}`);
      for (const p of r.changed?.properties ?? []) touched.add(p.propertyId);
      moreWork = !!r.moreWork;
      if (++runs > Math.ceil(properties / 40) + 2) throw new Error('Forecast cycle did not complete');
    } while (moreWork);
    return { properties, ...stub.counts(), runs, durationMs: Math.round(performance.now() - start), touched: touched.size };
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
}
