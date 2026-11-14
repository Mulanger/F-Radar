import type { ServerEnv } from '@fastighetsradar/config';
import {
  isPositionConfirmed,
  outageEffectiveSeverity,
  outageHeadline,
  outageMatchLevel,
  outagePrecisionLabel,
  type PropertySnapshot,
  type PropertyStatus,
  type PropertyUtilityStatus,
  type UtilityOutageView,
} from '@fastighetsradar/domain';
import {
  replaceConcessionAreas,
  replaceNationalConcessions,
  rematchUtilityOutages,
  storeUtilityOutages,
  type JobRow,
  type OrgUtilityOutageRow,
  type PropertyConcessionRow,
} from '@fastighetsradar/db';
import {
  enabledOperators,
  fetchEiConcessions,
  fetchOperatorConcessions,
  fetchOperatorOutages,
  operatorIdForEiName,
  UTILITY_OPERATORS,
  type UtilityOperator,
} from '@fastighetsradar/integrations';
import type { JobContext, JobResult, MonitoringJob } from './jobs';

/**
 * Grid operators' outage maps (docs/plans/stromavbrott.md): one collector job per operator,
 * per-operator health, and the per-property outage section of the snapshot.
 */

export const UTILITY_JOB_PREFIX = 'utility_outages:';
export const CONCESSION_JOB_PREFIX = 'utility_concessions:';
/** An operator's data counts as current for this long after its last successful run. */
export const OPERATOR_FRESHNESS_S = 20 * 60;

const attribution = (op: UtilityOperator) => `Källa: ${op.name} – avbrottskarta`;

async function runOperator(op: UtilityOperator, ctx: JobContext): Promise<JobResult> {
  const r = await fetchOperatorOutages(op, ctx.adapter);
  if (!r.ok) return { status: 'error', items: 0, errorCode: r.error, errorDetail: r.detail, retryAfterSeconds: r.retryAfterSeconds };
  const d = r.data;
  if (d.unknownStatusCodes?.length) ctx.adapter.logger.warn({ operator: op.id, codes: d.unknownStatusCodes }, 'utility outages: unknown upstream status codes');
  const stored = await storeUtilityOutages(
    ctx.db,
    op.id,
    d.outages.map((o) => ({ ...o, operatorName: op.name, attribution: attribution(op) })),
    d.skipped === 0,
  );
  const changes = await rematchUtilityOutages(ctx.db);
  return {
    status: d.skipped > 0 ? 'partial' : 'ok',
    items: d.outages.length,
    errorDetail: `inserted ${stored.inserted}, updated ${stored.updated}, restored ${stored.restored}, ended missing ${stored.endedMissing}, skipped ${d.skipped}, ignored ${d.ignored}`,
    sourceUpdatedAt: d.sourceUpdatedAt ?? r.fetchedAt,
    changed: { changes },
  };
}

async function runConcessions(op: UtilityOperator, ctx: JobContext): Promise<JobResult> {
  const r = await fetchOperatorConcessions(op, ctx.adapter);
  if (!r.ok) return { status: 'error', items: 0, errorCode: r.error, errorDetail: r.detail };
  const n = await replaceConcessionAreas(ctx.db, op.id, 'electricity', 'operator_feed', r.data);
  return { status: 'ok', items: n, sourceUpdatedAt: r.fetchedAt };
}

/** National concession areas from Energimarknadsinspektionen: tells which operator serves each property. */
async function runEiConcessions(ctx: JobContext): Promise<JobResult> {
  const r = await fetchEiConcessions(ctx.adapter);
  if (!r.ok) return { status: 'error', items: 0, errorCode: r.error, errorDetail: r.detail };
  const n = await replaceNationalConcessions(
    ctx.db,
    r.data.map((a) => ({ operatorId: operatorIdForEiName(a.holder), operatorName: a.holder, externalRef: a.concessionId, rings: a.rings })),
  );
  return { status: 'ok', items: n, errorDetail: `${r.data.length} areas parsed, ${n} stored`, sourceUpdatedAt: r.fetchedAt };
}

