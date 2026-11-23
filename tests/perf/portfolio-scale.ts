/**
 * Scale measurement of GET /v1/portfolio against a REAL PostgreSQL/PostGIS test database
 * (docs/plans/skalning.md, Fas 0). Bundled by tsup.perf.config.ts and run INSIDE the f-radar pod by
 * scripts/run-portfolio-scale.mjs against `fastighetsradar_test` – never the application database.
 *
 *   node portfolio-scale.mjs seed 200 500 1000     # synthetic organizations (idempotent)
 *   node portfolio-scale.mjs matrix 200 500 1000   # measure in child processes (heap limits, concurrency)
 *   node --expose-gc --max-old-space-size=512 portfolio-scale.mjs measure 500 3
 *   node portfolio-scale.mjs fields 500             # bytes per field of one real response
 *   node --expose-gc portfolio-scale.mjs live 500   # a live row patch vs the full list (Fas 3 / S-12)
 *   node --expose-gc portfolio-scale.mjs profile 500 # where one portfolio build spends time (SQL, build, JSON) + EXPLAIN
 *   node portfolio-scale.mjs share [--clustered]   # fill the grid store from portfolio fixtures (Fas 7 / S-31)
 *   node portfolio-scale.mjs forecast 500 1000     # time a complete scheduled cycle with a stubbed SMHI API
 *   node portfolio-scale.mjs feed 500               # the feed and alarms at a county warning (Fas 2)
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
import { Session } from 'node:inspector/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadServerEnv } from '../../packages/config/src';
import {
  NEAREST_PARAMETERS,
  SESSION_OPTIONS,
  createProperty,
  ensureOrganization,
  migrateUp,
  upsertPropertyForecast,
  upsertSourceEvents,
  upsertStationObservations,
  type SourceEventInput,
  type StationObservationInput,
} from '../../packages/db/src';
import { filterActiveAlarms, listPortfolio, mergeUpcoming, type Portfolio, type PortfolioNowcastPatch, type PortfolioRowsPatch } from '../../packages/domain/src';
import { buildApp } from '../../apps/api/src/app';
import type { AuthVerifier } from '../../apps/api/src/auth';
import { MonitoringBus } from '../../apps/api/src/monitoring/bus';
import { MonitoringService } from '../../apps/api/src/monitoring/service';
import { measureForecastCycle } from '../integration/forecast-grid-fixture';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required');
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!/_test$/.test(dbName)) throw new Error(`Refusing to write to "${dbName}" (must end with _test)`);

const pool = new pg.Pool({ connectionString: url, max: 6, options: SESSION_OPTIONS });
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

/**
 * Where the bytes of a real `/v1/portfolio` response go: average bytes per property for each snapshot
 * field (and the parts of the heaviest ones), plus the portfolio-level fields. Sizes only, no content.
 */
