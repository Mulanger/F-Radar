import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { PER_PROPERTY_JOBS, buildJobs, runObservationBackfill, type JobContext } from '../src/monitoring/jobs';

/** Real SMHI per-station response (parameter 14, latest-day) recorded 2026-11-13. */
const series = JSON.parse(readFileSync(new URL('../../../packages/integrations/test/fixtures/smhi-metobs-14-station-latest-day.json', import.meta.url), 'utf8'));
const now = new Date('2026-11-13T18:00:00Z');

function harness(stations: Array<Record<string, unknown>>, response: () => Response) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const fetchMock = vi.fn(async (_url: string | URL | Request) => response());
  const ctx: JobContext = {
    adapter: { env: loadServerEnv({}), fetch: fetchMock as unknown as typeof fetch, now: () => now, logger: { debug() {}, info() {}, warn() {}, error() {} } },
    db: {
      async query<R>(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        if (sql.includes('WITH nearest')) return { rows: stations as R[], rowCount: stations.length };
        if (sql.includes('INSERT INTO observation_history')) return { rows: [] as R[], rowCount: JSON.parse(params[1] as string).length };
        return { rows: [] as R[], rowCount: 1 };
      },
    },
  };
  return { ctx, calls, fetchMock };
}
const station = { station_id: '98230', name: 'Stockholm-Observatoriekullen A', lat: 59.3417, lon: 18.0549, stored: 12 };

describe('observation history backfill job', () => {
  it('does nothing (and calls no provider) when every station is complete', async () => {
    const h = harness([], () => new Response('{}'));
    expect(await runObservationBackfill(h.ctx)).toMatchObject({ status: 'ok', items: 0 });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the station series once, stores it as history and records a successful check', async () => {
    const h = harness([station], () => new Response(JSON.stringify(series), { headers: { 'content-type': 'application/json' } }));
    const r = await runObservationBackfill(h.ctx);
    expect(r).toMatchObject({ status: 'ok', items: series.value.length, changed: { all: true } });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(String(h.fetchMock.mock.calls[0]![0])).toContain('/parameter/14/station/98230/period/latest-months/data.json');
    const insert = h.calls.find((c) => c.sql.includes('INSERT INTO observation_history'))!;
    expect(insert.params[0]).toBe('smhi_observations');
    expect(JSON.parse(insert.params[1] as string)[0]).toMatchObject({ station_id: '98230', parameter: 'precipitation_15min', lat: 59.3417 });
    const check = h.calls.find((c) => c.sql.includes('INSERT INTO observation_backfill_checks'))!;
    expect(check.params).toEqual(['smhi_observations', '98230', 'precipitation_15min', true]);
  });

  it('records a failed attempt so the station waits for the retry window, and reports the error', async () => {
    const h = harness([station], () => new Response('nope', { status: 500 }));
    const r = await runObservationBackfill(h.ctx);
    expect(r.status).toBe('error');
    expect(h.calls.some((c) => c.sql.includes('INSERT INTO observation_history'))).toBe(false);
    expect(h.calls.find((c) => c.sql.includes('INSERT INTO observation_backfill_checks'))!.params[3]).toBe(false);
  });

  it('asks for another run when the per-run station limit was reached', async () => {
    const many = [1, 2, 3].map((i) => ({ ...station, station_id: String(98230 + i) }));
    const h = harness(many, () => new Response(JSON.stringify(series), { headers: { 'content-type': 'application/json' } }));
    expect((await runObservationBackfill(h.ctx)).moreWork).toBe(true);
    expect(h.fetchMock).toHaveBeenCalledTimes(3);
  });

  it('is scheduled with the observations source and runs right after a property is added', () => {
    const job = buildJobs(loadServerEnv({})).find((j) => j.jobId === 'observation_backfill')!;
    expect(job).toMatchObject({ sourceId: 'smhi_observations', enabled: true, intervalSeconds: 3_600 });
    expect(PER_PROPERTY_JOBS).toContain('observation_backfill');
    expect(buildJobs(loadServerEnv({ SOURCE_SMHI_OBSERVATIONS_ENABLED: 'false' })).find((j) => j.jobId === 'observation_backfill')!.enabled).toBe(false);
  });
});
