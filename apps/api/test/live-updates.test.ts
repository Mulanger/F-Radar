import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { buildJobs, runNowcast, type JobContext } from '../src/monitoring/jobs';
import { MonitoringBus, type OrganizationUpdate } from '../src/monitoring/bus';
import { MonitoringService } from '../src/monitoring/service';
import { buildFeed, FEED_EVENT_LIMIT } from '../src/monitoring/snapshot';

/**
 * Live hints by property (docs/plans/skalning.md, Fas 3 / S-12): per-property jobs name the
 * organizations and properties they changed, and central hints are coalesced.
 */
const now = new Date('2026-11-13T17:05:00Z');
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const forecastFixture = readFileSync(new URL('../../../packages/integrations/test/fixtures/smhi-snow1g-point.json', import.meta.url), 'utf8');

function context(env: Record<string, string>, fetchImpl: () => Promise<Response>, rows: (sql: string) => unknown[]): JobContext {
  return {
    adapter: { env: loadServerEnv(env), fetch: vi.fn(fetchImpl) as unknown as typeof fetch, now: () => now, logger: quiet },
    db: { async query<R>(sql: string) { return { rows: rows(sql) as R[], rowCount: 1 }; } },
  };
}

describe('per-property jobs name the properties they changed', () => {
  it('the forecast job publishes organization + property ids, never "all"', async () => {
    const targets = [
      { property_id: 'p1', organization_id: 'org-a', lat: 59.331, lon: 18.076 },
      { property_id: 'p2', organization_id: 'org-b', lat: 59.332, lon: 18.075 },
    ];
    const point = { id: '1', lat: 59.33036, lon: 18.077207 };
    const properties = targets.map((t) => ({ organizationId: t.organization_id, propertyId: t.property_id }));
    const ctx = context({ NODE_ENV: 'test' }, async () => new Response(forecastFixture),
      (sql) => sql.includes('LEFT JOIN property_forecast_links') ? targets : sql.includes('SELECT g.id, g.lat') ? [point]
        : sql.includes('WITH refreshed AS') ? properties : []);
    const request = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/multipoint.json')
      ? Response.json({ type: 'MultiPoint', coordinates: [[point.lon, point.lat]] }) : new Response(forecastFixture));
    ctx.adapter.fetch = request;
    const job = buildJobs(loadServerEnv({ NODE_ENV: 'test' })).find((j) => j.jobId === 'smhi_forecast')!;
    const r = await job.run(ctx);
    expect(r).toMatchObject({ status: 'ok', items: 1 });
    expect(r.changed).toEqual({ properties });
    expect(request.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/api/category/snow1g/version/1/geotype/multipoint.json', '/api/category/snow1g/version/1/geotype/point/lon/18.0772/lat/59.3304/data.json',
    ]);
  });

  it('the nowcast job names only the properties at the points it refreshed', async () => {
    const targets = [
      { id: 'p-sthlm', organization_id: 'org-a', lat: 59.331, lon: 18.061, municipality: null, updated_at: now, traffic_radius_m: 1000 },
      { id: 'p-gbg', organization_id: 'org-b', lat: 57.701, lon: 11.971, municipality: null, updated_at: now, traffic_radius_m: 1000 },
    ];
    const cache = [
      { point_key: '59.33,18.06', expires_at: new Date(+now - 1), last_modified: 'Fri, 13 Nov 2026 17:00:00 GMT' },
      { point_key: '57.70,11.97', expires_at: new Date(+now + 60_000), last_modified: 'Fri, 13 Nov 2026 17:00:00 GMT' },
    ];
    const ctx = context({ NODE_ENV: 'test', MET_NORWAY_CONTACT: 'https://f-radar.fr-2.instapods.app' },
      async () => new Response(null, { status: 304, headers: { Expires: 'Fri, 13 Nov 2026 17:10:00 GMT' } }),
      (sql) => (sql.includes('JOIN organizations o') ? targets : sql.includes('FROM nowcast_points') ? cache : []));
    const r = await runNowcast(ctx);
    expect(r).toMatchObject({ status: 'ok', items: 1 });
    expect(r.changed).toEqual({ properties: [{ organizationId: 'org-a', propertyId: 'p-sthlm' }] });
  });
});