async function fields(n: number) {
  const app = await perfApp();
  const r = await app.inject({ method: 'GET', url: '/v1/portfolio', headers: { authorization: `Bearer ${token(n)}` } });
  await app.close();
  if (r.statusCode !== 200) throw new Error(`portfolio ${r.statusCode}`);
  const portfolio = r.json() as { properties: Array<Record<string, unknown>> } & Record<string, unknown>;
  const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v ?? null));
  const count = portfolio.properties.length;
  const avg = (rows: Array<Record<string, unknown> | null | undefined>) => {
    const sums: Record<string, number> = {};
    for (const row of rows) for (const [k, v] of Object.entries(row ?? {})) sums[k] = (sums[k] ?? 0) + size(v);
    return Object.fromEntries(Object.entries(sums).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v / count)]));
  };
  const top = Object.fromEntries(Object.entries(portfolio).map(([k, v]) => [k, size(v)]).sort((a, b) => (b[1] as number) - (a[1] as number)));
  const props = portfolio.properties;
  return {
    n, properties: count, bytes: r.rawPayload.length, bytesPerProperty: Math.round(r.rawPayload.length / count),
    portfolioBytes: top,
    perPropertyAvgBytes: avg(props),
    forecastAvgBytes: avg(props.map((s) => s.forecast as Record<string, unknown> | null)),
    monitoringAvgBytes: avg(props.map((s) => s.monitoring as Record<string, unknown> | null)),
    nowcastAvgBytes: avg(props.map((s) => s.nowcast as Record<string, unknown> | null)),
    // Per property: bytes per sub-field of the list's heavy parts (arrays summed over their items).
    nestedAvgBytes: Object.fromEntries(['metrics', 'events', 'warnings', 'riskIndex', 'property', 'alertRules', 'utilityOutages', 'sms', 'flood'].map((key) => {
      const sums: Record<string, number> = {};
      for (const s of props) {
        const v = s[key];
        for (const item of (Array.isArray(v) ? v : v ? [v] : []) as Array<Record<string, unknown>>) {
          for (const [k, x] of Object.entries(item ?? {})) sums[k] = (sums[k] ?? 0) + size(x);
        }
      }
      return [key, Object.fromEntries(Object.entries(sums).sort((a, b) => b[1] - a[1]).map(([k, x]) => [k, Math.round(x / count)]))];
    })),
    counts: {
      events: Math.round(props.reduce((a, s) => a + ((s.events as unknown[] | undefined)?.length ?? 0), 0) / count * 10) / 10,
      warnings: Math.round(props.reduce((a, s) => a + ((s.warnings as unknown[] | undefined)?.length ?? 0), 0) / count * 10) / 10,
      metrics: Math.round(props.reduce((a, s) => a + ((s.metrics as unknown[] | undefined)?.length ?? 0), 0) / count * 10) / 10,
      alertRules: Math.round(props.reduce((a, s) => a + ((s.alertRules as unknown[] | undefined)?.length ?? 0), 0) / count * 10) / 10,
    },
  };
}

/**
 * A live update (docs/plans/skalning.md, Fas 3 / S-12): what one forecast run (40 properties) costs
 * as a row patch compared with reloading the list, and whether patching the list with it gives
 * exactly the list (rows, feed, active alarms, upcoming conditions). Sizes and times only.
 */
async function live(n: number) {
  const app = await perfApp();
  const headers = { authorization: `Bearer ${token(n)}` };
  const mb = (b: number) => Math.round((b / 1_048_576) * 10) / 10;
  const gc = () => (globalThis as { gc?: () => void }).gc?.();
  const timed = async (url: string, rounds = 3) => {
    gc();
    const base = process.memoryUsage().heapUsed;
    let peak = base;
    const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 2);
    const times: number[] = [];
    let last = null as Awaited<ReturnType<typeof app.inject>> | null;
    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      last = await app.inject({ method: 'GET', url, headers });
      times.push(performance.now() - t0);
      peak = Math.max(peak, process.memoryUsage().heapUsed);
      if (last.statusCode !== 200) throw new Error(`${url.split('?')[0]} ${last.statusCode}`);
    }
    clearInterval(sampler);
    times.sort((a, b) => a - b);
    return { medianMs: Math.round(times[Math.floor(times.length / 2)]!), bytes: last!.rawPayload.length, heapDeltaMb: mb(peak - base), json: last!.json() };
  };
  try {
    const full = await timed('/v1/portfolio');
    const list = full.json as Portfolio;
    const ids = list.properties.filter((_, i) => i % Math.max(1, Math.floor(list.properties.length / 40)) === 0).slice(0, 40).map((s) => s.property.id);
    const rows = await timed(`/v1/portfolio/rows?ids=${ids.join(',')}`);
    const patch = rows.json as PortfolioRowsPatch;
    const nowcast = await timed('/v1/portfolio/nowcast');
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const byId = new Map(patch.properties.map((s) => [s.property.id, s]));
    return {
      n,
      full: { medianMs: full.medianMs, bytes: full.bytes, heapDeltaMb: full.heapDeltaMb },
      rows: { properties: patch.properties.length, medianMs: rows.medianMs, bytes: rows.bytes, heapDeltaMb: rows.heapDeltaMb },
      nowcast: { properties: (nowcast.json as PortfolioNowcastPatch).nowcasts.length, medianMs: nowcast.medianMs, bytes: nowcast.bytes },
      patchEqualsList: {
        rows: patch.missing.length === 0 && ids.every((id) => same(byId.get(id), list.properties.find((s) => s.property.id === id))),
        feed: same(patch.feed, list.feed),
        activeAlarms: same(filterActiveAlarms(patch.alarmCandidates, list.properties), list.activeAlarms),
        upcoming: same(mergeUpcoming(list.upcoming, patch.upcoming, ids), list.upcoming),
      },
    };
  } finally {
    await app.close();
  }
}

