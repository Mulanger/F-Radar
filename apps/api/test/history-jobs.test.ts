import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import type { Queryable } from '@fastighetsradar/db';
import type { AdapterContext } from '@fastighetsradar/integrations';
import { runHistoryBackfill } from '../src/monitoring/history';

function fixture(archiveFetched: boolean, response: () => Response) {
  const requests: string[] = [];
  const writes: string[] = [];
  const db: Queryable = {
    async query<R>(sql: string) {
      if (sql.includes('AS due')) return { rows: [{ due: false }] as R[] };
      if (sql.includes('WITH parameters AS'))
        return {
          rows: [
            {
              sourceId: 'smhi_observations',
              stationId: '98230',
              parameter: 'precipitation',
              archiveFetched,
              normalDue: false,
            },
          ] as R[],
        };
      writes.push(sql);
      return { rows: [] as R[], rowCount: 1 };
    },
  };
  const adapter: AdapterContext = {
    env: loadServerEnv({ NODE_ENV: 'test' }),
    now: () => new Date('2026-11-13T10:00:00Z'),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    fetch: async (input) => {
      requests.push(String(input));
      return response();
    },
  };
  return { ctx: { db, adapter }, requests, writes };
}

describe('history collection policy', () => {
  it('stops immediately on rate limiting and retains Retry-After', async () => {
    const f = fixture(false, () => new Response('', { status: 429, headers: { 'retry-after': '120' } }));
    const result = await runHistoryBackfill(f.ctx);
    expect(result).toMatchObject({ status: 'error', errorCode: 'rate_limited', retryAfterSeconds: 120 });
    expect(f.requests).toHaveLength(1);
    expect(f.writes.some((sql) => sql.includes('INSERT INTO history_backfill_checks'))).toBe(true);
  });

  it('does not download corrected archives again after a successful bootstrap', async () => {
    const csv = readFileSync(
      new URL('../../../packages/integrations/test/fixtures/history-metobs-5.csv', import.meta.url),
      'utf8',
    );
    const f = fixture(true, () => new Response(csv));
    const result = await runHistoryBackfill(f.ctx);
    expect(result.status).toBe('ok');
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]).toContain('/period/latest-months/');
    expect(f.writes.some((sql) => sql.includes('INSERT INTO station_daily'))).toBe(true);
  });
});
