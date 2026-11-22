import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import type { JobOutcome, JobRow, Queryable } from '@fastighetsradar/db';
import { buildJobs, type JobContext, type JobResult, type MonitoringJob } from '../src/monitoring/jobs';
import { MonitoringBus } from '../src/monitoring/bus';
import { LANE_DELAY_LIMIT_S, MonitoringScheduler, jobLane, type JobStore } from '../src/monitoring/scheduler';

/** In-memory `provider_jobs`: due times, leases and finished runs. */
function memoryStore(opts: { lateBySeconds?: Record<string, number> } = {}) {
  const due = new Map<string, number>();
  const leased = new Set<string>();
  const finished: Array<{ jobId: string; outcome: JobOutcome }> = [];
  const overdueAsked: string[][] = [];
  let overdue: Array<{ jobId: string; overdueSeconds: number }> = [];
  const store: JobStore = {
    async ensure(defs) {
      for (const d of defs) if (!due.has(d.jobId)) due.set(d.jobId, Date.now());
    },
    async lease(jobId) {
      const at = due.get(jobId);
      if (at === undefined || at > Date.now() || leased.has(jobId)) return null;
      leased.add(jobId);
      const started = Date.now();
      const late = (opts.lateBySeconds?.[jobId] ?? 0) * 1000;
      return { job_id: jobId, next_run_at: new Date(started - late), last_started_at: new Date(started), consecutive_failures: 0 } as JobRow;
    },
    async finish(jobId, _owner, outcome) {
      leased.delete(jobId);
      due.set(jobId, Date.now() + outcome.nextRunInSeconds * 1000);
      finished.push({ jobId, outcome });
    },
    async overdue(jobIds) {
      overdueAsked.push(jobIds);
      return overdue;
    },
  };
  return { store, finished, overdueAsked, setOverdue: (rows: typeof overdue) => (overdue = rows) };
}

