import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { ServerEnv } from '@fastighetsradar/config';
import type { SourceId } from '@fastighetsradar/domain';
import { ensureJobs, finishJob, leaseDueJob, listOverdueJobs, type JobDefinition, type JobOutcome, type JobRow, type Queryable } from '@fastighetsradar/db';
import type { AdapterLogger } from '@fastighetsradar/integrations';
import { buildJobs, nextRunSeconds, type JobResult, type MonitoringJob } from './jobs';
import { UTILITY_JOB_PREFIX } from './utility-outages';
import type { MonitoringBus } from './bus';

/**
 * In-process collector scheduler (runs inside the API process on the Build pod).
 *
 *  - Job state lives in PostgreSQL (`provider_jobs`), so schedules survive restarts and a crashed
 *    run's lease simply expires. Leasing is atomic, so a second process can never double-run a job.
 *  - Jobs run in three LANES, each its own loop with one job at a time (docs/plans/skalning.md, S-34).
 *    A slow collector (air quality takes 200–430 s) used to hold up SMS evaluation and warning
 *    fetches for minutes; now it only delays other background jobs:
 *      sms        – `sms_notifications` alone, so a burst of ~50 outage fetches never delays it;
 *      alerts     – sources an SMS rule can fire on: SMHI warnings, Krisinformation, Trafikverket,
 *                   utility outage operators;
 *      background – everything else (forecasts, nowcast, observations, context, reference data).
 *    At most three jobs run at once, all mostly waiting on the network.
 *  - Each job has a hard timeout; failures back off exponentially (see `nextRunSeconds`);
 *    successes publish change hints to the bus.
 *  - How late a job started (`waitedMs`) is logged per run; an SMS or alert job past its lane's
 *    limit logs a warning and degrades `/health/ready` (see `health`).
 */
export type JobLane = 'sms' | 'alerts' | 'background';
export const JOB_LANES: readonly JobLane[] = ['sms', 'alerts', 'background'];

const ALERT_SOURCE_JOBS = new Set(['smhi_warnings', 'krisinformation', 'trafikverket']);

export function jobLane(jobId: string): JobLane {
  if (jobId === 'sms_notifications') return 'sms';
  if (ALERT_SOURCE_JOBS.has(jobId) || jobId.startsWith(UTILITY_JOB_PREFIX)) return 'alerts';
  return 'background';
}

/**
 * Lateness (seconds past due) that counts as a delayed alert. SMS rules need the change to be at
 * most 30 minutes old, but every minute here is a minute later on the customer's phone. The alerts
 * lane allows more: ~50 outage operators fall due together and take 25–60 s in total.
 */
export const LANE_DELAY_LIMIT_S: Record<Exclude<JobLane, 'background'>, number> = { sms: 60, alerts: 120 };

/** Right after a (re)start every job is late by the downtime; `health` stays `ok` meanwhile so a deploy's readiness check is not failed by it. */
const HEALTH_GRACE_MS = 5 * 60_000;

/** Job bookkeeping in `provider_jobs`; replaceable in tests. */
export interface JobStore {
  ensure(defs: JobDefinition[]): Promise<void>;
  lease(jobId: string, owner: string, leaseSeconds: number): Promise<JobRow | null>;
  finish(jobId: string, owner: string, outcome: JobOutcome): Promise<void>;
  overdue(jobIds: string[]): Promise<Array<{ jobId: string; overdueSeconds: number }>>;
}

export function dbJobStore(db: Queryable): JobStore {
  return {
    ensure: (defs) => ensureJobs(db, defs),
    lease: (jobId, owner, leaseSeconds) => leaseDueJob(db, jobId, owner, leaseSeconds),
    finish: (jobId, owner, outcome) => finishJob(db, jobId, owner, outcome),
    overdue: (jobIds) => listOverdueJobs(db, jobIds),
  };
}