/** One job per operator (all listed so disabling an operator also disables its stored job row). */
export function buildUtilityOutageJobs(env: ServerEnv): MonitoringJob[] {
  const on = env.SOURCE_UTILITY_OUTAGES_ENABLED;
  const enabled = new Set(enabledOperators(env.UTILITY_OUTAGE_OPERATORS).map((o) => o.id));
  const jobs: MonitoringJob[] = [];
  for (const op of UTILITY_OPERATORS) {
    const active = on && enabled.has(op.id);
    jobs.push({ jobId: `${UTILITY_JOB_PREFIX}${op.id}`, sourceId: 'utility_outages', intervalSeconds: env.UTILITY_OUTAGE_POLL_SECONDS, enabled: active, timeoutMs: 90_000, run: (ctx) => runOperator(op, ctx) });
    if (op.platform === 'digpro' && op.concessionUrl) {
      jobs.push({ jobId: `${CONCESSION_JOB_PREFIX}${op.id}`, sourceId: 'utility_outages', intervalSeconds: 7 * 86_400, enabled: active, timeoutMs: 120_000, run: (ctx) => runConcessions(op, ctx) });
    }
  }
  jobs.push({ jobId: `${CONCESSION_JOB_PREFIX}ei`, sourceId: 'utility_outages', intervalSeconds: 7 * 86_400, enabled: on, timeoutMs: 300_000, run: runEiConcessions });
  return jobs;
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

export interface OperatorStatus {
  operatorId: string;
  name: string;
  mapUrl: string;
  enabled: boolean;
  /** fresh = last success within OPERATOR_FRESHNESS_S. */
  current: boolean;
  lastSuccessAt: string | null;
  lastStatus: string | null;
  errorCode: string | null;
}

export function resolveOperatorStatuses(env: ServerEnv, jobs: JobRow[], now: Date): OperatorStatus[] {
  const byJob = new Map(jobs.map((j) => [j.job_id, j]));
  const enabled = new Set(env.SOURCE_UTILITY_OUTAGES_ENABLED ? enabledOperators(env.UTILITY_OUTAGE_OPERATORS).map((o) => o.id) : []);
  return UTILITY_OPERATORS.map((op) => {
    const j = byJob.get(`${UTILITY_JOB_PREFIX}${op.id}`);
    const last = j?.last_success_at ?? null;
    return {
      operatorId: op.id,
      name: op.name,
      mapUrl: op.mapUrl,
      enabled: enabled.has(op.id) && !!j?.enabled,
      current: !!last && (now.getTime() - last.getTime()) / 1000 <= OPERATOR_FRESHNESS_S && j?.last_status !== 'error',
      lastSuccessAt: last?.toISOString() ?? null,
      lastStatus: j?.last_status ?? null,
      errorCode: j?.last_status === 'error' ? (j.last_error_code ?? null) : null,
    };
  });
}

/**
 * Source-level health for 'utility_outages' summarises the enabled operator jobs: the OLDEST last
 * success (so one stale operator makes the source stale) and 'error' when any operator's last run failed.
 */
export function aggregateUtilityJob(jobs: JobRow[]): JobRow | null {
  const ops = jobs.filter((j) => j.job_id.startsWith(UTILITY_JOB_PREFIX) && j.enabled);
  if (!ops.length) return null;
  const successes = ops.map((j) => j.last_success_at);
  const oldest = successes.some((s) => !s) ? null : successes.reduce((a, b) => (a!.getTime() < b!.getTime() ? a : b), successes[0]!);
  const failing = ops.find((j) => j.last_status === 'error');
  return {
    ...ops[0]!,
    job_id: 'utility_outages',
    last_success_at: oldest,
    last_status: failing ? 'error' : ops.some((j) => j.last_status === 'partial') ? 'partial' : (ops[0]!.last_status ?? null),
    last_error_code: failing?.last_error_code ?? null,
    interval_seconds: Math.min(...ops.map((j) => j.interval_seconds)),
  };
}

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const STATUS_RANK: Record<PropertyStatus, number> = { unknown: 0, normal: 1, monitor: 2, warning: 3, critical: 4 };
const SEVERITY_STATUS: Record<string, PropertyStatus | undefined> = { critical: 'critical', warning: 'warning', monitor: 'monitor' };

function toView(r: OrgUtilityOutageRow): UtilityOutageView {
  const confirmed = isPositionConfirmed(r.geocode_precision, r.position_source);
  const level = outageMatchLevel(r.match_method, confirmed, r.affected_customers);
  const operatorName = r.operator_name ?? r.operator_id;
  return {
    id: r.event_id,
    operatorId: r.operator_id,
    operatorName,
    utility: r.utility,
    kind: r.kind,
    state: r.state,
    matchMethod: r.match_method,
    precisionLevel: level,
    precisionLabel: outagePrecisionLabel(r.match_method, confirmed, r.place_label),
    severity: outageEffectiveSeverity({ kind: r.kind, state: r.state }, level),
    distanceMeters: r.distance_m === null ? null : Number(r.distance_m),
    affectedCustomers: r.affected_customers,
    areaCustomerTotal: r.area_customer_total,
    reportedAt: iso(r.reported_at),
    plannedStart: iso(r.planned_start),
    plannedEnd: iso(r.planned_end),
    actualStart: iso(r.actual_start),
    estimatedRestore: iso(r.estimated_restore),
    restoredAt: iso(r.restored_at) ?? (r.state === 'restored' ? iso(r.ended_at) : null),
    operatorText: r.operator_text,
    cause: r.cause,
    placeLabel: r.place_label,
    sourceUrl: r.source_url,
    geometry: r.geometry ?? null,
  };
}

export interface UtilityInputs {
  outages: OrgUtilityOutageRow[];
  concessions: Array<Pick<PropertyConcessionRow, 'property_id' | 'operator_id'> & { operator_name?: string | null }>;
  operators: OperatorStatus[];
}

/** Builds the electricity section for one property (Fas 1: electricity only). */
export function propertyUtilityStatus(propertyId: string, inputs: UtilityInputs): PropertyUtilityStatus {
  const views = inputs.outages.filter((o) => o.property_id === propertyId && o.utility === 'electricity').map(toView);
  // Concession areas (Ei national dataset + operator feeds; boundaries approximate). One operator id may
  // appear from several sources; distinct operators mean the property lies near a boundary.
  const rows = inputs.concessions.filter((c) => c.property_id === propertyId);
  const ids = [...new Set(rows.map((c) => c.operator_id))];
  const nameOf = (id: string) => inputs.operators.find((o) => o.operatorId === id)?.name ?? rows.find((r) => r.operator_id === id && r.operator_name)?.operator_name ?? id.replace(/^ei:/, '');
  let operator: PropertyUtilityStatus['operator'] = null;
  let coverage: PropertyUtilityStatus['coverage'] = 'unknown';
  let updatedAt: string | null = null;
  if (ids.length === 1) {
    const st = inputs.operators.find((o) => o.operatorId === ids[0]);
    operator = { id: ids[0]!, name: nameOf(ids[0]!), mapUrl: st?.mapUrl ?? null };
    coverage = !st || !st.enabled ? 'not_monitored' : st.current ? 'monitored' : 'stale';
    updatedAt = st?.lastSuccessAt ?? null;
  }
  // Low precision (near/point matches and small area-level outages) is shown under "I närheten" only.
  const panelOnly = (v: UtilityOutageView) => v.precisionLevel === 'low';
  const byStart = (a: UtilityOutageView, b: UtilityOutageView) => Date.parse(a.plannedStart ?? a.actualStart ?? '') - Date.parse(b.plannedStart ?? b.actualStart ?? '');
  return {
    utility: 'electricity',
    operator,
    coverage,
    ...(ids.length > 1 ? { operatorCandidates: ids.map(nameOf) } : {}),
    updatedAt,
    current: views.filter((v) => !panelOnly(v) && (v.state === 'ongoing' || v.state === 'unknown')).sort(byStart),
    upcoming: views.filter((v) => !panelOnly(v) && v.state === 'upcoming').sort(byStart),
    recentlyRestored: views.filter((v) => !panelOnly(v) && (v.state === 'restored' || v.state === 'withdrawn')),
    nearby: views.filter((v) => panelOnly(v) && v.state !== 'restored' && v.state !== 'withdrawn'),
  };
}

/**
 * Adds the outage section to a snapshot and raises the property status when a matched outage is
 * more severe than the official-warning status (docs/plans/stromavbrott.md §5.3). Outage-source
 * health never makes the status 'unknown'.
 */
export function withUtilityOutages(s: PropertySnapshot, inputs: UtilityInputs): PropertySnapshot {
  const u = propertyUtilityStatus(s.property.id, inputs);
  let status = s.property.status;
  let reason = s.property.statusReason ?? null;
  let raised = false;
  for (const v of [...u.current, ...u.upcoming]) {
    const st = v.severity ? SEVERITY_STATUS[v.severity] : undefined;
    // Upcoming planned work is announced in the feed but does not change today's status.
    if (!st || v.state === 'upcoming') continue;
    if (STATUS_RANK[st] > STATUS_RANK[status]) {
      status = st;
      raised = true;
      reason = v.kind === 'unplanned' && v.precisionLevel === 'high'
        ? `Oplanerat strömavbrott registrerat av ${v.operatorName}`
        : outageHeadline({ utility: v.utility, kind: v.kind, state: v.state, plannedStart: v.plannedStart, plannedEnd: v.plannedEnd }, v.operatorName);
    }
  }
  const counted = u.current.filter((v) => v.severity === 'critical' || v.severity === 'warning').length;
  return {
    ...s,
    property: raised ? { ...s.property, status, statusReason: reason } : s.property,
    activeAlertCount: s.activeAlertCount + counted,
    utilityOutages: [u],
    ...(s.monitoring ? { monitoring: { ...s.monitoring, statusMethod: 'highest_official_warning_or_outage' as const } } : {}),
  };
}
