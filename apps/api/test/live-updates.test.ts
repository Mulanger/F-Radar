import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { buildJobs, runNowcast, type JobContext } from '../src/monitoring/jobs';
import { MonitoringBus, type OrganizationUpdate } from '../src/monitoring/bus';
import { MonitoringService } from '../src/monitoring/service';

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
      { id: 'p1', organization_id: 'org-a', lat: 59.331, lon: 18.061, municipality: null, updated_at: now },
      { id: 'p2', organization_id: 'org-b', lat: 59.332, lon: 18.062, municipality: null, updated_at: now },
    ];
    const ctx = context({ NODE_ENV: 'test' }, async () => new Response(forecastFixture, { headers: { 'content-type': 'application/json' } }),
      (sql) => (sql.includes('LEFT JOIN property_forecasts') ? targets : []));
    const job = buildJobs(loadServerEnv({ NODE_ENV: 'test' })).find((j) => j.jobId === 'smhi_forecast')!;
    const r = await job.run(ctx);
    expect(r).toMatchObject({ status: 'ok', items: 2 });
    expect(r.changed).toEqual({ properties: [{ organizationId: 'org-a', propertyId: 'p1' }, { organizationId: 'org-b', propertyId: 'p2' }] });
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
    await new MonitoringService(db, loadServerEnv({ NODE_ENV: 'test' }), bus).propertyChanged('org-a');
    expect(got).toEqual([expect.objectContaining({ propertyIds: [], changes: 1 })]);
  });
});