export interface SchedulerOptions {
  db: Queryable;
  env: ServerEnv;
  logger: AdapterLogger;
  bus: MonitoringBus;
  fetch?: typeof fetch;
  tickMs?: number;
  /** Delay before the first tick after `start` (default 2 s). */
  startDelayMs?: number;
  jobs?: MonitoringJob[];
  store?: JobStore;
  now?: () => number;
}

export class MonitoringScheduler {
  readonly owner = `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;
  private readonly jobs: MonitoringJob[];
  private readonly store: JobStore;
  private readonly now: () => number;
  private readonly timers = new Map<JobLane, NodeJS.Timeout>();
  private readonly running = new Map<JobLane, Promise<void>>();
  private startedAt: number | null = null;
  private stopped = false;
  private abort = new AbortController();

  constructor(private readonly o: SchedulerOptions) {
    this.jobs = o.jobs ?? buildJobs(o.env);
    this.store = o.store ?? dbJobStore(o.db);
    this.now = o.now ?? Date.now;
  }

  private laneJobs(lane: JobLane) {
    return this.jobs.filter((j) => jobLane(j.jobId) === lane);
  }

  async start(): Promise<void> {
    await this.store.ensure(this.jobs.map(({ jobId, sourceId, intervalSeconds, enabled }) => ({ jobId, sourceId, intervalSeconds, enabled })));
    this.startedAt = this.now();
    const lanes = JOB_LANES.filter((lane) => this.laneJobs(lane).some((j) => j.enabled));
    this.o.logger.info({ owner: this.owner, lanes: Object.fromEntries(lanes.map((l) => [l, this.laneJobs(l).filter((j) => j.enabled).length])) }, 'monitoring scheduler started');
    for (const lane of lanes) {
      const tick = () => {
        if (this.stopped) return;
        const run = this.tick(lane)
          .then(() => undefined)
          .catch((err) => this.o.logger.error({ lane, err: err instanceof Error ? err.message : String(err) }, 'scheduler tick failed'))
          .finally(() => {
            this.running.delete(lane);
            if (!this.stopped) this.timers.set(lane, setTimeout(tick, this.o.tickMs ?? 10_000));
          });
        this.running.set(lane, run);
      };
      this.timers.set(lane, setTimeout(tick, this.o.startDelayMs ?? 2_000));
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.abort.abort(new Error('scheduler stopping'));
    await Promise.all([...this.running.values()].map((r) => r.catch(() => undefined)));
  }

  /** Runs every due job once, in priority order: one lane, or all lanes side by side. Exposed for tests. */
  async tick(lane?: JobLane): Promise<string[]> {
    if (!lane) return (await Promise.all(JOB_LANES.map((l) => this.tick(l)))).flat();
    const ran: string[] = [];
    for (const job of this.laneJobs(lane)) {
      if (this.stopped || !job.enabled) continue;
      const lease = await this.store.lease(job.jobId, this.owner, Math.ceil(job.timeoutMs / 1000) + 60);
      if (!lease) continue;
      ran.push(job.jobId);
      await this.runLeased(job, lane, lease);
    }
    return ran;
  }

  /**
   * Readiness probe: `degraded` when an SMS or alert job is later than its lane's limit
   * (waiting for its turn or still running). Background jobs are not checked – their freshness
   * shows per source in the dashboard.
   */
  async health(): Promise<{ status: 'ok' | 'degraded'; detail: string }> {
    const watched = this.jobs.filter((j) => j.enabled && jobLane(j.jobId) !== 'background');
    if (this.startedAt === null || this.now() - this.startedAt < HEALTH_GRACE_MS) return { status: 'ok', detail: 'starting' };
    const overdue = await this.store.overdue(watched.map((j) => j.jobId));
    const late = overdue
      .map((o) => ({ ...o, lane: jobLane(o.jobId) as Exclude<JobLane, 'background'> }))
      .filter((o) => o.overdueSeconds > LANE_DELAY_LIMIT_S[o.lane])
      .sort((a, b) => b.overdueSeconds - a.overdueSeconds);
    if (!late.length) return { status: 'ok', detail: `${watched.length} alert jobs on time` };
    const worst = late[0]!;
    return { status: 'degraded', detail: `${late.length} alert job(s) late; ${worst.jobId} ${Math.round(worst.overdueSeconds)} s (limit ${LANE_DELAY_LIMIT_S[worst.lane]} s)` };
  }

  private async runLeased(job: MonitoringJob, lane: JobLane, lease: JobRow) {
    const failures = lease.consecutive_failures;
    // Both timestamps come from the database clock (lease sets last_started_at = now()).
    const waitedMs = lease.last_started_at && lease.next_run_at ? Math.max(0, new Date(lease.last_started_at).getTime() - new Date(lease.next_run_at).getTime()) : null;
    if (waitedMs !== null && lane !== 'background' && waitedMs > LANE_DELAY_LIMIT_S[lane] * 1000) {
      this.o.logger.warn({ job: job.jobId, lane, waitedMs }, 'alert job delayed');
    }
    const started = this.now();
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(job.timeoutMs)]);
    let result: JobResult;
    try {
      result = await job.run({
        db: this.o.db,
        adapter: { env: this.o.env, fetch: this.o.fetch ?? fetch, logger: this.o.logger, now: () => new Date(), signal },
      });
    } catch (err) {
      result = { status: 'error', items: 0, errorCode: signal.aborted ? 'timeout' : 'internal_error', errorDetail: err instanceof Error ? err.message.slice(0, 300) : 'error' };
    }
    const durationMs = this.now() - started;
    // Cancelled because this process is shutting down (deploy/restart): not a provider failure.
    // Release the job as "skipped" so the next process picks it up promptly without backoff.
    if (this.stopped && this.abort.signal.aborted && result.status === 'error') {
      await this.store.finish(job.jobId, this.owner, { status: 'skipped', items: 0, durationMs, errorCode: 'shutdown', errorDetail: 'Avbruten vid omstart', nextRunInSeconds: 30 }).catch(() => undefined);
      return;
    }
    const failuresAfter = result.status === 'error' ? failures + 1 : 0;
    await this.store.finish(job.jobId, this.owner, {
      status: result.status,
      items: result.items,
      durationMs,
      errorCode: result.errorCode ?? null,
      errorDetail: result.errorDetail ?? null,
      sourceUpdatedAt: result.sourceUpdatedAt ?? null,
      nextRunInSeconds: nextRunSeconds(job.intervalSeconds, failuresAfter, result),
    });
    const log = result.status === 'error' ? this.o.logger.warn.bind(this.o.logger) : this.o.logger.info.bind(this.o.logger);
    log({ job: job.jobId, lane, status: result.status, items: result.items, durationMs, waitedMs, error: result.errorCode }, 'collector run');
    this.publish(job, result);
  }

  /** One live hint per organization (its changed properties), plus one central hint (coalesced by the bus). */
  private publish(job: MonitoringJob, result: JobResult) {
    if (result.status === 'error' || result.status === 'skipped') return;
    const source = (job.sourceId ?? 'smhi_warnings') as SourceId;
    const at = new Date().toISOString();
    const byOrg = new Map<string, { properties: Set<string>; changes: number }>();
    const add = (organizationId: string, propertyId: string, change: boolean) => {
      let e = byOrg.get(organizationId);
      if (!e) byOrg.set(organizationId, (e = { properties: new Set(), changes: 0 }));
      e.properties.add(propertyId);
      if (change) e.changes++;
    };
    for (const c of result.changed?.changes ?? []) add(c.organizationId, c.propertyId, true);
    for (const p of result.changed?.properties ?? []) add(p.organizationId, p.propertyId, false);
    for (const [org, e] of byOrg) {
      this.o.bus.publish({ at, sources: [source], organizationIds: [org], propertyIds: [...e.properties], changes: e.changes });
    }
    if (result.changed?.all && result.items > 0) this.o.bus.publish({ at, sources: [source], organizationIds: 'all', propertyIds: [], changes: 0 });
  }
}
