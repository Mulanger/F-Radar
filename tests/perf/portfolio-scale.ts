/**
 * Scale measurement of GET /v1/portfolio against a REAL PostgreSQL/PostGIS test database
 * (docs/plans/skalning.md, Fas 0). Bundled by tsup.perf.config.ts and run INSIDE the f-radar pod by
 * scripts/run-portfolio-scale.mjs against `fastighetsradar_test` – never the application database.
 *
 *   node portfolio-scale.mjs seed 200 500 1000     # synthetic organizations (idempotent)
 *   node portfolio-scale.mjs matrix 200 500 1000   # measure in child processes (heap limits, concurrency)
 *   node --expose-gc --max-old-space-size=512 portfolio-scale.mjs measure 500 3
 *   node portfolio-scale.mjs cleanup
 *
 * Everything it writes is tagged: organizations `org_perfscale<n>`, events `perf:…`, stations
 * `perf-…`. Volumes per property follow the production measurements in the plan (avsnitt 2.3):
 * ~40 KB forecast series, ~4 traffic matches, 2.3 traffic changes per day for 30 days, a county
 * warning that reaches 60 % of the properties and a Krisinformation message that reaches all.
 * Property context (SGU/MCF/SCB) is not seeded – it was 18 KB for 11 properties in production.
 */
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadServerEnv } from '../../packages/config/src';
import {
  NEAREST_PARAMETERS,
  createProperty,
  ensureOrganization,
  migrateUp,
  upsertPropertyForecast,
  upsertSourceEvents,
  upsertStationObservations,
  type SourceEventInput,
  type StationObservationInput,
} from '../../packages/db/src';
import { buildApp } from '../../apps/api/src/app';
import type { AuthVerifier } from '../../apps/api/src/auth';
import { MonitoringBus } from '../../apps/api/src/monitoring/bus';
import { MonitoringService } from '../../apps/api/src/monitoring/service';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required');
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!/_test$/.test(dbName)) throw new Error(`Refusing to write to "${dbName}" (must end with _test)`);

const pool = new pg.Pool({ connectionString: url, max: 6 });
const quiet = () => {};
/** Clerk-style id (`org_` + 8–64 alphanumerics, enforced by the database). */
const orgClerkId = (n: number) => `org_perfscale${n}`;
const token = (n: number) => `perf-${n}`;

/** Weighted Swedish city centres (public geography, rounded) – a landlord with properties across the country. */
const CITIES: Array<[string, number, number, number]> = [
  ['Stockholm', 59.329, 18.069, 30], ['Göteborg', 57.709, 11.975, 14], ['Malmö', 55.605, 13.003, 9], ['Uppsala', 59.858, 17.639, 6],
  ['Västerås', 59.61, 16.545, 4], ['Örebro', 59.275, 15.213, 4], ['Linköping', 58.41, 15.621, 4], ['Helsingborg', 56.046, 12.694, 3],
  ['Jönköping', 57.782, 14.161, 3], ['Norrköping', 58.588, 16.192, 3], ['Lund', 55.705, 13.191, 2], ['Umeå', 63.826, 20.263, 3],
  ['Gävle', 60.675, 17.141, 2], ['Borås', 57.721, 12.94, 2], ['Sundsvall', 62.391, 17.307, 2], ['Luleå', 65.584, 22.155, 2],
  ['Karlstad', 59.379, 13.504, 2], ['Växjö', 56.879, 14.806, 2], ['Halmstad', 56.674, 12.858, 2], ['Östersund', 63.179, 14.636, 1],
];

/** Deterministic pseudo-random in [0, 1). */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function city(i: number) {
  const total = CITIES.reduce((a, c) => a + c[3], 0);
  let r = rand(i) * total;
  for (const c of CITIES) {
    r -= c[3];
    if (r < 0) return c;
  }
  return CITIES[0]!;
}

function forecastSeries(now: Date) {
  const start = Math.floor(now.getTime() / 3_600_000) * 3_600_000 - 3_600_000;
  return {
    v: 2,
    steps: Array.from({ length: 110 }, (_, i) => ({
      time: new Date(start + i * 3_600_000).toISOString(), intervalStart: new Date(start + (i - 1) * 3_600_000).toISOString(),
      airTemperature: 2 + Math.sin(i / 4) * 4, windSpeed: 5.4, windGust: 9.8, windDirection: 225, relativeHumidity: 86,
      precipitationMean: 0.2, precipitationMin: 0, precipitationMax: 0.6, precipitationMedian: 0.1, precipitationProbability: 40,
      thunderProbability: 1, frozenPartPercent: 10, frozenProbability: 5, precipitationType: 'rain', symbol: 6,
    })),
  };
}

