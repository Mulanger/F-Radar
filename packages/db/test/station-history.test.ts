import { describe, expect, it } from 'vitest';
import { applyRetention, loadOrgMonitoring, upsertStationObservations } from '../src/monitoring';
import type { Queryable } from '../src/migrations';

function recordingDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db: Queryable = { async query<R>(sql: string, params: unknown[] = []) { calls.push({ sql, params }); return { rows: [] as R[], rowCount: 1 }; } };
  return { db, calls };
}

describe('station observation persistence', () => {
  it('preserves original precision and hour metadata in history and prevents latest-value rollback', async () => {
    const { db, calls } = recordingDb();
    await upsertStationObservations(db, 'air_quality', [{ stationId: 'station', name: 'Gatan', parameter: 'pm25', lat: 59.3, lon: 18.1,
      value: 5, unit: 'µg/m³', observedAt: '2026-11-14T10:00:00Z', quality: 'preliminary', extra: { rawValue: 5.01, resolution: 'hour' } }]);
    expect(calls[0]!.sql).toContain('EXCLUDED.observed_at >= observation_stations.observed_at');
    const history = calls.find((c) => c.sql.includes('INSERT INTO station_observation_history'))!;
    expect(JSON.parse(history.params[1] as string)[0]).toMatchObject({ value: 5.01, observed_at: '2026-11-14T10:00:00Z', extra: { resolution: 'hour' } });
    expect(history.sql).toContain("x.extra->>'resolution' = 'hour'");
  });
  it('scopes history reads to the requested organisation and property, with a spatial and age bound', async () => {
    const { db, calls } = recordingDb();
    await loadOrgMonitoring(db, 'org-id', 'property-id');
    const history = calls.find((c) => c.sql.includes('JOIN station_observation_history'))!;
    expect(history.params).toEqual(['org-id', 'property-id']);
    expect(history.sql).toContain('p.organization_id = $1');
    expect(history.sql).toContain('ST_DWithin(s.location, p.location, 25000)');
    expect(history.sql).toContain("interval '3 hours'");
  });
  it('bounds observation history retention to seven days', async () => {
    const { db, calls } = recordingDb();
    await applyRetention(db);
    expect(calls.some((c) => c.sql.includes("station_observation_history WHERE observed_at < now() - interval '7 days'"))).toBe(true);
  });
});