/**
 * Where one `/v1/portfolio` build spends its time (Fas 3 steg 3): every SQL query timed alone on one
 * connection (rows and JSON size), the build in JS, the list cut and serializing; then
 * `EXPLAIN (ANALYZE, BUFFERS)` of the slowest queries. Timings, sizes and plans only – no content.
 */
async function profile(n: number) {
  const one = new pg.Pool({ connectionString: url, max: 1, options: SESSION_OPTIONS });
  const queries: Array<{ label: string; ms: number; rows: number; bytes: number; sql: string; params: unknown[] }> = [];
  const label = (sql: string) => {
    const flat = sql.replace(/\s+/g, ' ').trim();
    const from = /FROM ([a-z_]+)/i.exec(flat)?.[1] ?? '?';
    return `${from}: ${flat.slice(0, 70)}`;
  };
  // One query at a time, so each time is the query's own (the service runs them in parallel).
  let chain: Promise<unknown> = Promise.resolve();
  const db = {
    query<R>(sql: string, params: unknown[] = []) {
      const run = chain.then(async () => {
        const t0 = performance.now();
        const r = await one.query(sql, params);
        queries.push({ label: label(sql), ms: performance.now() - t0, rows: r.rows.length, bytes: Buffer.byteLength(JSON.stringify(r.rows)), sql, params });
        return { rows: r.rows as R[], rowCount: r.rowCount ?? r.rows.length };
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
  const env = loadServerEnv({ NODE_ENV: 'test' });
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM organizations WHERE clerk_org_id = $1', [orgClerkId(n)]);
  const t = { organizationId: rows[0]!.id, userId: 'user_perf', clerkOrgId: orgClerkId(n), orgSlug: `perf-${n}` };
  const service = new MonitoringService(db, env, new MonitoringBus());
  await service.list(t); // warm caches (status cache, JIT)
  queries.length = 0;
  (globalThis as { gc?: () => void }).gc?.();
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const served = await service.list(t);
  const built = performance.now();
  const heapBuilt = process.memoryUsage().heapUsed;
  const list = listPortfolio(served);
  const cut = performance.now();
  const body = JSON.stringify(list);
  const done = performance.now();
  const sqlMs = queries.reduce((a, q) => a + q.ms, 0);
  const slow = [...queries].sort((a, b) => b.ms - a.ms);
  // The slowest query again, three times (is it the query or its first run?).
  const again: number[] = [];
  for (let i = 0; i < 3; i++) {
    const a0 = performance.now();
    await one.query(slow[0]!.sql, slow[0]!.params);
    again.push(Math.round(performance.now() - a0));
  }
  const plans = [];
  for (const q of slow.slice(0, 4)) {
    const r = await one.query(`EXPLAIN (ANALYZE, BUFFERS) ${q.sql}`, q.params);
    plans.push({ label: q.label, ms: Math.round(q.ms), plan: r.rows.map((x: Record<string, string>) => x['QUERY PLAN']) });
  }
  await one.end();
  // The list must equal the list cut from the FULL build (same time, same user).
  const real = new MonitoringService(pool, env, new MonitoringBus());
  const at = new Date();
  const reference = listPortfolio(await real.portfolio(t, at));
  const candidate = await real.list(t, at);
  const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  const rowFields = new Set<string>();
  reference.properties.forEach((s, i) => {
    const c = candidate.properties[i] as unknown as Record<string, unknown> | undefined;
    for (const [k, v] of Object.entries(s)) if (!c || differs(v, c[k])) rowFields.add(k);
  });
  const equalsFullList = {
    equal: !differs(reference, candidate),
    portfolioFields: Object.keys(reference).filter((k) => differs((reference as Record<string, unknown>)[k], (candidate as unknown as Record<string, unknown>)[k])),
    rowFields: [...rowFields],
  };
  // The full build in parallel, as the API ran it before Fas 3 steg 3.
  const f0 = performance.now();
  await real.portfolio(t);
  const fullParallelMs = performance.now() - f0;
  // The list with the normal pool (queries in parallel), as the API runs it – CPU-profiled.
  await real.list(t);
  const session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval', { interval: 200 });
  await session.post('Profiler.start');
  const r0 = performance.now();
  await real.list(t);
  const parallelMs = performance.now() - r0;
  const { profile: cpu } = await session.post('Profiler.stop');
  session.disconnect();
  // Self time per function (bundle line), from the sampled call tree.
  const dt = new Map<number, number>();
  cpu.samples?.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (cpu.timeDeltas?.[i] ?? 0)));
  const self = new Map<string, number>();
  for (const node of cpu.nodes) {
    const f = node.callFrame;
    const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (dt.get(node.id) ?? 0) / 1000);
  }
  const hot = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([fn, ms]) => ({ fn, ms: Math.round(ms) }));
  const round = (x: number) => Math.round(x);
  return {
    n, properties: served.properties.length, slowestAgainMs: again, parallelMs: round(parallelMs), fullParallelMs: round(fullParallelMs), equalsFullList,
    totalMs: round(done - t0), sqlMs: round(sqlMs), buildMs: round(built - t0 - sqlMs), listMs: round(cut - built), stringifyMs: round(done - cut),
    bytes: Buffer.byteLength(body), heapAfterBuildMb: Math.round((heapBuilt - heap0) / 1_048_576),
    queries: slow.map((q) => ({ label: q.label, ms: round(q.ms), rows: q.rows, kb: round(q.bytes / 1024) })),
    hot,
    plans,
  };
}

