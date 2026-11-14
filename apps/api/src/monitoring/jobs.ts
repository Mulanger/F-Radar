import { HISTORY, WEATHER_WATER } from '@fastighetsradar/domain';
import type { ServerEnv } from '@fastighetsradar/config';
import { NotificationService } from '../notifications/service';
import { runHistoryAggregation, runHistoryBackfill } from './history';
import {
  stationsNeedingFlowReference, saveFlowReferences,
  stationsNeedingBackfill, markBackfillChecked,
  insertObservationHistory,
  applyRetention,
  loadNowcastCache, saveNowcastPoint, revalidateNowcastPoint,
  countCountyAreas,
  endEventsById,
  endMissingEvents,
  expireEvents,
  listMonitoringTargets,
  propertiesNeedingContext,
  propertiesNeedingForecast,
  rematchEvents,
  upsertCountyAreas,
  upsertPropertyContext,
  upsertPropertyForecast,
  upsertSourceEvents,
  upsertStationObservations,
  type JobDefinition,
  type MatchChange,
  type Queryable,
} from '@fastighetsradar/db';
import {
  AIR_PHENOMENA,
  MCF_ATTRIBUTION,
  MCF_RADII,
  METOBS_PARAMETERS,
  SCB_ATTRIBUTION,
  SCB_TABLE,
  SGU_ATTRIBUTION,
  TRAFIKVERKET_POINTS_PER_REQUEST,
  fetchHydrology, fetchHydrologyReference,
  fetchMetObsStationSeries,
  fetchOceanography,
  fetchMetNowcast,
  sleep,
  fetchAirQuality,
  fetchSlDeviations,
  fetchObservedGroundwater,
  fetchKrisinformation,
  fetchMetObsLatest,
  fetchMunicipalityStats,
  fetchSguAreaId,
  fetchSguLatestLevel,
  fetchSmhiCountyAreas,
  fetchSmhiPointForecast,
  fetchSmhiWarnings,
  fetchTrafikverketNear,
  probeFloodScenarios,
  resolveMunicipalityCode,
  trafikverketReady,
  type AdapterContext,
  type AdapterErrorCode,
  type NormalizedSourceEvent,
  type PointForecast,
} from '@fastighetsradar/integrations';

/**
 * Scheduled collection jobs (Phase 3). Each job:
 *  - fetches CENTRALLY (one request per provider dataset, or per property point for point/context
 *    sources), never on dashboard page views;
 *  - writes current snapshots via the db package;
 *  - reports a result the scheduler turns into job state, freshness and backoff.
 * A failed fetch never deletes or ends existing data: only a complete, successful fetch may end
 * events that disappeared upstream.
 */

export interface JobResult {
  status: 'ok' | 'partial' | 'error' | 'skipped';
  items: number;
  errorCode?: AdapterErrorCode | string;
  errorDetail?: string;
  retryAfterSeconds?: number;
  sourceUpdatedAt?: string | null;
  /** Organizations/properties whose data changed (for the live stream). `all` = every org. */
  changed?: { all?: boolean; changes?: MatchChange[] };
  /** Ask for another run soon (more properties pending). */
  moreWork?: boolean;
}

export interface JobContext {
  db: Queryable;
  adapter: AdapterContext;
}

export interface MonitoringJob extends JobDefinition {
  timeoutMs: number;
  run: (ctx: JobContext) => Promise<JobResult>;
}

const fail = (r: { error: AdapterErrorCode; detail?: string; retryAfterSeconds?: number }): JobResult => ({
  status: 'error',
  items: 0,
  errorCode: r.error,
  errorDetail: r.detail,
  retryAfterSeconds: r.retryAfterSeconds,
});

/* ------------------------------------------------------------------ */
/* Events: SMHI warnings, Krisinformation, Trafikverket                 */
/* ------------------------------------------------------------------ */

async function storeCentralEvents(ctx: JobContext, sourceId: NormalizedSourceEvent['sourceId'], events: NormalizedSourceEvent[], complete: boolean) {
  const res = await upsertSourceEvents(ctx.db, sourceId, events);
  const ended = complete ? await endMissingEvents(ctx.db, sourceId, events.map((e) => e.externalId)) : 0;
  await expireEvents(ctx.db);
  const changes = await rematchEvents(ctx.db);
  return { res, ended, changes };
}

