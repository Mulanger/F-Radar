import { WEATHER_WATER } from '@fastighetsradar/domain';
import type { ServerEnv } from '@fastighetsradar/config';
import type { DataSourceStatus, Freshness, SourceId } from '@fastighetsradar/domain';
import type { JobRow } from '@fastighetsradar/db';
import { SOURCE_MANIFEST, resolveSourceStatuses } from '@fastighetsradar/integrations';

/**
 * Runtime source status = configuration status (env + manifest) merged with collector job health.
 *
 *  ok        – last successful run within the freshness window, last run not failing
 *  degraded  – configured but never succeeded yet, or the latest run failed while data is still fresh
 *  stale     – last success older than the freshness window (data shown with a stale label)
 *  source_unavailable – never succeeded and the latest run failed
 */
export const FRESHNESS_WINDOW_S: Partial<Record<SourceId, number>> = {
  smhi_hydrology: WEATHER_WATER.flowSourceFreshSeconds,
  smhi_oceanography: WEATHER_WATER.seaSourceFreshSeconds,
  met_nowcast: WEATHER_WATER.nowcastFreshMinutes * 60,
  smhi_warnings: 20 * 60,
  krisinformation: 40 * 60,
  trafikverket: 20 * 60,
  smhi_forecast: 2.5 * 3_600,
  smhi_observations: 2 * 3_600,
  sgu_observed_groundwater: 36 * 3_600,
  sl_deviations: 20 * 60,
  air_quality: 4 * 3_600,
  sgu_groundwater: 36 * 3_600,
  mcf_flood: 8 * 86_400,
  scb: 8 * 86_400,
};

const DATA_CLASS: Partial<Record<SourceId, string>> = {
  smhi_hydrology: 'OBSERVATION',
  smhi_oceanography: 'OBSERVATION',
  met_nowcast: 'FORECAST',
  smhi_forecast: 'FORECAST',
  smhi_warnings: 'OFFICIAL_WARNING',
  krisinformation: 'OFFICIAL_WARNING / PUBLIC_EVENT',
  trafikverket: 'PUBLIC_EVENT',
  smhi_observations: 'OBSERVATION',
  air_quality: 'OBSERVATION',
  sgu_groundwater: 'MODEL',
  sgu_observed_groundwater: 'OBSERVATION',
  sl_deviations: 'PUBLIC_EVENT',
  mcf_flood: 'STATIC_GEODATA',
  scb: 'REGIONAL_STATISTIC',
};

const ERROR_TEXT: Record<string, string> = {
  timeout: 'Tidsgräns överskreds',
  rate_limited: 'Begränsning hos leverantören (429)',
  unauthorized: 'Åtkomst nekad av leverantören',
  upstream_error: 'Fel hos leverantören',
  invalid_payload: 'Oväntat svar från leverantören',
  access_required: 'Nyckel saknas eller källan är avstängd',
  internal_error: 'Internt fel vid insamling',
};

export function freshnessOf(lastSuccess: Date | null, windowS: number | undefined, now: Date): Freshness {
  if (!lastSuccess || !windowS) return 'unknown';
  const age = (now.getTime() - lastSuccess.getTime()) / 1000;
  return age <= windowS ? 'fresh' : age <= windowS * 4 ? 'stale' : 'expired';
}

export function resolveRuntimeStatuses(env: ServerEnv, jobs: JobRow[], now = new Date()): DataSourceStatus[] {
  const byJob = new Map(jobs.map((j) => [j.job_id, j]));
  return resolveSourceStatuses(env).map((cfg) => {
    const job = byJob.get(cfg.sourceId);
    const windowS = FRESHNESS_WINDOW_S[cfg.sourceId];
    const base: DataSourceStatus = {
      ...cfg,
      dataClass: DATA_CLASS[cfg.sourceId],
      expectedIntervalSeconds: job?.interval_seconds ?? null,
      nextRunAt: job?.next_run_at?.toISOString() ?? null,
      attribution: SOURCE_MANIFEST[cfg.sourceId as keyof typeof SOURCE_MANIFEST]?.attributionText,
    };
    // Not configured / not implemented / disabled: configuration status wins.
    if (cfg.status !== 'degraded' || !job || !job.enabled) return base;
    const freshness = freshnessOf(job.last_success_at, windowS, now);
    const lastErrorAt = job.last_status === 'error' ? (job.last_finished_at?.toISOString() ?? null) : null;
    const common = {
      ...base,
      lastSuccessAt: job.last_success_at?.toISOString() ?? null,
      lastCheckedAt: job.last_finished_at?.toISOString() ?? null,
      freshness,
      errorCode: job.last_status === 'error' ? job.last_error_code : null,
      lastErrorAt,
    };
    if (!job.last_success_at) {
      return job.last_status === 'error'
        ? { ...common, status: 'source_unavailable', note: `Ingen lyckad hämtning ännu – ${ERROR_TEXT[job.last_error_code ?? ''] ?? 'fel'}` }
        : { ...common, status: 'degraded', note: 'Väntar på första lyckade hämtning' };
    }
    if (freshness !== 'fresh') return { ...common, status: 'stale', note: `Inaktuell – senast lyckad hämtning för länge sedan${job.last_error_code ? ` (${ERROR_TEXT[job.last_error_code] ?? job.last_error_code})` : ''}` };
    if (job.last_status === 'error') return { ...common, status: 'degraded', note: `Senaste hämtningen misslyckades (${ERROR_TEXT[job.last_error_code ?? ''] ?? 'fel'}); visar senast hämtade data` };
    return { ...common, status: 'ok', note: job.last_status === 'partial' ? 'Delvis hämtad (vissa poster hoppades över)' : null };
  });
}