const WARNING_TEXT = 'Perf: Under eftermiddagen och kvällen väntas mycket hårda vindbyar, 25–30 m/s. Det kan medföra risk för skador på tak och fasader, nedfallande träd och störningar i el- och teleförsörjningen. Begränsad framkomlighet på vägar och broar samt inställd kollektivtrafik kan förekomma. Följ råden från SMHI och lokala myndigheter. Säkra lösa föremål kring fastigheten och undvik att vistas under träd. Varningen gäller hela länet och kan komma att uppdateras när prognosen ändras.';

function event(externalId: string, o: Partial<SourceEventInput> & Pick<SourceEventInput, 'dataClass' | 'category' | 'severity' | 'eventType' | 'headline'>, now: Date): SourceEventInput {
  return {
    externalId, level: null, description: null, areaLabel: null, countyNames: [], geometry: null,
    publishedAt: new Date(now.getTime() - 2 * 3_600_000).toISOString(), sourceUpdatedAt: new Date(now.getTime() - 3_600_000).toISOString(),
    validFrom: new Date(now.getTime() - 2 * 3_600_000).toISOString(), validTo: new Date(now.getTime() + 2 * 86_400_000).toISOString(),
    status: 'active', sourceUrl: null, attribution: 'Perf-testdata', extra: {}, ...o,
  };
}

/** Shared synthetic stations and 73 h of history across Sweden (tagged `perf-`). */
async function seedStations(now: Date) {
  const grid: Array<{ lat: number; lon: number }> = [];
  for (let a = 0; a < 14; a++) for (let b = 0; b < 14; b++) grid.push({ lat: 55.4 + (a * 13) / 13.5, lon: 11.5 + (b * 12) / 13.5 });
  const observedAt = new Date(now.getTime() - 15 * 60_000).toISOString();
  for (const [sourceId, parameter] of NEAREST_PARAMETERS) {
    const points = sourceId === 'air_quality' ? CITIES.map(([, lat, lon]) => ({ lat, lon }))
      : sourceId === 'smhi_oceanography' ? grid.filter((_, i) => i % 6 === 0)
        : sourceId === 'smhi_hydrology' ? grid.filter((_, i) => i % 3 === 0) : grid;
    const obs: StationObservationInput[] = points.map((p, i) => ({
      stationId: `perf-${sourceId}-${i}`, parameter, name: `Perf station ${i}`, lat: p.lat, lon: p.lon, value: 1 + rand(i) * 10,
      unit: null, observedAt, quality: 'G', extra: sourceId === 'smhi_oceanography' ? { referenceSystem: 'RW' } : {},
    }));
    await upsertStationObservations(pool, sourceId, obs);
  }
  const history = async (parameter: string, step: string) => pool.query(
    `INSERT INTO observation_history (source_id, station_id, parameter, observed_at, value, quality)
     SELECT s.source_id, s.station_id, s.parameter, t, 1 + random(), 'G'
       FROM observation_stations s
      CROSS JOIN generate_series(date_trunc('hour', now()) - interval '73 hours', now(), $2::interval) t
      WHERE s.station_id LIKE 'perf-%' AND s.parameter = $1
     ON CONFLICT DO NOTHING`, [parameter, step]);
  await history('precipitation_15min', '15 minutes');
  await history('sea_level', '1 hour');
  await history('water_flow', '1 hour');
  await pool.query(
    `INSERT INTO station_observation_history (source_id, station_id, parameter, observed_at, value, unit, quality, extra)
     SELECT s.source_id, s.station_id, s.parameter, t, 5 + random() * 10, 'µg/m³', 'G', '{"resolution":"hour"}'::jsonb
       FROM observation_stations s
      CROSS JOIN generate_series(date_trunc('hour', now()) - interval '2 hours', date_trunc('hour', now()), interval '1 hour') t
      WHERE s.station_id LIKE 'perf-%' AND s.source_id = 'air_quality'
     ON CONFLICT DO NOTHING`);
}

