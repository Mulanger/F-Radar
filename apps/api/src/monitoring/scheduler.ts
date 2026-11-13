import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { ServerEnv } from '@fastighetsradar/config';
import type { SourceId } from '@fastighetsradar/domain';
import { ensureJobs, finishJob, leaseDueJob, type Queryable } from '@fastighetsradar/db';
import type { AdapterLogger } from '@fastighetsradar/integrations';
import { buildJobs, nextRunSeconds, type JobResult, type MonitoringJob } from './jobs';
import type { MonitoringBus } from './bus';

/**
 * In-process collector scheduler (runs inside the API process on the Build pod).
 *
 *  - Job state lives in PostgreSQL (`provider_jobs`), so schedules survive restarts and a crashed
 *    run's lease simply expires. Leasing is atomic, so a second process can never double-run a job.
 *  - ONE job at a time (conservative CPU/RAM/network use on the $7 plan); each job has a hard timeout.
 *  - Failures back off exponentially (see `nextRunSeconds`); successes publish change hints to the bus.
 */
export interface SchedulerOptions {
  db: Queryable;
  env: ServerEnv;
  logger: AdapterLogger;
  bus: MonitoringBus;
  fetch?: typeof fetch;
  tickMs?: number;
  jobs?: MonitoringJob[];
}

export class MonitoringScheduler {
  readonly owner = `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;
  private readonly jobs: MonitoringJob[];
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  private abort = new AbortController();

  constructor(private readonly o: SchedulerOptions) {
    this.jobs = o.jobs ?? buildJobs(o.env);
  }

  async start(): Promise<void> {
    await ensureJobs(this.o.db, this.jobs.map(({ jobId, sourceId, intervalSeconds, enabled }) => ({ jobId, sourceId, intervalSeconds, enabled })));
    this.o.logger.info({ owner: this.owner, jobs: this.jobs.filter((j) => j.enabled).map((j) => j.jobId) }, 'monitoring scheduler started');
    const tick = () => {
      if (this.stopped) return;
      this.running = this.tick()
        .then(() => undefined)
        .catch((err) => this.o.logger.error({ err: err instanceof Error ? err.message : String(err) }, 'scheduler tick failed'))
        .finally(() => {
          this.running = null;
          if (!this.stopped) this.timer = setTimeout(tick, this.o.tickMs ?? 10_000);
        });
    };
    this.timer = setTimeout(tick, 2_000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.abort.abort(new Error('scheduler stopping'));
    await this.running?.catch(() => undefined);
  }

  /** Runs every due job once (in priority order). Exposed for tests. */
  async tick(): Promise<string[]> {
    const ran: string[] = [];
    for (const job of this.jobs) {
      if (this.stopped || !job.enabled) continue;
      const lease = await leaseDueJob(this.o.db, job.jobId, this.owner, Math.ceil(job.timeoutMs / 1000) + 60);
      if (!lease) continue;
      ran.push(job.jobId);
      await this.runLeased(job, lease.consecutive_failures);
    }
    return ran;
  }

  private async runLeased(job: MonitoringJob, failures: number) {
    const started = Date.now();
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
    const durationMs = Date.now() - started;
    // Cancelled because this process is shutting down (deploy/restart): not a provider failure.
    // Release the job as "skipped" so the next process picks it up promptly without backoff.
    if (this.stopped && this.abort.signal.aborted && result.status === 'error') {
      result = { status: 'skipped', items: 0, errorCode: 'shutdown', errorDetail: 'Avbruten vid omstart', retryAfterSeconds: undefined };
      await finishJob(this.o.db, job.jobId, this.owner, { status: 'skipped', items: 0, durationMs, errorCode: 'shutdown', errorDetail: result.errorDetail, nextRunInSeconds: 30 }).catch(() => undefined);
      return;
    }
    const failuresAfter = result.status === 'error' ? failures + 1 : 0;
    await finishJob(this.o.db, job.jobId, this.owner, {
      status: result.status,
      items: result.items,
      durationMs,
      errorCode: result.errorCode ?? null,
      errorDetail: result.errorDetail ?? null,
      sourceUpdatedAt: result.sourceUpdatedAt ?? null,
      nextRunInSeconds: nextRunSeconds(job.intervalSeconds, failuresAfter, result),
    });
    const log = result.status === 'error' ? this.o.logger.warn.bind(this.o.logger) : this.o.logger.info.bind(this.o.logger);
    log({ job: job.jobId, status: result.status, items: result.items, durationMs, error: result.errorCode }, 'collector run');
    this.publish(job, result);
  }

  private publish(job: MonitoringJob, result: JobResult) {
    if (result.status === 'error' || result.status === 'skipped') return;
    const source = (job.sourceId ?? 'smhi_warnings') as SourceId;
    const at = new Date().toISOString();
    const changes = result.changed?.changes ?? [];
    const byOrg = new Map<string, Set<string>>();
    for (const c of changes) {
      if (!byOrg.has(c.organizationId)) byOrg.set(c.organizationId, new Set());
      byOrg.get(c.organizationId)!.add(c.propertyId);
    }
    for (const [org, props] of byOrg) {
      this.o.bus.publish({ at, sources: [source], organizationIds: [org], propertyIds: [...props], changes: changes.filter((c) => c.organizationId === org).length });
    }
    if (result.changed?.all && result.items > 0) this.o.bus.publish({ at, sources: [source], organizationIds: 'all', propertyIds: [], changes: 0 });
  }
}