const latest = (events: NormalizedSourceEvent[]) =>
  events.map((e) => e.sourceUpdatedAt ?? e.publishedAt).filter((x): x is string => !!x).sort().at(-1) ?? null;

async function runSmhiWarnings(ctx: JobContext): Promise<JobResult> {
  const r = await fetchSmhiWarnings(ctx.adapter);
  if (!r.ok) return fail(r);
  const { changes, res, ended } = await storeCentralEvents(ctx, 'smhi_warnings', r.data.events, true);
  return {
    status: r.data.skipped > 0 ? 'partial' : 'ok',
    items: r.data.events.length,
    errorDetail: `inserted ${res.inserted}, updated ${res.updated}, ended ${ended}, skipped ${r.data.skipped}`,
    sourceUpdatedAt: latest(r.data.events),
    changed: { changes },
  };
}

async function runKrisinformation(ctx: JobContext): Promise<JobResult> {
  const r = await fetchKrisinformation(ctx.adapter);
  if (!r.ok) return fail(r);
  const { changes, res, ended } = await storeCentralEvents(ctx, 'krisinformation', r.data.events, true);
  return {
    status: 'ok',
    items: r.data.events.length,
    errorDetail: `inserted ${res.inserted}, updated ${res.updated}, ended ${ended}, unscoped ${r.data.skipped}`,
    sourceUpdatedAt: latest(r.data.events),
    changed: { changes },
  };
}

async function runTrafikverket(ctx: JobContext): Promise<JobResult> {
  if (!trafikverketReady(ctx.adapter)) return { status: 'skipped', items: 0, errorCode: 'access_required', errorDetail: 'TRAFIKVERKET_ENABLED/KEY not set' };
  const targets = await listMonitoringTargets(ctx.db);
  // De-duplicate nearby points (~1 km grid) to keep requests small.
  const pts = [...new Map(targets.map((t) => [`${t.lat.toFixed(2)},${t.lon.toFixed(2)}`, { lat: t.lat, lon: t.lon }])).values()];
  const all: NormalizedSourceEvent[] = [];
  const deleted: string[] = [];
  for (let i = 0; i < pts.length; i += TRAFIKVERKET_POINTS_PER_REQUEST) {
    const r = await fetchTrafikverketNear(pts.slice(i, i + TRAFIKVERKET_POINTS_PER_REQUEST), ctx.adapter);
    if (!r.ok) {
      // Keep what we have; do NOT end missing events after an incomplete fetch.
      if (all.length) await storeCentralEvents(ctx, 'trafikverket', all, false);
      return fail(r);
    }
    all.push(...r.data.events);
    deleted.push(...r.data.deletedIds);
  }
  const unique = [...new Map(all.map((e) => [e.externalId, e])).values()];
  await endEventsById(ctx.db, 'trafikverket', deleted, 'deleted_by_source');
  const { changes, res, ended } = await storeCentralEvents(ctx, 'trafikverket', unique, true);
  return {
    status: 'ok',
    items: unique.length,
    errorDetail: `points ${pts.length}, inserted ${res.inserted}, updated ${res.updated}, ended ${ended}`,
    sourceUpdatedAt: latest(unique),
    changed: { changes },
  };
}

async function runCountyAreas(ctx: JobContext): Promise<JobResult> {
  const r = await fetchSmhiCountyAreas(ctx.adapter);
  if (!r.ok) return fail(r);
  const n = await upsertCountyAreas(ctx.db, 'smhi_warnings', r.data);
  const changes = await rematchEvents(ctx.db);
  return { status: 'ok', items: n, changed: { all: true, changes } };
}

/* ------------------------------------------------------------------ */
/* Point forecast per property                                         */
/* ------------------------------------------------------------------ */

export const FORECAST_MAX_AGE_S = 3_600;
const PER_RUN = { forecast: 40, sgu: 25, mcf: 8, scb: 20 };

