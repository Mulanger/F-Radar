import { afterEach, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { sleep } from '@fastighetsradar/integrations';
import { nextRunSeconds, runNowcast, type JobContext } from '../src/monitoring/jobs';

const now = new Date('2026-11-13T17:05:00Z');
const modified = 'Fri, 13 Nov 2026 17:00:00 GMT';
const targets = (n: number) => Array.from({ length: n }, (_, i) => ({
  point_key: `59.33,${(18.06 + i / 100).toFixed(2)}`,
  expires_at: new Date(+now - 1), fetched_at: new Date(+now - 300_000), last_modified: modified,
}));
const response = () => Response.json({ properties: { meta: { updated_at: now.toISOString(), radar_coverage: 'ok' }, timeseries: [] } });

function context(points: ReturnType<typeof targets>, fetch: typeof globalThis.fetch) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('WITH active_points AS')) return points.filter((p) => +p.expires_at <= Date.parse(String(params![0]))).slice(0, Number(params![1]));
    if (sql.includes('AS "organizationId"')) return (params![0] as string[]).map((key) => ({ propertyId: key, organizationId: 'org' }));
    return [];
  });
  const ctx: JobContext = {
    adapter: { env: loadServerEnv({ MET_NORWAY_CONTACT: 'https://example.test' }), fetch, now: () => new Date(Date.now()), logger: { debug() {}, info() {}, warn() {}, error() {} } },
    db: { async query<R>(sql: string, params?: unknown[]) { return { rows: await query(sql, params) as R[] }; } },
  };
  return { ctx, query };
}

afterEach(() => vi.useRealTimers());

it('skips absent contact, respects Expires and preserves the series on 304', async () => {
  const [cached] = targets(1);
  cached!.expires_at = new Date(+now + 60_000);
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 304, headers: { Expires: 'Fri, 13 Nov 2026 17:10:00 GMT' } }));
  const { ctx, query } = context([cached!], fetch);
  ctx.adapter.now = () => now;
  ctx.adapter.env.MET_NORWAY_CONTACT = undefined;
  expect((await runNowcast(ctx)).status).toBe('skipped');
  expect(query).not.toHaveBeenCalled();
  ctx.adapter.env.MET_NORWAY_CONTACT = 'https://example.test';
  expect((await runNowcast(ctx)).items).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
  cached!.expires_at = new Date(+now - 1);
  expect(await runNowcast(ctx)).toMatchObject({ items: 1, moreWork: false });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({ 'If-Modified-Since': modified });
  expect(query).toHaveBeenCalledWith(expect.stringMatching(/^UPDATE nowcast_points SET fetched_at=/),
    [cached!.point_key, now.toISOString(), '2026-11-13T17:10:00.000Z', modified]);
});

it('cuts off a slow in-flight batch at 90 seconds and continues the unfinished points later', async () => {
  vi.useFakeTimers({ now });
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    if (fetch.mock.calls.length <= 8) return response();
    await sleep(120_000, init?.signal ?? undefined);
    return response();
  });
  const { ctx } = context(targets(25), fetch);
  const run = runNowcast(ctx);
  await vi.advanceTimersByTimeAsync(90_000);
  const result = await run;
  expect(fetch).toHaveBeenCalledTimes(16);
  expect(result).toMatchObject({ status: 'ok', items: 8, moreWork: true });
  expect(result.changed?.properties).toHaveLength(8);
  expect(nextRunSeconds(300, 0, result)).toBe(30);
});

it('stops after the first limited batch and keeps the longest Retry-After across its responses', async () => {
  const limitUntil = new Date(+now + 1_800_000).toUTCString();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const i = fetch.mock.calls.length;
    if (i === 1) return new Response(null, { status: 429, headers: { 'Retry-After': limitUntil } });
    if (i === 3) return new Response(null, { status: 429, headers: { 'Retry-After': '600' } });
    if (i === 8) return new Response(null, { status: 503 });
    return response();
  });
  const { ctx } = context(targets(20), fetch);
  ctx.adapter.now = () => now;
  const result = await runNowcast(ctx);
  expect(fetch).toHaveBeenCalledTimes(8);
  expect(result).toMatchObject({ status: 'partial', errorCode: 'rate_limited', items: 5, moreWork: false });
  expect(result.changed?.properties).toHaveLength(5);
  expect(nextRunSeconds(300, 0, result)).toBe(1800);
});

it('keeps the quick follow-up run when a single point fails, so one bad point cannot slow the round', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (): Promise<Response> => (fetch.mock.calls.length === 3 ? new Response(null, { status: 503 }) : response()));
  const { ctx } = context(targets(12), fetch);
  ctx.adapter.now = () => now;
  const result = await runNowcast(ctx, 8);
  expect(fetch).toHaveBeenCalledTimes(8);
  expect(result).toMatchObject({ status: 'partial', items: 7, moreWork: true });
  expect(nextRunSeconds(300, 0, result)).toBe(30);
});