async function seedOrganization(n: number, now: Date) {
  const clerkOrgId = orgClerkId(n);
  const existing = await pool.query<{ c: string }>(
    `SELECT count(p.id)::text AS c FROM organizations o LEFT JOIN properties p ON p.organization_id = o.id WHERE o.clerk_org_id = $1`, [clerkOrgId]);
  if (Number(existing.rows[0]?.c ?? 0) === n) return 'kept';
  await pool.query(`DELETE FROM organizations WHERE clerk_org_id = $1`, [clerkOrgId]);
  await pool.query(`DELETE FROM source_events WHERE external_id LIKE $1`, [`perf:${n}:%`]);
  const organizationId = await ensureOrganization(pool, clerkOrgId, `Perf ${n}`);
  const ctx = { organizationId, userId: 'user_perf' };
  const series = forecastSeries(now);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [name, clat, clon] = city(n * 10_000 + i);
    const location = { lat: Math.round((clat + (rand(i * 3 + 1) - 0.5) * 0.12) * 1e6) / 1e6, lon: Math.round((clon + (rand(i * 3 + 2) - 0.5) * 0.2) * 1e6) / 1e6 };
    const address = `Perfgatan ${i + 1}, ${name}`;
    const p = await createProperty(pool, ctx, {
      name: `Perf ${i + 1}`, address, location,
      geocode: { provider: 'geoapify', placeId: `perf-${n}-${i}`, label: address, resultType: 'building', precision: 'building', confidence: 1, geocodedPoint: location, city: name, municipality: `${name} kommun` },
    });
    ids.push(p.id);
    await upsertPropertyForecast(pool, { propertyId: p.id, organizationId, sourceId: 'smhi_forecast', referenceTime: series.steps[0]!.time, createdTime: series.steps[0]!.time, grid: { lat: location.lat + 0.01, lon: location.lon + 0.01 }, series });
  }

  // One county warning (60 % of properties), one Krisinformation message (all) and 4 local traffic events per property.
  const warning = event(`perf:${n}:county-warning`, { dataClass: 'OFFICIAL_WARNING', category: 'Weather', level: 'Orange', severity: 'warning', eventType: 'Vind', headline: 'Orange varning – mycket hårda vindbyar', description: WARNING_TEXT, areaLabel: 'Länet' }, now);
  const kris = event(`perf:${n}:krisinformation`, { dataClass: 'OFFICIAL_WARNING', category: 'Crisis', level: 'Info', severity: 'monitor', eventType: 'Information', headline: 'Information från myndigheterna', description: 'Perf: Myndigheterna informerar om läget i regionen. Följ lokala nyheter.' }, now);
  await upsertSourceEvents(pool, 'smhi_warnings', [warning]);
  await upsertSourceEvents(pool, 'krisinformation', [kris]);
  const traffic: SourceEventInput[] = [];
  const located = await pool.query<{ id: string; lat: number; lon: number }>(
    `SELECT id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon FROM properties WHERE organization_id = $1`, [organizationId]);
  for (const p of located.rows) for (let k = 0; k < 4; k++) {
    traffic.push(event(`perf:${n}:${p.id}:${k}`, {
      dataClass: 'PUBLIC_EVENT', category: 'Traffic', severity: k === 0 ? 'warning' : 'monitor', eventType: 'Vägarbete',
      headline: 'Vägarbete, ett körfält avstängt', description: 'Perf: Vägarbete pågår. Ett körfält är avstängt i båda riktningar. Räkna med köbildning och längre restid under rusningstid.',
      geometryWkt: `POINT(${p.lon + 0.003 * (k + 1)} ${p.lat + 0.002})`,
    }, now));
  }
  await upsertSourceEvents(pool, 'trafikverket', traffic);

  await pool.query(
    `INSERT INTO property_event_matches (property_id, event_id, organization_id, match_method, distance_m, matched_version)
     SELECT p.id, e.id, p.organization_id, 'within_radius', 250 + (abs(hashtext(e.external_id)) % 1500), e.version
       FROM properties p JOIN source_events e ON e.source_id = 'trafikverket' AND e.external_id LIKE 'perf:' || $2 || ':' || p.id || ':%'
      WHERE p.organization_id = $1
     UNION ALL
     SELECT p.id, e.id, p.organization_id, 'polygon_intersection', 0, e.version
       FROM properties p JOIN source_events e ON e.external_id = 'perf:' || $2 || ':county-warning'
      WHERE p.organization_id = $1 AND abs(hashtext(p.id::text)) % 10 < 6
     UNION ALL
     SELECT p.id, e.id, p.organization_id, 'municipality', NULL, e.version
       FROM properties p JOIN source_events e ON e.external_id = 'perf:' || $2 || ':krisinformation'
      WHERE p.organization_id = $1
     ON CONFLICT DO NOTHING`, [organizationId, String(n)]);

  // 30 days of traffic changes (2.3 per property and day) plus the warnings' "new" rows.
  await pool.query(
    `INSERT INTO monitoring_changes (organization_id, property_id, event_id, source_id, change_type, data_class, severity, headline, dedup_key, created_at)
     SELECT p.organization_id, p.id, e.id, 'trafikverket', (ARRAY['new','updated','ended'])[1 + g % 3], 'PUBLIC_EVENT',
            CASE WHEN g % 7 = 0 THEN 'warning' ELSE 'monitor' END, 'Vägarbete, ett körfält avstängt',
            'perf:' || p.id || ':' || g, now() - make_interval(secs => g * 30 * 86400 / 70.0)
       FROM properties p CROSS JOIN generate_series(1, 70) g
       JOIN source_events e ON e.source_id = 'trafikverket' AND e.external_id = 'perf:' || $2 || ':' || p.id || ':' || (g % 4)
      WHERE p.organization_id = $1
     UNION ALL
     SELECT m.organization_id, m.property_id, m.event_id, e.source_id, 'new', 'OFFICIAL_WARNING', e.severity, e.headline,
            'perf:w:' || m.property_id || ':' || e.id, now() - interval '30 minutes'
       FROM property_event_matches m JOIN source_events e ON e.id = m.event_id AND e.data_class = 'OFFICIAL_WARNING'
      WHERE m.organization_id = $1 AND e.external_id LIKE 'perf:%'
     ON CONFLICT (dedup_key) DO NOTHING`, [organizationId, String(n)]);

  // One SMS rule for all properties (copied into every property's alertRules) with one recipient.
  const app = await perfApp();
  try {
    const headers = { authorization: `Bearer ${token(n)}`, 'content-type': 'application/json' };
    const rec = await app.inject({ method: 'POST', url: '/v1/notifications/recipients', headers, payload: { phone: '+46700000001', consent: true } });
    const recipientId = (rec.json() as { id?: string; recipient?: { id?: string } }).id ?? (rec.json() as { recipient?: { id?: string } }).recipient?.id;
    if (!recipientId) throw new Error(`recipient: ${rec.statusCode}`);
    const rule = await app.inject({
      method: 'POST', url: '/v1/notifications/rules', headers,
      payload: { name: 'Perf varningar', enabled: true, scope: 'all_future', propertyIds: [], recipientIds: [recipientId], condition: { category: 'smhi_warning', levels: ['Yellow', 'Orange', 'Red'], updates: true, cancellations: true }, quietHours: { enabled: false, start: '22:00', end: '07:00', emergencyException: true } },
    });
    if (rule.statusCode >= 300) throw new Error(`rule: ${rule.statusCode} ${rule.body.slice(0, 200)}`);
  } finally {
    await app.close();
  }
  return 'seeded';
}