/**
 * The feed and the active alarms of the synthetic organization (Fas 2, S-04/S-06/S-07): how many
 * cards (events) and rows the feed shows, how many properties each card names compared with how many
 * the event really reaches, and which sources are left. Counts only.
 */
async function feed(n: number) {
  const app = await perfApp();
  const r = await app.inject({ method: 'GET', url: '/v1/portfolio', headers: { authorization: `Bearer ${token(n)}` } });
  await app.close();
  if (r.statusCode !== 200) throw new Error(`portfolio ${r.statusCode}`);
  const p = r.json() as Portfolio;
  const key = (f: Portfolio['feed'][number]) => f.eventGroupId ?? f.id;
  const groups = new Map<string, Set<string>>();
  for (const f of p.feed) groups.set(key(f), (groups.get(key(f)) ?? new Set()).add(f.propertyId));
  const { rows } = await pool.query<{ external_id: string; matches: number }>(
    `SELECT e.external_id, count(*)::int AS matches FROM property_event_matches m JOIN source_events e ON e.id = m.event_id
       JOIN organizations o ON o.id = m.organization_id WHERE o.clerk_org_id = $1 AND e.data_class = 'OFFICIAL_WARNING' GROUP BY 1`, [orgClerkId(n)]);
  const alarmEvents = new Set((p.activeAlarms ?? []).map((a) => a.eventId));
  return {
    n,
    feed: { rows: p.feed.length, cards: groups.size, propertiesPerCard: [...groups.values()].map((g) => g.size).sort((a, b) => b - a).slice(0, 8), sources: [...new Set(p.feed.map((f) => f.sourceId))] },
    warningsReach: rows.map((x) => x.matches).sort((a, b) => b - a),
    activeAlarms: { rows: p.activeAlarms?.length ?? 0, events: alarmEvents.size, unread: (p.activeAlarms ?? []).filter((a) => a.unreadAlarmId).length },
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

/** Give the legacy and grid-backed portfolio endpoints exactly the same rows and forecast values. */
async function shareForecastFixtures(clustered: boolean) {
  await migrateUp(pool, quiet);
  if (clustered) {
    // The Phase 3 seed has one synthetic grid coordinate per pin. Assign shared ~2.5 km cells
    // to those same properties, in both stores, without changing the weather or the rest of the workload.
    await pool.query(`WITH points AS (
      SELECT p.id, p.location, ST_SetSRID(ST_MakePoint(round(ST_X(p.location::geometry) * 25) / 25,
             round(ST_Y(p.location::geometry) * 45) / 45), 4326)::geography AS grid_point
        FROM properties p JOIN organizations o ON o.id = p.organization_id WHERE o.clerk_org_id LIKE 'org_perfscale%'
    ) UPDATE property_forecasts f SET grid_point = p.grid_point,
         distance_m = round(ST_Distance(p.location, p.grid_point)::numeric, 0) FROM points p WHERE p.id = f.property_id`);
  }
  await pool.query(`INSERT INTO forecast_grid_points (lat, lon, reference_time, created_time, fetched_at, series)
    SELECT DISTINCT ON (lat, lon) ST_Y(f.grid_point::geometry) AS lat, ST_X(f.grid_point::geometry) AS lon,
           f.reference_time, f.created_time, f.fetched_at, f.series
      FROM property_forecasts f JOIN organizations o ON o.id = f.organization_id
     WHERE o.clerk_org_id LIKE 'org_perfscale%' AND f.grid_point IS NOT NULL
     ORDER BY lat, lon, f.fetched_at DESC
    ON CONFLICT (lat, lon) DO NOTHING`);
  const linked = await pool.query(`INSERT INTO property_forecast_links (property_id, organization_id, point_id, for_location, distance_m)
    SELECT f.property_id, f.organization_id, g.id, p.location, f.distance_m
      FROM property_forecasts f JOIN organizations o ON o.id = f.organization_id
      JOIN properties p ON p.id = f.property_id AND p.organization_id = f.organization_id
      JOIN forecast_grid_points g ON g.lat = ST_Y(f.grid_point::geometry) AND g.lon = ST_X(f.grid_point::geometry)
     WHERE o.clerk_org_id LIKE 'org_perfscale%'
    ON CONFLICT (property_id) DO UPDATE SET point_id = EXCLUDED.point_id, for_location = EXCLUDED.for_location, distance_m = EXCLUDED.distance_m`);
  await pool.query('ANALYZE forecast_grid_points, property_forecast_links');
  const { rows: [row] } = await pool.query<{ points: number }>(`SELECT count(DISTINCT l.point_id)::int AS points
    FROM property_forecast_links l JOIN organizations o ON o.id = l.organization_id WHERE o.clerk_org_id LIKE 'org_perfscale%'`);
  console.log(JSON.stringify({ linked: linked.rowCount, points: row?.points, clustered }));
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
  } else if (mode === 'forecast') {
    for (const n of sizes) console.log(JSON.stringify(await measureForecastCycle(pool, n)));
  } else if (mode === 'share') {
    await shareForecastFixtures(args.includes('--clustered'));
  } else if (mode === 'fields') {
    for (const n of sizes) console.log(JSON.stringify(await fields(n)));
  } else if (mode === 'feed') {
    for (const n of sizes) console.log(JSON.stringify(await feed(n)));
  } else if (mode === 'profile') {
    for (const n of sizes) console.log(JSON.stringify(await profile(n)));
  } else if (mode === 'live') {
    for (const n of sizes) console.log(JSON.stringify(await live(n)));
  } else if (mode === 'matrix') {
    await pool.end();
    matrix(sizes);
  } else if (mode === 'cleanup') {
    await cleanup();
    console.log(JSON.stringify({ cleanup: 'done' }));
  } else {
    throw new Error('usage: seed|matrix|measure|forecast|share|fields|live|profile|feed|cleanup <sizes…>');
  }
} finally {
  if (mode !== 'matrix') await pool.end();
}
