import type { ServerEnv } from '@fastighetsradar/config';
import {
  isPositionConfirmed,
  isCustomerOutageMatch,
  outageEffectiveSeverity,
  PLATFORMS_REPORTING_RESTORED,
  outageHeadline,
  outageMatchLevel,
  outagePrecisionLabel,
  OFFERED_UTILITIES,
  isOfferedUtility,
  utilityNoun,
  withPowerFactor,
  type UtilityKind,
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
  hasFewSkippedOutages,
  operatorIdForEiName,
  UTILITY_OPERATORS,
  type UtilityOperator,
} from '@fastighetsradar/integrations';
import type { JobContext, JobResult, MonitoringJob } from './jobs';
import { municipalWaterProvider } from './water-operators';

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
  if (!r.ok) {
    // A feed that stops parsing usually means the operator changed its map – needs an adapter fix.
    if (r.error === 'invalid_payload') ctx.adapter.logger.error({ operator: op.id, alert: 'utility_outage_format_changed', detail: r.detail }, 'utility outages: unexpected feed format');
    return { status: 'error', items: 0, errorCode: r.error, errorDetail: r.detail, retryAfterSeconds: r.retryAfterSeconds };
  }
  const d = r.data;
  const partial = d.skipped > 0 || d.incomplete;
  if (d.unknownStatusCodes?.length) ctx.adapter.logger.warn({ operator: op.id, codes: d.unknownStatusCodes }, 'utility outages: unknown upstream status codes');
  const stored = await storeUtilityOutages(
    ctx.db,
    op.id,
    d.outages.map((o) => ({ ...o, operatorName: op.name, attribution: attribution(op) })),
    !partial,
    new Date(),
    { reportsRestored: op.reportsRestored ?? PLATFORMS_REPORTING_RESTORED.includes(op.platform), utilities: op.utilities },
  );
  const changes = await rematchUtilityOutages(ctx.db);
  return {
    status: partial ? 'partial' : 'ok',
    errorCode: d.incomplete ? 'incomplete_feed' : partial ? 'skipped_records' : undefined,
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
  const enabled = new Map(enabledOperators(env.UTILITY_OUTAGE_OPERATORS, UTILITY_OPERATORS, env).map((o) => [o.id, o]));
  const jobs: MonitoringJob[] = [];
  for (const op of UTILITY_OPERATORS) {
    const active = on && enabled.has(op.id);
    jobs.push({ jobId: `${UTILITY_JOB_PREFIX}${op.id}`, sourceId: 'utility_outages', intervalSeconds: op.pollSeconds ?? env.UTILITY_OUTAGE_POLL_SECONDS, enabled: active, timeoutMs: 90_000, run: (ctx) => runOperator(enabled.get(op.id) ?? op, ctx) });
    if (op.platform === 'digpro' && op.concessionUrl) {
      jobs.push({ jobId: `${CONCESSION_JOB_PREFIX}${op.id}`, sourceId: 'utility_outages', intervalSeconds: 7 * 86_400, enabled: active && (enabled.get(op.id)?.utilities.includes('electricity') ?? false), timeoutMs: 120_000, run: (ctx) => runConcessions(op, ctx) });
    }
  }
  jobs.push({ jobId: `${CONCESSION_JOB_PREFIX}ei`, sourceId: 'utility_outages', intervalSeconds: 7 * 86_400, enabled: on && isOfferedUtility('electricity'), timeoutMs: 300_000, run: runEiConcessions });
  return jobs;
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

export interface OperatorStatus {
  utilities?: UtilityKind[];
  enabledUtilities?: UtilityKind[];
  operatorId: string;
  name: string;
  mapUrl: string;
  enabled: boolean;
  /** The latest run was usable and is within OPERATOR_FRESHNESS_S. */
  current: boolean;
  lastSuccessAt: string | null;
  lastStatus: string | null;
  errorCode: string | null;
  /**
   * Needs attention (Fas 5 feed-health signal): 'format_changed' after ATTENTION_FAILURES consecutive
   * invalid payloads (adapter must be updated), 'unreachable' after twice as many other failures.
   */
  attention: 'format_changed' | 'unreachable' | null;
}

export const ATTENTION_FAILURES = 3;

function isUsableUtilityRun(j: JobRow): boolean {
  if (j.last_status === 'ok') return true;
  if (j.last_status !== 'partial' || j.last_items === null) return false;
  // Older rows only have counters. Accept them for feeds with mandatory requests that already
  // failed the whole run, and a single utility so skipped records cannot hide a missing layer.
  const legacyRow = !j.last_error_code && /^utility_outages:(ellevio|svoa|vattenfall)$/.test(j.job_id);
  if (j.last_error_code !== 'skipped_records' && !legacyRow) return false;
  // Ignored records were read fine (another type, a watering ban): they count as read, as in the fetch.
  // Stockholm Vatten och Avfall: 4 outages + 18 ignored read, 1 skipped – a working feed.
  const counts = /, skipped (\d+), ignored (\d+)$/.exec(j.last_error_detail ?? '');
  return counts !== null && hasFewSkippedOutages(j.last_items + Number(counts[2]), Number(counts[1]));
}

function isCurrentUtilityRun(j: JobRow, now: Date): boolean {
  if (!j.last_success_at || !isUsableUtilityRun(j)) return false;
  const age = now.getTime() - j.last_success_at.getTime();
  return age >= 0 && age <= OPERATOR_FRESHNESS_S * 1000;
}

export function resolveOperatorStatuses(env: ServerEnv, jobs: JobRow[], now: Date): OperatorStatus[] {
  const byJob = new Map(jobs.map((j) => [j.job_id, j]));
  const configured = new Map(enabledOperators(env.UTILITY_OUTAGE_OPERATORS, UTILITY_OPERATORS, env).map((o) => [o.id, o.utilities]));
  return UTILITY_OPERATORS.filter((op) => op.utilities.some(isOfferedUtility)).map((op) => {
    const j = byJob.get(`${UTILITY_JOB_PREFIX}${op.id}`);
    const last = j?.last_success_at ?? null;
    const enabledUtilities = configured.get(op.id) ?? [];
    const enabled = env.SOURCE_UTILITY_OUTAGES_ENABLED && enabledUtilities.length > 0 && !!j?.enabled;
    return {
      utilities: op.utilities.filter(isOfferedUtility),
      enabledUtilities,
      operatorId: op.id,
      name: op.name,
      mapUrl: op.mapUrl,
      enabled,
      current: enabled && !!j && isCurrentUtilityRun(j, now),
      lastSuccessAt: last?.toISOString() ?? null,
      lastStatus: j?.last_status ?? null,
      errorCode: j?.last_status === 'error' ? (j.last_error_code ?? null) : null,
      attention:
        j?.last_status === 'partial' ? 'format_changed' : j?.last_status !== 'error'
          ? null
          : j.last_error_code === 'invalid_payload' && j.consecutive_failures >= ATTENTION_FAILURES
            ? 'format_changed'
            : j.consecutive_failures >= ATTENTION_FAILURES * 2
              ? 'unreachable'
              : null,
    };
  });
}

/**
 * Source-level health of the outage collector as a whole. One operator failing (e.g. a grid company
 * that blocks the server's network) must not mark the source "ej aktuell" for every customer: that is
 * reported per operator (`attention`) and per property ("kunde inte kontrolleras – <bolag>").
 * The source fails only when NO operator is delivering; freshness follows the newest success.
 */
export function aggregateUtilityJob(jobs: JobRow[], now = new Date()): JobRow | null {
  const ops = jobs.filter((j) => j.job_id.startsWith(UTILITY_JOB_PREFIX) && j.enabled);
  if (!ops.length) return null;
  const current = ops.filter((j) => isCurrentUtilityRun(j, now));
  const usable = ops.filter(isUsableUtilityRun);
  const deliveries = current.length ? current : usable.length ? usable : ops.filter((j) => j.last_status === 'error');
  const successes = deliveries.map((j) => j.last_success_at).filter((d): d is Date => !!d && d.getTime() <= now.getTime());
  const newest = successes.length ? successes.reduce((a, b) => (a.getTime() > b.getTime() ? a : b)) : null;
  const failing = ops.find((j) => j.last_status === 'error' || j.last_status === 'partial' && !isUsableUtilityRun(j));
  const ran = ops.some((j) => j.last_status);
  return {
    ...ops[0]!,
    job_id: 'utility_outages',
    last_success_at: newest,
    last_status: !ran ? null : current.length || !failing && usable.length ? 'ok' : 'error',
    last_error_code: current.length ? null : failing?.last_error_code ?? (failing?.last_status === 'partial' ? 'invalid_payload' : null),
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
  const level = outageMatchLevel(r.match_method, confirmed, r.affected_customers, r.notice_kind);
  const operatorName = r.operator_name ?? r.operator_id;
  return {
    id: r.event_id,
    ...(r.last_seen_at ? { lastSeenAt: r.last_seen_at.toISOString() } : {}),
    operatorId: r.operator_id,
    operatorName,
    utility: r.utility,
    noticeKind: r.notice_kind ?? 'outage',
    kind: r.kind,
    state: r.state,
    matchMethod: r.match_method,
    precisionLevel: level,
    precisionLabel: outagePrecisionLabel(r.match_method, confirmed, r.place_label, r.notice_kind),
    severity: outageEffectiveSeverity({ kind: r.kind, state: r.state, noticeKind: r.notice_kind }, level),
    distanceMeters: r.distance_m === null ? null : Number(r.distance_m),
    affectedCustomers: r.affected_customers,
    areaCustomerTotal: r.area_customer_total,
    reportedAt: iso(r.reported_at),
    plannedStart: iso(r.planned_start),
    plannedEnd: iso(r.planned_end),
    actualStart: iso(r.actual_start),
    estimatedRestore: iso(r.estimated_restore),
    restoredAt: iso(r.restored_at),
    restoredInferred: r.state === 'restored' && Boolean(r.restored_inferred),
    operatorText: r.operator_text,
    cause: r.cause,
    placeLabel: r.place_label,
    sourceUrl: r.source_url,
    geometry: r.geometry ?? null,
  };
}

export interface UtilityInputs {
  municipalities?: Array<{ property_id: string; municipality: string | null }>;
  outages: OrgUtilityOutageRow[];
  concessions: Array<Pick<PropertyConcessionRow, 'property_id' | 'operator_id'> & { operator_name?: string | null; utility?: UtilityKind }>;
  operators: OperatorStatus[];
}

/** Coverage uses published networks; water may use the verified municipal principal, not a connection claim. */
export function propertyUtilityStatus(propertyId: string, inputs: UtilityInputs, utility: UtilityKind = 'electricity'): PropertyUtilityStatus {
  const views = inputs.outages.filter((o) => o.property_id === propertyId && o.utility === utility).map(toView);
  // Concession areas (Ei national dataset + operator feeds; boundaries approximate). One operator id may
  // appear from several sources; distinct operators mean the property lies near a boundary.
  const rows = inputs.concessions.filter((c) => c.property_id === propertyId && (c.utility ?? 'electricity') === utility).map((c) => ({
    ...c,
    // Existing Ei rows can retain their old placeholder until the weekly import. Resolve new adapters
    // by the same exact concession-holder mapping without editing production reference data.
    operator_id: utility === 'electricity' && c.operator_id.startsWith('ei:') ? operatorIdForEiName(c.operator_name ?? c.operator_id.slice(3)) : c.operator_id,
  }));
  const water = !rows.length && utility === 'water'
    ? municipalWaterProvider(inputs.municipalities?.find((p) => p.property_id === propertyId)?.municipality)
    : undefined;
  if (water?.publication === 'connected') rows.push({ property_id: propertyId, operator_id: water.id, operator_name: water.name });
  const ids = [...new Set(rows.map((c) => c.operator_id))];
  const nameOf = (id: string) => water?.id === id ? water.name
    : inputs.operators.find((o) => o.operatorId === id)?.name ?? rows.find((r) => r.operator_id === id && r.operator_name)?.operator_name ?? id.replace(/^ei:/, '');
  let operator: PropertyUtilityStatus['operator'] = null;
  let coverage: PropertyUtilityStatus['coverage'] = 'unknown';
  let updatedAt: string | null = null;
  if (water?.publication === 'no_readable_source') {
    operator = { id: water.id, name: water.name, mapUrl: null };
    coverage = 'no_readable_source';
  } else if (ids.length === 1) {
    const st = inputs.operators.find((o) => o.operatorId === ids[0]);
    operator = { id: ids[0]!, name: nameOf(ids[0]!), mapUrl: st?.mapUrl ?? null };
    coverage = !st || !st.enabled || st.enabledUtilities && !st.enabledUtilities.includes(utility) ? 'not_monitored' : st.current ? 'monitored' : 'stale';
    updatedAt = st?.lastSuccessAt ?? null;
  }
  return {
    utility,
    operator,
    coverage,
    ...(ids.length > 1 ? { operatorCandidates: ids.map(nameOf) } : {}),
    updatedAt,
    ...split(views),
  };
}

function split(views: UtilityOutageView[]) {
  const panelOnly = (v: UtilityOutageView) => v.precisionLevel === 'low';
  const byStart = (a: UtilityOutageView, b: UtilityOutageView) => Date.parse(a.plannedStart ?? a.actualStart ?? '') - Date.parse(b.plannedStart ?? b.actualStart ?? '');
  return {
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
  const sections = OFFERED_UTILITIES.map((utility) => propertyUtilityStatus(s.property.id, inputs, utility))
    .filter((u) => u.utility === 'electricity' || u.coverage !== 'unknown' || u.current.length || u.upcoming.length || u.recentlyRestored.length || u.nearby.length);
  let status = s.property.status;
  let reason = s.property.statusReason ?? null;
  let raised = false;
  const p = s.property;
  const confirmed = isPositionConfirmed(p.geocode.precision, p.positionSource ?? (p.geocode.provider === 'manual_pin' ? 'manual_pin' : undefined));
  const coveredSections = sections.map((u) => ({ ...u, current: u.current.filter((v) => isCustomerOutageMatch(v, confirmed)) }));
  for (const v of coveredSections.flatMap((u) => u.current)) {
    const st = v.severity ? SEVERITY_STATUS[v.severity] : undefined;
    // Upcoming planned work is announced in the feed but does not change today's status.
    if (!st) continue;
    if (STATUS_RANK[st] > STATUS_RANK[status]) {
      status = st;
      raised = true;
      const headline = outageHeadline({ utility: v.utility, noticeKind: v.noticeKind, kind: v.kind, state: v.state, plannedStart: v.plannedStart, plannedEnd: v.plannedEnd }, v.operatorName);
      reason = v.noticeKind !== 'boil_water' && v.kind === 'unplanned'
        ? `Oplanerat ${utilityNoun(v.utility)} registrerat av ${v.operatorName}`
        : headline;
    }
  }
  const counted = coveredSections.flatMap((u) => u.current).filter((v) => v.severity === 'critical' || v.severity === 'warning').length;
  const next: PropertySnapshot = {
    ...s,
    property: raised ? { ...s.property, status, statusReason: reason } : s.property,
    activeAlertCount: s.activeAlertCount + counted,
    utilityOutages: sections,
    ...(s.monitoring ? { monitoring: { ...s.monitoring, statusMethod: 'highest_official_warning_or_outage' as const } } : {}),
  };
  // Risk index: power supply factor (ADR 0006 Fas 5).
  return next.riskIndex ? { ...next, riskIndex: withPowerFactor(next.riskIndex, { ...next, utilityOutages: coveredSections }) } : next;
}