const verify: AuthVerifier = async (req) => {
  const m = /^Bearer perf-(\d+)$/.exec(req.headers.authorization ?? '');
  return m ? { userId: 'user_perf', sessionId: 'perf', clerkOrgId: orgClerkId(Number(m[1])), orgRole: 'org:admin', orgSlug: `perf-${m[1]}` } : null;
};

async function perfApp() {
  const env = loadServerEnv({ NODE_ENV: 'test' });
  return buildApp(env, { logger: false, verifyAuth: verify, db: pool, monitoring: new MonitoringService(pool, env, new MonitoringBus()) });
}

async function measure(n: number, concurrency: number, rounds = 3) {
  const app = await perfApp();
  const mb = (b: number) => Math.round(b / 1_048_576);
  let heapPeak = 0;
  let totalPeak = 0;
  let rssPeak = 0;
  const sample = () => {
    const m = process.memoryUsage();
    heapPeak = Math.max(heapPeak, m.heapUsed);
    rssPeak = Math.max(rssPeak, m.rss);
    totalPeak = Math.max(totalPeak, getHeapStatistics().total_heap_size);
  };
  const sampler = setInterval(sample, 2);
  const once = async () => {
    const t0 = performance.now();
    const r = await app.inject({ method: 'GET', url: '/v1/portfolio', headers: { authorization: `Bearer ${token(n)}` } });
    sample();
    if (r.statusCode !== 200) throw new Error(`portfolio ${r.statusCode}`);
    return { ms: performance.now() - t0, bytes: r.rawPayload.length, properties: (r.json() as { properties: unknown[] }).properties.length };
  };
  (globalThis as { gc?: () => void }).gc?.();
  const baseHeap = process.memoryUsage().heapUsed;
  const warm = await once();
  const times: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const results = await Promise.all(Array.from({ length: concurrency }, once));
    times.push(...results.map((x) => x.ms));
  }
  clearInterval(sampler);
  await app.close();
  times.sort((a, b) => a - b);
  return {
    n, concurrency, properties: warm.properties, bytes: warm.bytes,
    firstMs: Math.round(warm.ms), medianMs: Math.round(times[Math.floor(times.length / 2)]!), maxMs: Math.round(times.at(-1)!),
    baseHeapMb: mb(baseHeap), heapPeakMb: mb(heapPeak), totalHeapPeakMb: mb(totalPeak), rssPeakMb: mb(rssPeak),
  };
}