describe('central hints are coalesced', () => {
  afterEach(() => vi.useRealTimers());

  it('sends the first at once, then at most one per gap naming every source – property hints pass through', () => {
    vi.useFakeTimers({ now: now.getTime() });
    const bus = new MonitoringBus({ centralGapMs: 300_000 });
    const got: OrganizationUpdate[] = [];
    bus.subscribe('org-a', (u) => got.push(u));
    const central = (source: 'smhi_observations' | 'air_quality') => bus.publish({ at: new Date().toISOString(), sources: [source], organizationIds: 'all', propertyIds: [], changes: 0 });

    central('smhi_observations');
    expect(got).toEqual([expect.objectContaining({ sources: ['smhi_observations'], all: true, propertyIds: [] })]);
    vi.advanceTimersByTime(60_000);
    central('smhi_observations');
    central('air_quality');
    bus.publish({ at: new Date().toISOString(), sources: ['smhi_forecast'], organizationIds: ['org-a'], propertyIds: ['p1'], changes: 0 });
    expect(got).toHaveLength(2);
    expect(got[1]).toEqual(expect.objectContaining({ sources: ['smhi_forecast'], propertyIds: ['p1'] }));
    expect(got[1]!.all).toBeUndefined();

    vi.advanceTimersByTime(239_999);
    expect(got).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(got).toHaveLength(3);
    expect(got[2]).toEqual(expect.objectContaining({ sources: ['smhi_observations', 'air_quality'], all: true }));
    // Nothing more is pending; the next central hint waits for the gap from the trailing one.
    vi.advanceTimersByTime(600_000);
    expect(got).toHaveLength(3);
    central('air_quality');
    expect(got).toHaveLength(4);
    bus.close();
  });
});

describe('a changed property list', () => {
  it('asks open dashboards to reload instead of patching rows (the list itself changed)', async () => {
    const bus = new MonitoringBus();
    const got: OrganizationUpdate[] = [];
    bus.subscribe('org-a', (u) => got.push(u));
    const db = { async query<R>(sql: string) {
      return { rows: (sql.includes('WITH props AS') ? [{ organization_id: 'org-a', property_id: 'p-moved', source_id: 'smhi_warnings', change_type: 'new' }] : []) as R[], rowCount: 1 };
    } };
    await new MonitoringService(db, loadServerEnv({ NODE_ENV: 'test' }), bus, undefined, { propertyChangeDebounceMs: 0 }).propertyChanged('org-a');
    expect(got).toEqual([expect.objectContaining({ propertyIds: [], changes: 1 })]);
  });
});

describe('one portfolio build per organization at a time (S-33)', () => {
  it('lets concurrent requests share one build, per organization, and builds again afterwards', async () => {
    const builds: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const db = { async query<R>(sql: string, params: unknown[] = []) {
      if (sql.includes('SELECT traffic_radius_m FROM organizations')) {
        builds.push(String(params[0]));
        await gate;
      }
      return { rows: [] as R[], rowCount: 0 };
    } };
    const service = new MonitoringService(db, loadServerEnv({ NODE_ENV: 'test' }), new MonitoringBus());
    const ctx = (organizationId: string, userId: string) => ({ organizationId, userId, clerkOrgId: `org_${organizationId}`, orgSlug: null });
    const pending = [service.list(ctx('a', 'u1')), service.list(ctx('a', 'u2')), service.list(ctx('a', 'u1')), service.list(ctx('b', 'u3'))];
    await vi.waitFor(() => expect(builds).toEqual(['a', 'b']));
    release();
    const [a1, a2] = await Promise.all(pending);
    expect(a1!.properties).toBe(a2!.properties); // the same build
    await service.list(ctx('a', 'u1'));
    expect(builds).toEqual(['a', 'b', 'a']);
  });
});

