import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyRetention, loadOrgMonitoring, upsertPropertyContext, upsertStationObservations } from '../src/monitoring';
import { migrationStatus } from '../src/migrations';
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

/** Explicit opt-in: ordinary unit tests stay offline; never read DATABASE_URL or .env here. */
const testUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!testUrl)('station history on real local PostgreSQL/PostGIS', () => {
  let client: pg.Client;
  let organizationId: string;
  let otherOrganizationId: string;
  let propertyId: string;
  const stationId = `db-audit-${randomUUID()}`;
  const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  const olderHour = new Date(hour.getTime() - 3_600_000);
  const expired = new Date(hour.getTime() - 8 * 86_400_000);
  const observation = (observedAt: Date, rawValue: number) => ({
    stationId, name: 'Databastest station', parameter: 'pm25', lat: 59.33, lon: 18.06,
    observedAt: observedAt.toISOString(), value: Math.round(rawValue * 10) / 10, unit: 'µg/m³', quality: 'preliminary',
    extra: { rawValue, resolution: 'hour', classification: 'Gaturum' },
  });

  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        || !/^[a-z0-9_]+_test$/.test(url.pathname.slice(1)) || url.search) {
      throw new Error('Real station tests require an explicit loopback TEST_DATABASE_URL, a database ending in _test, and no URL query overrides');
    }
    client = new pg.Client({ connectionString: testUrl, connectionTimeoutMillis: 5000 });
    await client.connect();
    // Keep test records and retention effects on one connection, and roll back everything afterwards.
    await client.query('BEGIN');
    const org = async () => (await client.query<{ id: string }>(
      'INSERT INTO organizations (clerk_org_id) VALUES ($1) RETURNING id', [`org_dbaudit${randomUUID().replaceAll('-', '')}`],
    )).rows[0]!.id;
    organizationId = await org(); otherOrganizationId = await org();
    propertyId = (await client.query<{ id: string }>(
      `INSERT INTO properties (organization_id, name, address, location, geocode_provider, geocode_precision, status)
       VALUES ($1, 'Databastest', 'Testadress 1', ST_SetSRID(ST_MakePoint(18.06, 59.33), 4326)::geography, 'manual_pin', 'unknown', 'active') RETURNING id`,
      [organizationId],
    )).rows[0]!.id;
  });
  afterAll(async () => {
    if (client) {
      try { await client.query('ROLLBACK'); } finally { await client.end(); }
    }
  });

  it('has real PostGIS and all five migrations with matching checksums', async () => {
    const { rows } = await client.query<{ version: string }>('SELECT PostGIS_Version() AS version');
    expect(rows[0]!.version).toMatch(/^3\./);
    const statuses = await migrationStatus(client);
    expect(statuses.map((s) => s.version)).toEqual(['0001', '0002', '0003', '0004', '0005']);
    expect(statuses.every((s) => s.state === 'applied')).toBe(true);
  });
  it('writes and reads original-precision hourly history through the real repository', async () => {
    expect(await upsertStationObservations(client, 'air_quality', [observation(hour, 5.01)])).toBe(1);
    const data = await loadOrgMonitoring(client, organizationId, propertyId);
    const sample = data.airHistory!.find((s) => s.station_id === stationId)!;
    expect(sample).toMatchObject({ value: 5.01, unit: 'µg/m³', quality: 'preliminary', extra: { resolution: 'hour' } });
    expect(sample.observed_at!.toISOString()).toBe(hour.toISOString());
    expect(sample.distance_m).toBeCloseTo(0);
  });
  it('upserts a corrected hour without duplicates and does not rewind the latest observation', async () => {
    await upsertStationObservations(client, 'air_quality', [observation(hour, 5.02)]);
    await upsertStationObservations(client, 'air_quality', [observation(olderHour, 9.1)]);
    const { rows } = await client.query('SELECT value FROM station_observation_history WHERE station_id=$1 AND observed_at=$2', [stationId, hour]);
    expect(rows).toEqual([{ value: 5.02 }]);
    const latest = (await client.query('SELECT observed_at FROM observation_stations WHERE station_id=$1', [stationId])).rows;
    expect(latest[0].observed_at.toISOString()).toBe(hour.toISOString());
  });
  it('scopes history reads to the requested organisation and property', async () => {
    expect((await loadOrgMonitoring(client, otherOrganizationId, propertyId)).airHistory).toEqual([]);
    expect((await loadOrgMonitoring(client, organizationId)).airHistory!.some((s) => s.station_id === stationId)).toBe(true);
  });
  it('accepts MODEL context under migration 0005', async () => {
    await upsertPropertyContext(client, { propertyId, organizationId, sourceId: 'sgu_groundwater', contextKey: 'groundwater',
      dataClass: 'MODEL', status: 'ok', payload: { areaId: 'db-audit' }, sourceTimestamp: hour.toISOString() });
    const context = (await loadOrgMonitoring(client, organizationId, propertyId)).contexts.find((c) => c.context_key === 'groundwater');
    expect(context?.data_class).toBe('MODEL');
  });
  it('deletes history older than seven days and preserves recent rows', async () => {
    await upsertStationObservations(client, 'air_quality', [observation(expired, 3.2)]);
    expect((await client.query('SELECT 1 FROM station_observation_history WHERE station_id=$1 AND observed_at=$2', [stationId, expired])).rowCount).toBe(1);
    const deleted = await applyRetention(client);
    expect(deleted.stationHistory).toBeGreaterThanOrEqual(1);
    const { rows } = await client.query('SELECT observed_at FROM station_observation_history WHERE station_id=$1 ORDER BY observed_at', [stationId]);
    expect(rows.map((r) => r.observed_at.toISOString())).toEqual([olderHour.toISOString(), hour.toISOString()]);
  });
});