async function runForecasts(ctx: JobContext): Promise<JobResult> {
  const targets = await propertiesNeedingForecast(ctx.db, FORECAST_MAX_AGE_S - 120, PER_RUN.forecast);
  if (!targets.length) return { status: 'ok', items: 0 };
  const cache = new Map<string, PointForecast>();
  let ok = 0;
  let lastErr: JobResult | null = null;
  let ref: string | null = null;
  for (const t of targets) {
    const key = `${t.lat.toFixed(3)},${t.lon.toFixed(3)}`;
    let f = cache.get(key);
    if (!f) {
      const r = await fetchSmhiPointForecast(t.lat, t.lon, ctx.adapter);
      if (!r.ok) {
        lastErr = fail(r);
        if (r.error === 'rate_limited' || r.error === 'unauthorized') break;
        continue;
      }
      f = r.data;
      cache.set(key, f);
    }
    await upsertPropertyForecast(ctx.db, {
      propertyId: t.propertyId,
      organizationId: t.organizationId,
      sourceId: 'smhi_forecast',
      referenceTime: f.referenceTime,
      createdTime: f.createdTime,
      grid: f.gridPoint,
      series: { v: 2, steps: f.steps },
    });
    ref = f.referenceTime;
    ok++;
  }
  if (!ok && lastErr) return lastErr;
  return {
    status: lastErr ? 'partial' : 'ok',
    items: ok,
    errorCode: lastErr?.errorCode,
    errorDetail: lastErr?.errorDetail,
    sourceUpdatedAt: ref,
    changed: { all: true },
    moreWork: targets.length === PER_RUN.forecast,
  };
}

/* ------------------------------------------------------------------ */
/* Station observations (MetObs, air quality)                          */
/* ------------------------------------------------------------------ */

async function runMetObs(ctx: JobContext): Promise<JobResult> {
  let items = 0;
  let failures = 0;
  let lastErr: JobResult | null = null;
  let newest: string | null = null;
  for (const p of METOBS_PARAMETERS) {
    const r = await fetchMetObsLatest(p, ctx.adapter);
    if (!r.ok) {
      failures++;
      lastErr = fail(r);
      continue;
    }
    await insertObservationHistory(ctx.db,'smhi_observations',r.data);
    items += await upsertStationObservations(ctx.db, 'smhi_observations', latestStationReadings(r.data));
    for (const o of r.data) if (o.observedAt && (!newest || o.observedAt > newest)) newest = o.observedAt;
  }
  if (failures === METOBS_PARAMETERS.length) return lastErr!;
  return { status: failures ? 'partial' : 'ok', items, errorCode: lastErr?.errorCode, errorDetail: lastErr?.errorDetail, sourceUpdatedAt: newest, changed: { all: true } };
}

async function runAirQuality(ctx: JobContext): Promise<JobResult> {
  let items = 0;
  let failures = 0;
  let lastErr: JobResult | null = null;
  let newest: string | null = null;
  // Sequential on purpose: the upstream is slow; parallel calls would only add load.
  for (const p of AIR_PHENOMENA) {
    const r = await fetchAirQuality(p, ctx.adapter);
    if (!r.ok) {
      failures++;
      lastErr = fail(r);
      continue;
    }
    await insertObservationHistory(ctx.db,'air_quality',r.data);
    items += await upsertStationObservations(ctx.db, 'air_quality', latestStationReadings(r.data));
    for (const o of r.data) if (o.observedAt && (!newest || o.observedAt > newest)) newest = o.observedAt;
  }
  if (failures === AIR_PHENOMENA.length) return lastErr!;
  return { status: failures ? 'partial' : 'ok', items, errorCode: lastErr?.errorCode, errorDetail: lastErr?.errorDetail, sourceUpdatedAt: newest, changed: { all: true } };
}

/* ------------------------------------------------------------------ */
/* Per-property context: SGU, MCF, SCB                                 */
/* ------------------------------------------------------------------ */

