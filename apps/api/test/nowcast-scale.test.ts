import { afterEach, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { sleep } from '@fastighetsradar/integrations';
import { nextRunSeconds, runNowcast, type JobContext, type JobResult } from '../src/monitoring/jobs';

const start = Date.parse('2026-11-23T12:00:00Z');
const expiry = 300_000;
const horizon = 1_200_000;

/** Run the real collector and retry schedule on a clock with 500 ms HTTP and the production batch gap. */
async function measure(points: number) {
  vi.useFakeTimers({ now: start });
  const targets = Array.from({ length: points }, (_, i) => {
    const lat = 59 + Math.floor(i / 100) / 100, lon = 18 + (i % 100) / 100;
    return { id: `${i}`, organization_id: 'test-org', lat, lon, point_key: `${lat.toFixed(2)},${lon.toFixed(2)}` };
  });
  const cache = new Map(targets.map(({ point_key }) => [point_key, { point_key, fetched_at: new Date(start - expiry), expires_at: new Date(start), last_modified: null }]));
  const touched = new Set<string>();
  const runTimes: number[] = [];
  const starts: number[] = [];
  let oldestMs = expiry, failures = 0, timeouts = 0, complete = false;
  const db: JobContext['db'] = {
    async query<R>(sql: string, params?: unknown[]) {
      if (sql.includes('INSERT INTO nowcast_points')) {
        const key = String(params![0]);
        oldestMs = Math.max(oldestMs, Date.now() - +cache.get(key)!.fetched_at);
        cache.set(key, { ...cache.get(key)!, fetched_at: new Date(String(params![6])), expires_at: new Date(String(params![7])) });
        touched.add(key);
      }
      const rows = sql.includes('WITH active_points AS') ? [...cache.values()]
        .filter((p) => +p.expires_at <= Date.parse(String(params![0])))
        .sort((a, b) => +a.fetched_at - +b.fetched_at || a.point_key.localeCompare(b.point_key)).slice(0, Number(params![1]))
        : sql.includes('AS "organizationId"') ? targets.filter((p) => (params![0] as string[]).includes(p.point_key))
          .map((p) => ({ organizationId: p.organization_id, propertyId: p.id })) : [];
      return { rows: rows as R[] };
    },
  };
  const env = loadServerEnv({ NODE_ENV: 'test', MET_NORWAY_CONTACT: 'https://example.test' });
  const fetchStub: typeof fetch = async (_url, init) => {
    await sleep(500, init?.signal ?? undefined);
    return Response.json({ properties: { meta: { updated_at: new Date().toISOString(), radar_coverage: 'ok' }, timeseries: [] } },
      { headers: { Expires: new Date(Date.now() + expiry).toUTCString() } });
  };
  const begin = async () => {
    const abort = new AbortController();
    const began = Date.now();
    starts.push(began - start);
    const watchdog = setTimeout(() => abort.abort(), 180_000);
    let result: JobResult;
    try {
      result = await runNowcast({ db, adapter: { env, now: () => new Date(), fetch: fetchStub, signal: abort.signal, logger: { debug() {}, info() {}, warn() {}, error() {} } } });
    } catch (err) {
      if (!abort.signal.aborted) throw err;
      result = { status: 'error', items: 0, errorCode: 'timeout' };
    } finally {
      clearTimeout(watchdog);
    }
    if (result.errorCode === 'timeout' || abort.signal.aborted) timeouts++;
    failures = result.status === 'error' ? failures + 1 : 0;
    runTimes.push(Date.now() - began);
    complete = touched.size === points;
    if (!complete) setTimeout(begin, nextRunSeconds(300, failures, result) * 1000);
  };
  void begin();
  // Stop the clock once every point was updated, or observe at most 20 minutes for the old runner.
  while (!complete && Date.now() < start + horizon) await vi.advanceTimersByTimeAsync(500);
  for (const entry of cache.values()) oldestMs = Math.max(oldestMs, Date.now() - +entry.fetched_at);
  return { points, complete, starts, runs: runTimes.length, longestMs: Math.max(...runTimes), oldestMs, timeouts, touched: touched.size };
}

afterEach(() => vi.useRealTimers());

it.each([1000, 2000])('measures the complete refresh of %i separate nowcast points', async (points) => {
  const result = await measure(points);
  console.log(JSON.stringify(result));
  expect(result).toMatchObject({ complete: true, touched: points, timeouts: 0, runs: Math.ceil(points / 400) });
  expect(result.longestMs).toBeLessThanOrEqual(90_000);
  expect(result.oldestMs).toBeLessThan(15 * 60_000);
});