function logger() {
  const lines: Array<{ level: string; obj: Record<string, unknown>; msg?: string }> = [];
  const at = (level: string) => (obj: object, msg?: string) => void lines.push({ level, obj: obj as Record<string, unknown>, msg });
  return { lines, log: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') } };
}

const env = loadServerEnv({ NODE_ENV: 'test' });
const db = {} as Queryable;
const job = (jobId: string, run: (ctx: JobContext) => Promise<JobResult>, intervalSeconds = 0): MonitoringJob => ({ jobId, sourceId: null, intervalSeconds, enabled: true, timeoutMs: 5_000, run });
const ok = async (): Promise<JobResult> => ({ status: 'ok', items: 0 });

let scheduler: MonitoringScheduler | null = null;
afterEach(async () => {
  await scheduler?.stop();
  scheduler = null;
});

describe('scheduler lanes (S-34)', () => {
  it('puts SMS alone, SMS-triggering sources in the alerts lane and the rest in the background', () => {
    const all = buildJobs(loadServerEnv({
      NODE_ENV: 'test', SOURCE_SMHI_WARNINGS_ENABLED: 'true', SOURCE_KRISINFORMATION_ENABLED: 'true', TRAFIKVERKET_ENABLED: 'true', TRAFIKVERKET_API_KEY: 'x',
      SOURCE_AIR_QUALITY_ENABLED: 'true', SOURCE_MET_NOWCAST_ENABLED: 'true', SOURCE_SMHI_FORECAST_ENABLED: 'true',
    }));
    const lane = (l: string) => all.filter((j) => jobLane(j.jobId) === l).map((j) => j.jobId);
    expect(lane('sms')).toEqual(['sms_notifications']);
    expect(lane('alerts')).toEqual(expect.arrayContaining(['smhi_warnings', 'krisinformation', 'trafikverket']));
    expect(lane('alerts').every((id) => ['smhi_warnings', 'krisinformation', 'trafikverket'].includes(id) || id.startsWith('utility_outages:'))).toBe(true);
    expect(lane('background')).toEqual(expect.arrayContaining(['air_quality', 'met_nowcast', 'smhi_forecast', 'smhi_county_areas', 'retention']));
    expect(jobLane('utility_outages:eon')).toBe('alerts');
    expect(jobLane('utility_concessions:ei')).toBe('background');
  });

  it('keeps evaluating SMS and fetching alerts while a slow background job runs', async () => {
    let sms = 0;
    let outages = 0;
    const heavyRun: { finish?: () => void } = {};
    const heavy = job('air_quality', (ctx) => new Promise<JobResult>((resolve, reject) => {
      heavyRun.finish = () => resolve({ status: 'ok', items: 1 });
      ctx.adapter.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }), 3_600);
    const { store, finished } = memoryStore();
    scheduler = new MonitoringScheduler({
      db, env, store, logger: logger().log, bus: new MonitoringBus(), tickMs: 5, startDelayMs: 0,
      jobs: [job('sms_notifications', async () => (sms++, { status: 'ok', items: 0 })), heavy, job('utility_outages:eon', async () => (outages++, { status: 'ok', items: 0 }))],
    });
    await scheduler.start();
    await vi.waitFor(() => {
      expect(sms).toBeGreaterThanOrEqual(3);
      expect(outages).toBeGreaterThanOrEqual(3);
    }, { timeout: 3_000 });
    expect(heavyRun.finish).toBeDefined();
    expect(finished.some((f) => f.jobId === 'air_quality')).toBe(false);
    heavyRun.finish!();
    await vi.waitFor(() => expect(finished.some((f) => f.jobId === 'air_quality' && f.outcome.status === 'ok')).toBe(true));
  });

  it('runs every lane from tick() and releases an interrupted job as skipped on stop', async () => {
    const { store, finished } = memoryStore();
    let hanging = false;
    const hang = job('met_nowcast', (ctx) => new Promise<JobResult>((_resolve, reject) => {
      hanging = true;
      ctx.adapter.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    scheduler = new MonitoringScheduler({ db, env, store, logger: logger().log, bus: new MonitoringBus(), jobs: [job('sms_notifications', ok), job('smhi_warnings', ok), hang] });
    await store.ensure([{ jobId: 'sms_notifications', sourceId: null, intervalSeconds: 0, enabled: true }, { jobId: 'smhi_warnings', sourceId: null, intervalSeconds: 0, enabled: true }]);
    expect(await scheduler.tick('sms')).toEqual(['sms_notifications']);
    expect(await scheduler.tick()).toEqual(['sms_notifications', 'smhi_warnings']);
    await store.ensure([{ jobId: 'met_nowcast', sourceId: null, intervalSeconds: 0, enabled: true }]);
    const pending = scheduler.tick('background');
    await vi.waitFor(() => expect(hanging).toBe(true));
    expect(finished).toHaveLength(3);
    const stopping = scheduler.stop();
    await pending;
    await stopping;
    scheduler = null;
    expect(finished.at(-1)).toMatchObject({ jobId: 'met_nowcast', outcome: { status: 'skipped', errorCode: 'shutdown' } });
  });

  it('logs how long each job waited and warns when an alert job is late', async () => {
    const { lines, log } = logger();
    const { store } = memoryStore({ lateBySeconds: { sms_notifications: 95, smhi_warnings: 30, air_quality: 900 } });
    scheduler = new MonitoringScheduler({ db, env, store, logger: log, bus: new MonitoringBus(), jobs: [job('sms_notifications', ok), job('smhi_warnings', ok), job('air_quality', ok)] });
    await store.ensure(['sms_notifications', 'smhi_warnings', 'air_quality'].map((jobId) => ({ jobId, sourceId: null, intervalSeconds: 0, enabled: true })));
    await scheduler.tick();
    const runs = lines.filter((l) => l.msg === 'collector run');
    expect(runs.map((r) => [r.obj.job, r.obj.lane, r.obj.waitedMs])).toEqual(expect.arrayContaining([
      ['sms_notifications', 'sms', 95_000], ['smhi_warnings', 'alerts', 30_000], ['air_quality', 'background', 900_000],
    ]));
    const delayed = lines.filter((l) => l.msg === 'alert job delayed');
    expect(delayed.map((l) => l.obj.job)).toEqual(['sms_notifications']);
    expect(delayed[0]).toMatchObject({ level: 'warn', obj: { lane: 'sms', waitedMs: 95_000 } });
  });

  it('degrades readiness when an SMS or alert job is past its lane limit, after the start-up grace', async () => {
    let now = 1_000_000;
    const { store, overdueAsked, setOverdue } = memoryStore();
    scheduler = new MonitoringScheduler({
      db, env, store, logger: logger().log, bus: new MonitoringBus(), now: () => now, startDelayMs: 60_000,
      jobs: [job('sms_notifications', ok), job('utility_outages:eon', ok), job('air_quality', ok), { ...job('krisinformation', ok), enabled: false }],
    });
    expect(await scheduler.health()).toEqual({ status: 'ok', detail: 'starting' });
    await scheduler.start();
    setOverdue([{ jobId: 'sms_notifications', overdueSeconds: 300 }]);
    expect((await scheduler.health()).detail).toBe('starting');

    now += 6 * 60_000;
    expect(await scheduler.health()).toEqual({ status: 'degraded', detail: '1 alert job(s) late; sms_notifications 300 s (limit 60 s)' });
    expect(overdueAsked.at(-1)).toEqual(['sms_notifications', 'utility_outages:eon']);

    setOverdue([{ jobId: 'sms_notifications', overdueSeconds: LANE_DELAY_LIMIT_S.sms - 5 }, { jobId: 'utility_outages:eon', overdueSeconds: LANE_DELAY_LIMIT_S.sms + 30 }]);
    expect(await scheduler.health()).toEqual({ status: 'ok', detail: '2 alert jobs on time' });

    setOverdue([{ jobId: 'utility_outages:eon', overdueSeconds: LANE_DELAY_LIMIT_S.alerts + 1 }]);
    expect((await scheduler.health()).status).toBe('degraded');
  });
});

describe('live hints from the scheduler (S-12)', () => {
  it('sends each organization only its own changed properties, and one central hint', async () => {
    const bus = new MonitoringBus();
    const got: Record<string, unknown[]> = { a: [], b: [] };
    bus.subscribe('org-a', (u) => got.a!.push(u));
    bus.subscribe('org-b', (u) => got.b!.push(u));
    const { store } = memoryStore();
    const run = async (): Promise<JobResult> => ({
      status: 'ok', items: 3,
      changed: {
        changes: [{ organizationId: 'org-a', propertyId: 'p1', sourceId: 'smhi_warnings', changeType: 'new' }],
        properties: [{ organizationId: 'org-a', propertyId: 'p1' }, { organizationId: 'org-a', propertyId: 'p2' }, { organizationId: 'org-b', propertyId: 'p9' }],
      },
    });
    scheduler = new MonitoringScheduler({ db, env, store, logger: logger().log, bus, jobs: [{ ...job('smhi_forecast', run), sourceId: 'smhi_forecast' }] });
    await store.ensure([{ jobId: 'smhi_forecast', sourceId: 'smhi_forecast', intervalSeconds: 0, enabled: true }]);
    await scheduler.tick();
    expect(got.a).toEqual([expect.objectContaining({ sources: ['smhi_forecast'], propertyIds: ['p1', 'p2'], changes: 1 })]);
    expect(got.b).toEqual([expect.objectContaining({ propertyIds: ['p9'], changes: 0 })]);
    expect(JSON.stringify(got.b)).not.toContain('p1');
    bus.close();
  });
});