async function runPerProperty(
  ctx: JobContext,
  sourceId: string,
  contextKey: string,
  maxAgeS: number,
  limit: number,
  each: (t: Awaited<ReturnType<typeof listMonitoringTargets>>[number]) => Promise<{ ok: true } | { ok: false; result: JobResult; abort?: boolean }>,
): Promise<JobResult> {
  const targets = await propertiesNeedingContext(ctx.db, sourceId, contextKey, maxAgeS, limit);
  let ok = 0;
  let lastErr: JobResult | null = null;
  for (const t of targets) {
    const r = await each(t);
    if (r.ok) ok++;
    else {
      lastErr = r.result;
      if (r.abort) break;
    }
  }
  if (!targets.length) return { status: 'ok', items: 0 };
  if (!ok && lastErr) return lastErr;
  return { status: lastErr ? 'partial' : 'ok', items: ok, errorCode: lastErr?.errorCode, errorDetail: lastErr?.errorDetail, changed: { all: ok > 0 }, moreWork: targets.length === limit };
}

const abortOn = (e: AdapterErrorCode) => e === 'rate_limited' || e === 'unauthorized' || e === 'timeout';

async function runSl(ctx: JobContext): Promise<JobResult> {
  const r = await fetchSlDeviations(ctx.adapter);
  if (!r.ok) return fail(r);
  const { changes } = await storeCentralEvents(ctx, 'sl_deviations', r.data.events, r.data.invalid === 0);
  return { status: r.data.invalid ? 'partial' : 'ok', items: r.data.events.length, changed: { changes },
    errorDetail: `Unlocated line messages: ${r.data.unlocated}; invalid: ${r.data.invalid}` };
}

async function runObservedGroundwater(ctx: JobContext): Promise<JobResult> {
  return runPerProperty(ctx, 'sgu_observed_groundwater', 'groundwater_observation', 24 * 3_600, PER_RUN.sgu, async (t) => {
    const r = await fetchObservedGroundwater(t.lat, t.lon, ctx.adapter);
    if (!r.ok) return { ok: false, result: fail(r), abort: abortOn(r.error) };
    await upsertPropertyContext(ctx.db, {
      propertyId: t.propertyId, organizationId: t.organizationId, sourceId: 'sgu_observed_groundwater', contextKey: 'groundwater_observation',
      dataClass: 'OBSERVATION', status: r.data ? 'ok' : 'no_coverage', sourceTimestamp: r.data?.observedAt ?? null,
      payload: r.data ? { ...r.data } : { note: 'Ingen station inom 10 km med anmärkningsfritt mätvärde de senaste 31 dagarna.' },
    });
    return { ok: true };
  });
}

async function runSgu(ctx: JobContext): Promise<JobResult> {
  return runPerProperty(ctx, 'sgu_groundwater', 'groundwater', 12 * 3_600, PER_RUN.sgu, async (t) => {
    const area = await fetchSguAreaId(t.lat, t.lon, ctx.adapter);
    if (!area.ok) return { ok: false, result: fail(area), abort: abortOn(area.error) };
    if (!area.data) {
      await upsertPropertyContext(ctx.db, {
        propertyId: t.propertyId, organizationId: t.organizationId, sourceId: 'sgu_groundwater', contextKey: 'groundwater',
        dataClass: 'MODEL', status: 'no_coverage', sourceTimestamp: null,
        payload: { note: 'Fastigheten ligger utanför SGU:s modellområden (HYPE).', attribution: SGU_ATTRIBUTION },
      });
      return { ok: true };
    }
    const lv = await fetchSguLatestLevel(area.data, ctx.adapter);
    if (!lv.ok) return { ok: false, result: fail(lv), abort: abortOn(lv.error) };
    await upsertPropertyContext(ctx.db, {
      propertyId: t.propertyId, organizationId: t.organizationId, sourceId: 'sgu_groundwater', contextKey: 'groundwater',
      dataClass: 'MODEL', status: lv.data ? 'ok' : 'no_coverage', sourceTimestamp: lv.data ? `${lv.data.date}T00:00:00Z` : null,
      payload: lv.data ? { ...lv.data, attribution: SGU_ATTRIBUTION } : { areaId: area.data, note: 'Inga modellvärden de senaste 30 dagarna.', attribution: SGU_ATTRIBUTION },
    });
    return { ok: true };
  });
}