describe('the feed counts events, not rows (Fas 2 / S-04)', () => {
  it('keeps every property of a county warning and still shows the other events', () => {
    const at = (min: number) => new Date(now.getTime() - min * 60_000);
    const county = Array.from({ length: 300 }, (_, i) => ({
      id: String(1000 + i), property_id: `p${i}`, event_id: 'county', source_id: 'smhi_warnings', change_type: 'new', severity: 'warning',
      headline: 'Länsvarning', created_at: at(1), dedup_key: `p${i}:county:v1`,
    }));
    const others = Array.from({ length: FEED_EVENT_LIMIT + 5 }, (_, k) => ({
      id: String(k + 1), property_id: `p${k}`, event_id: `local-${k}`, source_id: 'krisinformation', change_type: 'new', severity: 'monitor',
      headline: `Lokal ${k}`, created_at: at(10 + k), dedup_key: `p${k}:local-${k}:v1`,
    }));
    const ids = new Set(Array.from({ length: 300 }, (_, i) => `p${i}`));
    const feed = buildFeed([...county, ...others], ids);
    const cards = new Map<string, number>();
    for (const f of feed) cards.set(f.eventGroupId ?? f.id, (cards.get(f.eventGroupId ?? f.id) ?? 0) + 1);
    expect(cards.size).toBe(FEED_EVENT_LIMIT);
    expect(Math.max(...cards.values())).toBe(300);
    expect(feed.filter((f) => f.title.includes('Lokal'))).toHaveLength(FEED_EVENT_LIMIT - 1);
  });
});

describe('saving properties re-matches one organization, once per burst (Fas 6 / S-29)', () => {
  it('coalesces saves, scopes the re-match to the organization and analyzes after a large batch', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db = { async query<R>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return { rows: [] as R[], rowCount: 0 };
    } };
    const service = new MonitoringService(db, loadServerEnv({ NODE_ENV: 'test' }), new MonitoringBus(), undefined, { propertyChangeDebounceMs: 20 });
    const rematches = () => calls.filter((c) => c.sql.includes('WITH props AS') && c.sql.includes('INSERT INTO monitoring_changes'));
    await Promise.all([service.propertyChanged('org-a'), service.propertyChanged('org-a'), service.propertyChanged('org-a')]);
    expect(rematches()).toHaveLength(1);
    expect(rematches()[0]!.params).toEqual(['org-a']);
    expect(calls.some((c) => c.sql.startsWith('ANALYZE'))).toBe(false);
    calls.length = 0;
    await Promise.all(Array.from({ length: 25 }, () => service.propertyChanged('org-b')));
    expect(rematches()).toHaveLength(1);
    expect(calls.some((c) => c.sql.startsWith('ANALYZE'))).toBe(true);
  });

  it('holds the re-match of an import until its last batch, counting the properties it created (S-28)', async () => {
    const calls: string[] = [];
    const db = { async query<R>(sql: string) {
      calls.push(sql);
      return { rows: [] as R[], rowCount: 0 };
    } };
    const service = new MonitoringService(db, loadServerEnv({ NODE_ENV: 'test' }), new MonitoringBus(), undefined, { propertyChangeDebounceMs: 20 });
    const rematches = () => calls.filter((c) => c.includes('WITH props AS') && c.includes('INSERT INTO monitoring_changes')).length;
    // Nothing pending and nothing created: no run.
    await service.propertyChanged('org-c', { changes: 0 });
    expect(rematches()).toBe(0);
    // Batches seconds apart (here 60 ms, three times the short window) wait for the last one.
    const runs = [service.propertyChanged('org-c', { changes: 25, settleMs: 5_000 })];
    await new Promise((r) => setTimeout(r, 60));
    runs.push(service.propertyChanged('org-c', { changes: 25, settleMs: 5_000 }));
    await new Promise((r) => setTimeout(r, 60));
    expect(rematches()).toBe(0);
    // The last batch created nothing but ends the import: the run follows shortly.
    runs.push(service.propertyChanged('org-c', { changes: 0 }));
    await Promise.all(runs);
    expect(rematches()).toBe(1);
    expect(calls.some((c) => c.startsWith('ANALYZE'))).toBe(true);
  });
});