/** The API's heap ceiling in production (deploy/pod/index.js); it was 192 MB until Fas 0 measured it. */
const PROD_HEAP_MB = 512;

/** Runs `measure` in child processes: production heap limit first, then the smallest limit that still works. */
function matrix(sizes: number[]) {
  const self = fileURLToPath(import.meta.url);
  const run = (n: number, c: number, limit: number) => {
    const r = spawnSync(process.execPath, ['--expose-gc', `--max-old-space-size=${limit}`, self, 'measure', String(n), String(c)], { env: process.env, encoding: 'utf8', timeout: 600_000 });
    const line = r.stdout.trim().split('\n').at(-1) ?? '';
    if (r.status === 0 && line.startsWith('{')) return { ok: true as const, ...JSON.parse(line) };
    return { ok: false as const, reason: /heap out of memory|Allocation failed/i.test(r.stderr) ? 'OOM' : `exit ${r.status ?? r.signal}: ${r.stderr.trim().split('\n').at(-1)?.slice(0, 160)}` };
  };
  const out = [];
  for (const n of sizes) for (const c of [1, 3]) {
    const atProd = run(n, c, PROD_HEAP_MB);
    let minLimit: number | null = null;
    for (const limit of [64, 96, 128, 192, 256, 384, 512]) {
      if (run(n, c, limit).ok) { minLimit = limit; break; }
    }
    const row = { n, concurrency: c, prodHeapMb: PROD_HEAP_MB, atProdHeap: atProd.ok ? 'ok' : atProd.reason, minHeapLimitMb: minLimit, ...(atProd.ok ? atProd : {}) };
    console.log(JSON.stringify(row));
    out.push(row);
  }
  return out;
}

async function cleanup() {
  await pool.query(`DELETE FROM organizations WHERE clerk_org_id LIKE 'org_perfscale%'`);
  await pool.query(`DELETE FROM source_events WHERE external_id LIKE 'perf:%'`);
  await pool.query(`DELETE FROM observation_history WHERE station_id LIKE 'perf-%'`);
  await pool.query(`DELETE FROM station_observation_history WHERE station_id LIKE 'perf-%'`);
  await pool.query(`DELETE FROM observation_stations WHERE station_id LIKE 'perf-%'`);
}

const [mode, ...args] = process.argv.slice(2);
const sizes = args.map(Number).filter((x) => Number.isInteger(x) && x > 0);
try {
  if (mode === 'seed') {
    await migrateUp(pool, quiet);
    const now = new Date();
    await seedStations(now);
    for (const n of sizes) console.log(JSON.stringify({ n, seed: await seedOrganization(n, now) }));
  } else if (mode === 'measure') {
    console.log(JSON.stringify(await measure(sizes[0]!, sizes[1] ?? 1)));
  } else if (mode === 'matrix') {
    await pool.end();
    matrix(sizes);
  } else if (mode === 'cleanup') {
    await cleanup();
    console.log(JSON.stringify({ cleanup: 'done' }));
  } else {
    throw new Error('usage: seed|matrix|measure|cleanup <sizes…>');
  }
} finally {
  if (mode !== 'matrix') await pool.end();
}