async function runMcf(ctx: JobContext): Promise<JobResult> {
  return runPerProperty(ctx, 'mcf_flood', 'flood_scenarios', 7 * 86_400, PER_RUN.mcf, async (t) => {
    const r = await probeFloodScenarios(t.lat, t.lon, ctx.adapter);
    if (!r.ok) return { ok: false, result: fail(r), abort: abortOn(r.error) };
    await upsertPropertyContext(ctx.db, {
      propertyId: t.propertyId, organizationId: t.organizationId, sourceId: 'mcf_flood', contextKey: 'flood_scenarios',
      dataClass: 'STATIC_GEODATA', status: 'ok', sourceTimestamp: null,
      payload: { scenarios: r.data.scenarios, datasetVersion: r.data.datasetVersion, maxRadiusMeters: MCF_RADII[MCF_RADII.length - 1], attribution: MCF_ATTRIBUTION },
    });
    return { ok: true };
  });
}

async function runScb(ctx: JobContext): Promise<JobResult> {
  return runPerProperty(ctx, 'scb', 'municipality_stats', 7 * 86_400, PER_RUN.scb, async (t) => {
    const base = { propertyId: t.propertyId, organizationId: t.organizationId, sourceId: 'scb', contextKey: 'municipality_stats', dataClass: 'REGIONAL_STATISTIC' as const };
    if (!t.municipality) {
      await upsertPropertyContext(ctx.db, { ...base, status: 'unknown', sourceTimestamp: null, payload: { note: 'Kommun saknas för fastigheten (manuell placering).', attribution: SCB_ATTRIBUTION } });
      return { ok: true };
    }
    const code = await resolveMunicipalityCode(t.municipality, ctx.adapter);
    if (!code.ok) return { ok: false, result: fail(code), abort: abortOn(code.error) };
    if (!code.data) {
      await upsertPropertyContext(ctx.db, { ...base, status: 'no_coverage', sourceTimestamp: null, payload: { note: `Kommunen "${t.municipality}" kunde inte kopplas till en SCB-regionkod.`, attribution: SCB_ATTRIBUTION } });
      return { ok: true };
    }
    const s = await fetchMunicipalityStats(code.data.code, ctx.adapter);
    if (!s.ok) return { ok: false, result: fail(s), abort: abortOn(s.error) };
    await upsertPropertyContext(ctx.db, {
      ...base, status: 'ok', sourceTimestamp: s.data.updated,
      payload: { regionCode: code.data.code, regionName: code.data.name, tableId: SCB_TABLE, period: s.data.period, values: s.data.values, attribution: SCB_ATTRIBUTION },
    });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Housekeeping                                                        */
/* ------------------------------------------------------------------ */

async function runRetention(ctx: JobContext): Promise<JobResult> {
  await expireEvents(ctx.db);
  const deleted = await applyRetention(ctx.db);
  const changes = await rematchEvents(ctx.db);
  return { status: 'ok', items: Object.values(deleted).reduce((a, b) => a + b, 0), errorDetail: JSON.stringify(deleted), changed: { changes } };
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

/** Order = priority when several jobs are due. Intervals are conservative for the Build pod. */
export function buildJobs(env: ServerEnv): MonitoringJob[] {
  const jobs: MonitoringJob[] = [
    { jobId: 'sms_notifications', sourceId: null, intervalSeconds: 30, enabled: true, timeoutMs: 120000, run: async (ctx) => ({ status: 'ok', items: await new NotificationService(ctx.db,ctx.adapter.env).tick() }) },
    { jobId: 'smhi_county_areas', sourceId: 'smhi_warnings', intervalSeconds: 7 * 86_400, enabled: env.SOURCE_SMHI_WARNINGS_ENABLED || env.SOURCE_KRISINFORMATION_ENABLED, timeoutMs: 120_000, run: runCountyAreas },
    { jobId: 'smhi_warnings', sourceId: 'smhi_warnings', intervalSeconds: 300, enabled: env.SOURCE_SMHI_WARNINGS_ENABLED, timeoutMs: 90_000, run: runSmhiWarnings },
    { jobId: 'krisinformation', sourceId: 'krisinformation', intervalSeconds: 600, enabled: env.SOURCE_KRISINFORMATION_ENABLED, timeoutMs: 90_000, run: runKrisinformation },
    { jobId: 'trafikverket', sourceId: 'trafikverket', intervalSeconds: 300, enabled: Boolean(env.TRAFIKVERKET_ENABLED && env.TRAFIKVERKET_API_KEY), timeoutMs: 120_000, run: runTrafikverket },
    { jobId:'smhi_hydrology',sourceId:'smhi_hydrology',intervalSeconds:900,enabled:env.SOURCE_SMHI_HYDROLOGY_ENABLED,timeoutMs:90000,run:runHydrology },
    { jobId:'hydrology_reference',sourceId:'smhi_hydrology',intervalSeconds:3600,enabled:env.SOURCE_SMHI_HYDROLOGY_ENABLED,timeoutMs:600000,run:runHydrologyReferences },
    { jobId: 'smhi_oceanography', sourceId:'smhi_oceanography', intervalSeconds:600, enabled:env.SOURCE_SMHI_OCEANOGRAPHY_ENABLED, timeoutMs:90000, run:runOceanography },
    { jobId: 'met_nowcast', sourceId: 'met_nowcast', intervalSeconds: 300, enabled: env.SOURCE_MET_NOWCAST_ENABLED, timeoutMs: 180_000, run: runNowcast },
    { jobId: 'smhi_forecast', sourceId: 'smhi_forecast', intervalSeconds: 900, enabled: env.SOURCE_SMHI_FORECAST_ENABLED, timeoutMs: 180_000, run: runForecasts },
    { jobId: 'smhi_observations', sourceId: 'smhi_observations', intervalSeconds: 900, enabled: env.SOURCE_SMHI_OBSERVATIONS_ENABLED, timeoutMs: 180_000, run: runMetObs },
    // After the latest-hour collection so newly listed stations exist; also triggered when a property is added.
    { jobId: 'observation_backfill', sourceId: 'smhi_observations', intervalSeconds: 3_600, enabled: env.SOURCE_SMHI_OBSERVATIONS_ENABLED, timeoutMs: 180_000, run: runObservationBackfill },
    { jobId: 'sl_deviations', sourceId: 'sl_deviations', intervalSeconds: 300, enabled: env.SOURCE_SL_DEVIATIONS_ENABLED && !!env.SL_DEVIATIONS_API_KEY, timeoutMs: 120_000, run: runSl },
    { jobId: 'sgu_observed_groundwater', sourceId: 'sgu_observed_groundwater', intervalSeconds: 900, enabled: env.SOURCE_SGU_OBSERVED_ENABLED, timeoutMs: 600_000, run: runObservedGroundwater },
    { jobId: 'sgu_groundwater', sourceId: 'sgu_groundwater', intervalSeconds: 3_600, enabled: env.SOURCE_SGU_ENABLED, timeoutMs: 180_000, run: runSgu },
    { jobId: 'mcf_flood', sourceId: 'mcf_flood', intervalSeconds: 3_600, enabled: env.MCF_FLOOD_ENABLED, timeoutMs: 300_000, run: runMcf },
    { jobId: 'scb', sourceId: 'scb', intervalSeconds: 3_600, enabled: env.SOURCE_SCB_ENABLED, timeoutMs: 120_000, run: runScb },
    { jobId: 'air_quality', sourceId: 'air_quality', intervalSeconds: 3_600, enabled: env.SOURCE_AIR_QUALITY_ENABLED, timeoutMs: 600_000, run: runAirQuality },
    {
      jobId: 'history_backfill',
      sourceId: null,
      intervalSeconds: HISTORY.collectionIntervalSeconds,
      enabled: env.SOURCE_SMHI_OBSERVATIONS_ENABLED || env.SOURCE_SMHI_HYDROLOGY_ENABLED || env.SOURCE_SMHI_OCEANOGRAPHY_ENABLED,
      timeoutMs: 600_000,
      run: runHistoryBackfill,
    },
    {
      jobId: 'history_aggregate',
      sourceId: null,
      intervalSeconds: HISTORY.collectionIntervalSeconds,
      enabled: true,
      timeoutMs: 120_000,
      run: runHistoryAggregation,
    },
    { jobId: 'retention', sourceId: null, intervalSeconds: 86_400, enabled: true, timeoutMs: 120_000, run: runRetention },
  ];
  return jobs;
}

/** Jobs that compute per-property data and must run soon after a property is created/moved. */
export const PER_PROPERTY_JOBS = ['met_nowcast', 'smhi_forecast', 'observation_backfill', 'history_backfill', 'sgu_groundwater', 'sgu_observed_groundwater', 'mcf_flood', 'scb'];

/** Backoff after failures: interval × 2^(n−1), min 60 s, max 6 h; Retry-After wins when longer. */
export function nextRunSeconds(intervalSeconds: number, consecutiveFailures: number, result: JobResult): number {
  if (result.status === 'ok' || result.status === 'partial') return result.moreWork ? 30 : intervalSeconds;
  if (result.status === 'skipped') return intervalSeconds;
  const backoff = Math.min(6 * 3_600, Math.max(60, Math.min(intervalSeconds, 900) * 2 ** Math.max(0, consecutiveFailures)));
  return Math.max(backoff, result.retryAfterSeconds ?? 0);
}

export { countCountyAreas };

/** Leased singleton job; batches of at most four, spaced by one second, no HTTP retries. */
export async function runNowcast(ctx: JobContext): Promise<JobResult> {
  if (!ctx.adapter.env.MET_NORWAY_CONTACT) return { status:'skipped', items:0, errorCode:'access_required', errorDetail:'MET_NORWAY_CONTACT saknas – ange publik kontaktwebbadress' };
  const targets=await listMonitoringTargets(ctx.db), cache=new Map((await loadNowcastCache(ctx.db)).map(x=>[x.point_key,x]));
  const keys=[...new Set(targets.map(t=>t.lat.toFixed(2)+','+t.lon.toFixed(2)))];
  const due=keys.filter(k=>!cache.has(k)||cache.get(k)!.expires_at<=ctx.adapter.now());
  let items=0, failure: JobResult | null=null;
  for(let i=0;i<due.length;i+=4) {
    if(i) await sleep(1000,ctx.adapter.signal);
    const results=await Promise.all(due.slice(i,i+4).map(async key=>{
      const [lat,lon]=key.split(',').map(Number), old=cache.get(key);
      const r=await fetchMetNowcast(lat!,lon!,ctx.adapter,old?.last_modified);
      if(!r.ok)return fail(r);
      if(r.data.notModified) {
        if(!old)return {status:'error' as const,items:0,errorCode:'invalid_payload'};
        await revalidateNowcastPoint(ctx.db,key,r.fetchedAt,r.data.expiresAt,r.data.lastModified);
      } else if(r.data.data) await saveNowcastPoint(ctx.db,key,lat!,lon!,r.data.data,r.fetchedAt,r.data.expiresAt,r.data.lastModified);
      return {status:'ok' as const,items:1};
    }));
    for(const r of results) {items+=r.items;if(r.status==='error')failure=r;}
    if(results.some(r=>'errorCode' in r && (r.errorCode==='rate_limited'||r.errorCode==='unauthorized')))break;
  }
  return failure ? {...failure,status:items?'partial':'error',items} : {status:'ok',items,changed:{all:true}};
}

export async function runOceanography(ctx:JobContext):Promise<JobResult> {
  const r=await fetchOceanography(ctx.adapter); if(!r.ok)return fail(r);
  const byStation=new Map<string,typeof r.data>();
  for(const o of r.data) byStation.set(o.stationId,[...(byStation.get(o.stationId)??[]),o]);
  const latest=[...byStation.values()].map(series=>({...series.at(-1)!,extra:{...series.at(-1)!.extra,points:series.map(x=>({observedAt:x.observedAt,value:x.value}))}}));
  await insertObservationHistory(ctx.db,'smhi_oceanography',r.data);
  const items=await upsertStationObservations(ctx.db,'smhi_oceanography',latest);
  return {status:'ok',items,changed:{all:true}};
}

export async function runHydrology(ctx:JobContext):Promise<JobResult> {
  const r=await fetchHydrology(ctx.adapter);if(!r.ok)return fail(r);
  const byStation=new Map<string,typeof r.data>();
  for(const o of r.data)byStation.set(o.stationId,[...(byStation.get(o.stationId)??[]),o]);
  const latest=[...byStation.values()].map(points=>({...points.at(-1)!,extra:{points:points.map(x=>({observedAt:x.observedAt,value:x.value}))}}));
  await insertObservationHistory(ctx.db,'smhi_hydrology',r.data);
  const items=await upsertStationObservations(ctx.db,'smhi_hydrology',latest);
  return {status:'ok',items,changed:{all:true}};
}
export async function runHydrologyReferences(ctx:JobContext):Promise<JobResult> {
  const ids=await stationsNeedingFlowReference(ctx.db,WEATHER_WATER.flowDistanceM,WEATHER_WATER.referenceRefreshDays,2);
  let items=0,failed=false;
  for(const id of ids) {
    const r=await fetchHydrologyReference(id,ctx.adapter);
    await saveFlowReferences(ctx.db,id,r.ok?r.data:[],r.ok);
    if(r.ok)items+=r.data.filter(x=>x.reference).length;else failed=true;
  }
  return {status:failed?(items?'partial':'error'):'ok',items,moreWork:ids.length===2,changed:{all:true}};
}

/**
 * Fills history gaps for the nearest 15-min rain station of each active property (ADR 0004), so a
 * property added in a new area – or a station after collector downtime – shows 24 h / 72 h totals
 * at once instead of after three days. One SMHI request per station (latest-months ≈ 4 months; only
 * values inside the history retention are stored), at most a few stations per run, each station
 * retried at most every few hours. Never runs on page views.
 */
export async function runObservationBackfill(ctx: JobContext): Promise<JobResult> {
  const parameter = METOBS_PARAMETERS.find((p) => p.key === 'precipitation_15min')!;
  const limit = WEATHER_WATER.backfillStationsPerRun;
  const stations = await stationsNeedingBackfill(ctx.db, {
    sourceId: 'smhi_observations', parameter: parameter.key, distanceM: WEATHER_WATER.observationDistanceM,
    maxAgeHours: WEATHER_WATER.backfillStationMaxAgeHours, hours: WEATHER_WATER.backfillHours,
    minCoverage: WEATHER_WATER.backfillCoverage, retryHours: WEATHER_WATER.backfillRetryHours, limit,
  });
  if (!stations.length) return { status: 'ok', items: 0, errorDetail: 'no gaps' };
  let items = 0;
  let failure: JobResult | null = null;
  for (const s of stations) {
    const r = await fetchMetObsStationSeries(s, parameter, 'latest-months', ctx.adapter);
    if (r.ok) items += await insertObservationHistory(ctx.db, 'smhi_observations', r.data);
    // Recorded either way: a station SMHI cannot complete is not re-downloaded every run.
    await markBackfillChecked(ctx.db, 'smhi_observations', s.stationId, parameter.key, r.ok);
    if (!r.ok) {
      failure = fail(r);
      if (r.error === 'rate_limited') break;
    }
  }
  const detail = `${stations.length} station(s), ${items} value(s) added`;
  if (failure) return { ...failure, status: items ? 'partial' : 'error', items, errorDetail: `${detail}; ${failure.errorDetail ?? ''}`, changed: items ? { all: true } : undefined };
  return { status: 'ok', items, errorDetail: detail, moreWork: stations.length === limit, changed: items ? { all: true } : undefined };
}

function latestStationReadings<T extends {stationId:string;parameter:string;observedAt:string|null}>(series:T[]):T[] {
  const map=new Map<string,T>();
  for(const o of series){const key=o.stationId+':'+o.parameter,old=map.get(key);if(!old||(o.observedAt??'')>(old.observedAt??''))map.set(key,o);}
  return [...map.values()];
}
