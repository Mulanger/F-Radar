/**
 * Integration tests against a REAL PostgreSQL + PostGIS database (node:test).
 *
 * Runs inside the f-radar pod against the dedicated `fastighetsradar_test` database:
 *   TEST_DATABASE_URL=postgresql://instapod@/fastighetsradar_test?host=/var/run/postgresql \
 *   FASTIGHETSRADAR_MIGRATIONS_DIR=./migrations node --test real-db.test.mjs
 *
 * The suite RESETS only FastighetsRadar's own tables in the test database (PostGIS stays).
 * It refuses to run against any database whose name does not end in `_test`.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { loadServerEnv } from '../../packages/config/src';
import {
  createProperty,
  acknowledgeFeedChange,
  deleteProperty,
  ensureOrganization,
  getProperty,
  listProperties,
  listActiveAlarmChangesForOrg,
  listRecentChangesForOrg,
  acknowledgeFeedChanges,
  unacknowledgeFeedChanges,
  loadOrgEvent,
  findOrgEventByLinkKey,
  listAcknowledgementExport,
  listAcknowledgementHistory,
  undoAcknowledgementHistory,
  migrateUp,
  migrationStatus,
  updateProperty,
  applyRetention,
  endEventsById,
  endMissingEvents,
  ensureJobs,
  finishJob,
  leaseDueJob,
  listOverdueJobs,
  loadOrgMonitoring,
  rematchEvents,
  getOrganizationSettings,
  saveTrafficRadius,
  requestJobRun,
  upsertCountyAreas,
  upsertPropertyContext,
  upsertSourceEvents,
  upsertStationObservations,
  insertObservationHistory, saveNowcastPoint, revalidateNowcastPoint, saveFlowReferences,
  stationsNeedingBackfill, markBackfillChecked,
  type SourceEventInput,
} from '../../packages/db/src';
import { buildApp } from '../../apps/api/src/app';
import type { AuthVerifier, VerifiedIdentity } from '../../apps/api/src/auth';
import { MonitoringBus } from '../../apps/api/src/monitoring/bus';
import { MonitoringService } from '../../apps/api/src/monitoring/service';
import type { GeocodingProvider } from '../../packages/integrations/src';
import type { PositionReviewItem, PropertyImportResult } from '../../packages/domain/src';
import { registerNotificationTests } from './notifications';
import { registerUtilityOutageTests } from './utility-outages';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required');
const dbName = new URL(url).pathname.replace(/^\//, '') || '';
if (!/_test$/.test(dbName)) throw new Error(`Refusing to run destructive tests against "${dbName}" (must end with _test)`);

const pool = new pg.Pool({ connectionString: url, max: 4 });
const quiet = () => {};

const ORG_A = 'org_testAAAAAAAA';
const ORG_B = 'org_testBBBBBBBB';
const IDS: Record<string, VerifiedIdentity> = {
  'tok-a': { userId: 'user_testA', sessionId: 's1', clerkOrgId: ORG_A, orgRole: 'org:admin', orgSlug: 'org-a' },
  'tok-b': { userId: 'user_testB', sessionId: 's2', clerkOrgId: ORG_B, orgRole: 'org:admin', orgSlug: 'org-b' },
  'tok-noorg': { userId: 'user_testC', sessionId: 's3', clerkOrgId: null, orgRole: null, orgSlug: null },
};
const verify: AuthVerifier = async (req) => IDS[(req.headers.authorization ?? '').replace(/^Bearer /, '')] ?? null;

const sveavagen = {
  name: 'Sveavägen 42',
  address: 'Sveavägen 42, 111 35 Stockholm, Sverige',
  location: { lat: 59.3367656, lon: 18.0627049 },
  geocode: {
    provider: 'geoapify' as const,
    placeId: 'test-place',
    label: 'Sveavägen 42, 111 35 Stockholm, Sverige',
    resultType: 'building',
    precision: 'building' as const,
    confidence: 1,
    geocodedPoint: { lat: 59.3367656, lon: 18.0627049 },
    postcode: '111 35',
    city: 'Stockholm',
    municipality: 'Stockholms kommun',
  },
};

async function resetSchema() {
  await pool.query(`
    DROP TABLE IF EXISTS feed_acknowledgement_history,feed_update_reads,sms_delivery_callbacks,notification_attempts,notification_properties,notification_outbox,notification_daily_usage,notification_usage,notification_global_usage,notification_rate_buckets,alert_evaluation_state,alert_rule_recipients,alert_rule_properties,sms_recipients,
      property_event_history, station_daily, history_stations, history_backfill_checks,
      station_precipitation_normals, history_normal_checks, history_flow_references, history_archive_state,
      observation_history, observation_backfill_checks, nowcast_points, hydrology_references, hydrology_reference_checks,
      utility_coverage_gaps, feed_acknowledgements, upcoming_acknowledgements, utility_outages, grid_concession_areas, monitoring_changes, property_event_matches, source_events, station_observation_history, observation_stations, property_forecasts,
      property_context, admin_areas, provider_jobs, property_monitoring, integration_runs, alert_rules, property_source_profiles, properties,
      source_catalog, organization_members, users, organizations, schema_migrations CASCADE;
    DROP FUNCTION IF EXISTS fr_set_updated_at() CASCADE;`);
  await pool.query(`DROP FUNCTION IF EXISTS fr_archive_match_trigger(),fr_archive_end_trigger(),fr_archive_unmatch_trigger(),fr_archive_feed_acknowledgement(),fr_archive_legacy_feed_undo() CASCADE`);
}

describe('real PostgreSQL / PostGIS', () => {
  before(async () => {
    await resetSchema();
  });
  after(async () => {
    await pool.end();
  });

  it('PostGIS is installed and functional', async () => {
    const { rows } = await pool.query<{ v: string; d: number }>(
      `SELECT PostGIS_Version() AS v,
              ST_Distance(ST_GeogFromText('POINT(18.0686 59.3293)'), ST_GeogFromText('POINT(11.9746 57.7089)'))::int AS d`,
    );
    assert.match(rows[0]!.v, /^3\./);
    assert.ok(rows[0]!.d > 390_000 && rows[0]!.d < 400_000, `Stockholm–Göteborg distance ${rows[0]!.d}`);
  });

  it('applies all migrations on a clean database and is repeatable', async () => {
    const applied = await migrateUp(pool, quiet);
    assert.ok(applied >= 2, `applied ${applied}`);
    assert.equal(await migrateUp(pool, quiet), 0);
    const status = await migrationStatus(pool);
    assert.ok(status.every((s) => s.state === 'applied'));
  });

  it('loads empty monitoring with all new spatial joins on real PostgreSQL',async()=>{
    const data=await loadOrgMonitoring(pool,'00000000-0000-4000-8000-000000000001');
    assert.deepEqual(data.history,[]);assert.deepEqual(data.nowcasts,[]);assert.deepEqual(data.hydrologyReferences,[]);
  });

  it('creates the expected tables, foreign keys and indexes', async () => {
    const { rows: tables } = await pool.query<{ t: string }>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public'`);
    const names = tables.map((r) => r.t);
    for (const t of ['organizations', 'properties', 'property_monitoring', 'alert_rules', 'source_catalog', 'schema_migrations']) assert.ok(names.includes(t), t);
    for (const t of ['users', 'organization_members']) assert.ok(!names.includes(t), `${t} must not exist (Clerk is the identity store)`);
    const { rows: idx } = await pool.query<{ i: string }>(`SELECT indexname AS i FROM pg_indexes WHERE schemaname = 'public'`);
    const ix = idx.map((r) => r.i);
    for (const i of ['idx_properties_org', 'idx_properties_location', 'idx_properties_org_created', 'organizations_clerk_org_id_key', 'idx_property_monitoring_org'])
      assert.ok(ix.includes(i), i);
    const { rows: fks } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY' AND table_name IN ('properties','property_monitoring')`,
    );
    assert.ok(Number(fks[0]!.n) >= 3);
  });

  it('enforces constraints (Sweden bbox, clerk id format, FK)', async () => {
    const orgId = await ensureOrganization(pool, ORG_A, 'org-a');
    await assert.rejects(
      pool.query(`INSERT INTO properties (organization_id, name, address, location, geocode_provider, geocode_precision)
                  VALUES ($1, 'Berlin', 'Unter den Linden 1', ST_SetSRID(ST_MakePoint(13.4, 52.52), 4326)::geography, 'manual_pin', 'unknown')`, [orgId]),
      /properties_location_in_sweden/,
    );
    await assert.rejects(pool.query(`INSERT INTO organizations (clerk_org_id) VALUES ('not-a-clerk-id')`), /organizations_clerk_org_id_format/);
    await assert.rejects(
      pool.query(`INSERT INTO properties (organization_id, name, address, location, geocode_provider, geocode_precision)
                  VALUES ('00000000-0000-4000-8000-000000000000', 'X', 'Somewhere 1', ST_SetSRID(ST_MakePoint(18, 59), 4326)::geography, 'manual_pin', 'unknown')`),
      /foreign key/,
    );
  });

  it('repository CRUD with geocoding metadata, manual correction and audit fields', async () => {
    const organizationId = await ensureOrganization(pool, ORG_A, 'org-a');
    assert.equal(await ensureOrganization(pool, ORG_A, null), organizationId, 'upsert is idempotent');
    const ctx = { organizationId, userId: 'user_testA' };

    const created = await createProperty(pool, ctx, sveavagen);
    assert.equal(created.name, 'Sveavägen 42');
    assert.equal(created.positionSource, 'geocoded');
    assert.equal(created.geocode.provider, 'geoapify');
    assert.equal(created.geocode.precision, 'building');
    assert.ok(Math.abs(created.location.lat - 59.3367656) < 1e-6 && Math.abs(created.location.lon - 18.0627049) < 1e-6);
    const { rows: mon } = await pool.query(`SELECT sms_enabled FROM property_monitoring WHERE property_id = $1`, [created.id]);
    assert.equal(mon[0].sms_enabled, false, 'SMS monitoring defaults to OFF');

    const moved = await updateProperty(pool, ctx, created.id, { name: 'Sveavägen 42 (HQ)', location: { lat: 59.33685, lon: 18.06301 } });
    assert.equal(moved!.name, 'Sveavägen 42 (HQ)');
    assert.equal(moved!.positionSource, 'manual_adjusted');
    assert.equal(moved!.geocode.placeId, 'test-place', 'existing geocoding metadata is not re-fetched/overwritten');
    assert.ok(Date.parse(moved!.updatedAt) >= Date.parse(created.updatedAt));

    const { rows: near } = await pool.query<{ ok: boolean }>(
      `SELECT ST_DWithin(location, ST_SetSRID(ST_MakePoint(18.0627, 59.3368), 4326)::geography, 100) AS ok FROM properties WHERE id = $1`,
      [created.id],
    );
    assert.equal(near[0]!.ok, true, 'geography distance query on stored point');

    assert.equal((await listProperties(pool, ctx)).length, 1);
    assert.equal(await deleteProperty(pool, ctx, created.id), true);
    assert.equal(await getProperty(pool, ctx, created.id), null);
    const { rows: gone } = await pool.query(`SELECT 1 FROM property_monitoring WHERE property_id = $1`, [created.id]);
    assert.equal(gone.length, 0, 'monitoring row cascades');
  });

  it('repository isolates organizations', async () => {
    const a = { organizationId: await ensureOrganization(pool, ORG_A, 'org-a'), userId: 'user_testA' };
    const b = { organizationId: await ensureOrganization(pool, ORG_B, 'org-b'), userId: 'user_testB' };
    const p = await createProperty(pool, a, sveavagen);
    assert.equal((await listProperties(pool, b)).length, 0);
    assert.equal(await getProperty(pool, b, p.id), null);
    assert.equal(await updateProperty(pool, b, p.id, { name: 'hijacked' }), null);
    assert.equal(await deleteProperty(pool, b, p.id), false);
    assert.equal((await getProperty(pool, a, p.id))!.name, sveavagen.name);
    await deleteProperty(pool, a, p.id);
  });

  it('undoes an exact history entry, including concurrent retries and expired events', async () => {
    const a = { organizationId: await ensureOrganization(pool, ORG_A, 'org-a'), userId: 'user_testA' };
    const otherOrg = await ensureOrganization(pool, ORG_B, 'org-b');
    const property = await createProperty(pool, a, sveavagen);
    const { rows: [change] } = await pool.query<{ id: string }>(
      `INSERT INTO monitoring_changes (organization_id, property_id, source_id, change_type, data_class, severity, headline, dedup_key)
       VALUES ($1, $2, 'smhi_warnings', 'new', 'OFFICIAL_WARNING', 'warning', 'Testvarning', 'test-history-undo') RETURNING id`,
      [a.organizationId, property.id],
    );
    const history = async () => (await listAcknowledgementHistory(pool, a.organizationId, { property: property.id })).entries;
    assert.ok(await acknowledgeFeedChange(pool, a.organizationId, change!.id, a.userId));
    const [first] = await history();
    assert.equal(await undoAcknowledgementHistory(pool, otherOrg, first!.id, 'user_testB'), null);

    const undo = (id: string) => undoAcknowledgementHistory(pool, a.organizationId, id, a.userId);
    const [one, two] = await Promise.all([undo(first!.id), undo(first!.id)]);
    assert.ok(one);
    assert.deepEqual(one, two);
    assert.equal((await pool.query('SELECT 1 FROM feed_acknowledgements WHERE change_id = $1', [change!.id])).rowCount, 0);

    assert.ok(await acknowledgeFeedChange(pool, a.organizationId, change!.id, a.userId));
    const [second] = await history();
    assert.notEqual(second!.id, first!.id);
    assert.deepEqual(await undo(first!.id), one);
    assert.equal((await pool.query('SELECT 1 FROM feed_acknowledgements WHERE change_id = $1', [change!.id])).rowCount, 1);
    assert.equal((await history()).find((entry) => entry.id === second!.id)?.undone_at, null);

    await pool.query('DELETE FROM monitoring_changes WHERE id = $1', [change!.id]);
    assert.equal((await history()).find((entry) => entry.id === second!.id)?.undone_at, null);
    assert.ok(await undo(second!.id));
    assert.equal((await history()).filter((entry) => entry.undone_at).length, 2);
    await deleteProperty(pool, a, property.id);
  });

  it('API end-to-end on real DB: auth, CRUD, persistence and cross-organization isolation', async () => {
    const app = await buildApp(loadServerEnv({ NODE_ENV: 'test' }), { logger: false, verifyAuth: verify, db: pool });
    try {
      const A = { authorization: 'Bearer tok-a' };
      const B = { authorization: 'Bearer tok-b' };

      assert.equal((await app.inject({ method: 'GET', url: '/v1/properties' })).statusCode, 401);
      assert.equal((await app.inject({ method: 'GET', url: '/v1/properties', headers: { authorization: 'Bearer tok-noorg' } })).statusCode, 403);

      // Client tries to smuggle another organization – must be ignored.
      const created = await app.inject({ method: 'POST', url: '/v1/properties', headers: A, payload: { ...sveavagen, organizationId: ORG_B, organization_id: 'x' } });
      assert.equal(created.statusCode, 201, created.body);
      const id = created.json().property.id as string;

      const listA = await app.inject({ method: 'GET', url: '/v1/properties', headers: A });
      assert.deepEqual(listA.json().properties.map((p: { id: string }) => p.id), [id]);
      const listB = await app.inject({ method: 'GET', url: '/v1/properties', headers: B });
      assert.deepEqual(listB.json().properties, [], 'org B sees nothing');

      for (const [method, payload] of [['GET', undefined], ['PATCH', { name: 'pwned' }], ['DELETE', undefined]] as const) {
        const r = await app.inject({ method, url: `/v1/properties/${id}`, headers: B, payload });
        assert.equal(r.statusCode, 404, `${method} as other org must be 404`);
      }

      const renamed = await app.inject({ method: 'PATCH', url: `/v1/properties/${id}`, headers: A, payload: { name: 'Kontoret' } });
      assert.equal(renamed.json().property.name, 'Kontoret');

      // "Logout and login": a fresh app instance (new process state) still returns the record.
      const app2 = await buildApp(loadServerEnv({ NODE_ENV: 'test' }), { logger: false, verifyAuth: verify, db: pool });
      const portfolio = await app2.inject({ method: 'GET', url: '/v1/portfolio', headers: A });
      await app2.close();
      assert.equal(portfolio.statusCode,200,portfolio.body);
      const pj = portfolio.json();
      assert.equal(pj.origin, 'live');
      assert.equal(pj.properties.length, 1);
      assert.equal(pj.properties[0].property.name, 'Kontoret');
      assert.equal(pj.properties[0].demoRisk, null);
      assert.deepEqual(pj.properties[0].metrics, []);

      assert.equal((await app.inject({ method: 'DELETE', url: `/v1/properties/${id}`, headers: A })).statusCode, 204);
      assert.equal((await app.inject({ method: 'GET', url: `/v1/properties/${id}`, headers: A })).statusCode, 404);
    } finally {
      await app.close();
    }
  });

  /* ---------------- Phase 3: monitoring ---------------- */

  const box = (lon: number, lat: number, d: number) => ({ type: 'Polygon', coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] });
  const ev = (over: Partial<SourceEventInput>): SourceEventInput => ({
    externalId: 'x', dataClass: 'OFFICIAL_WARNING', category: 'Weather', level: 'Yellow', severity: 'monitor', eventType: 'Snö', headline: 'Snöfall',
    description: 'Officiell text', areaLabel: 'Test', countyNames: [], geometry: null, geometryWkt: null, publishedAt: new Date().toISOString(),
    sourceUpdatedAt: null, validFrom: null, validTo: null, status: 'active', sourceUrl: null, attribution: 'Källa: test', extra: {}, ...over,
  });
  const goteborg = { ...sveavagen, name: 'Avenyn 1', address: 'Kungsportsavenyen 1, Göteborg', location: { lat: 57.7037, lon: 11.9746 }, geocode: { ...sveavagen.geocode, municipality: 'Göteborgs kommun' } };

  it('keeps acknowledgements and the history label specific to each official warning revision', async () => {
    const a = { organizationId: await ensureOrganization(pool, ORG_A, 'org-a'), userId: 'user_testA' };
    const property = await createProperty(pool, a, sveavagen);
    const warning = ev({ externalId: 'ack-revisions', geometry: box(18.06, 59.33, 0.03) });
    const feed = async () => (await listRecentChangesForOrg(pool, a.organizationId, 20, a.userId))
      .filter((row) => row.property_id === property.id && row.source_id === 'smhi_warnings');
    const alarms = async () => (await listActiveAlarmChangesForOrg(pool, a.organizationId, a.userId))
      .find((row) => row.property_id === property.id && row.source_id === 'smhi_warnings');
    try {
      await upsertSourceEvents(pool, 'smhi_warnings', [warning]);
      await rematchEvents(pool);
      const [original] = await feed();
      assert.equal(original?.change_type, 'new');
      const originalAck = await acknowledgeFeedChange(pool, a.organizationId, original!.id, a.userId);
      assert.ok(originalAck);

      await upsertSourceEvents(pool, 'smhi_warnings', [{ ...warning, description: 'Ändrad varningstext' }]);
      await rematchEvents(pool);
      const [revision, previous] = await feed();
      assert.equal(revision?.change_type, 'updated');
      assert.equal(revision?.acknowledged_at, null);
      assert.deepEqual(previous?.acknowledged_at, originalAck);
      assert.equal((await alarms())?.acknowledged_at, null);

      const revisionAck = await acknowledgeFeedChange(pool, a.organizationId, revision!.id, a.userId);
      assert.ok(revisionAck);
      assert.deepEqual((await alarms())?.acknowledged_at, revisionAck);
      const history = await listAcknowledgementHistory(pool, a.organizationId, { property: property.id });
      assert.deepEqual(history.entries.map(({ is_update }) => is_update), [true, false]);
      assert.ok(await undoAcknowledgementHistory(pool, a.organizationId, history.entries[0]!.id, a.userId));
      const [reopened, unchanged] = await feed();
      assert.equal(reopened?.acknowledged_at, null);
      assert.deepEqual(unchanged?.acknowledged_at, originalAck);

      await pool.query('DELETE FROM monitoring_changes WHERE id = $1', [revision!.id]);
      const archived = await listAcknowledgementHistory(pool, a.organizationId, { property: property.id });
      assert.equal(archived.entries.find(({ id }) => id === history.entries[0]!.id)?.is_update, true);
    } finally {
      await endEventsById(pool, 'smhi_warnings', [warning.externalId], 'test_finished');
      await deleteProperty(pool, a, property.id);
    }
  });

  it('limits the feed by event: a warning over 300 properties is one event with all its rows, and others stay (Fas 2 / S-04)', async () => {
    const a = { organizationId: await ensureOrganization(pool, ORG_A, 'org-a'), userId: 'user_testA' };
    const ids: string[] = [];
    for (let i = 0; i < 300; i++) {
      const location = { lat: 59.30 + (i % 20) * 0.003, lon: 18.00 + Math.floor(i / 20) * 0.004 };
      ids.push((await createProperty(pool, a, { ...sveavagen, name: `Län ${i}`, location, geocode: { ...sveavagen.geocode, placeId: `feed-${i}`, geocodedPoint: location } })).id);
    }
    const small = [0, 1, 2, 3, 4].map((k) => ev({ externalId: `feed-small-${k}`, headline: `Lokal varning ${k}`, geometry: box(18.00 + k * 0.004, 59.30, 0.0005) }));
    const county = ev({ externalId: 'feed-county', headline: 'Länsvarning', level: 'Orange', severity: 'warning', geometry: box(18.03, 59.33, 0.1) });
    try {
      for (const warning of small) {
        await upsertSourceEvents(pool, 'smhi_warnings', [warning]);
        await rematchEvents(pool);
      }
      await upsertSourceEvents(pool, 'smhi_warnings', [county]);
      await rematchEvents(pool);
      const feed = (await listRecentChangesForOrg(pool, a.organizationId, 6, a.userId)).filter((row) => ids.includes(row.property_id));
      const byHeadline = new Map<string, number>();
      for (const row of feed) byHeadline.set(row.headline, (byHeadline.get(row.headline) ?? 0) + 1);
      assert.equal(byHeadline.get('Länsvarning'), 300, 'the county warning comes with every property');
      for (let k = 0; k < 5; k++) assert.ok(byHeadline.get(`Lokal varning ${k}`), `local warning ${k} is still in the feed`);
      // A smaller limit keeps the newest events – still whole.
      const three = new Set((await listRecentChangesForOrg(pool, a.organizationId, 3, a.userId)).map((row) => row.headline));
      assert.deepEqual(three, new Set(['Länsvarning', 'Lokal varning 3', 'Lokal varning 4']));

      // "Kvittera alla" (S-05): one statement acknowledges every property of the county warning.
      const countyIds = feed.filter((row) => row.headline === 'Länsvarning').map((row) => row.id);
      const b = { organizationId: await ensureOrganization(pool, ORG_B, 'org-b'), userId: 'user_testB' };
      assert.deepEqual(await acknowledgeFeedChanges(pool, b.organizationId, countyIds, b.userId), [], 'another organization acknowledges nothing');
      const acked = await acknowledgeFeedChanges(pool, a.organizationId, countyIds, a.userId);
      assert.equal(acked.length, 300);
      const again = await acknowledgeFeedChanges(pool, a.organizationId, countyIds, a.userId);
      const times = (rows: Array<{ change_id: string; acknowledged_at: Date }>) => rows.map((r) => `${r.change_id}:${r.acknowledged_at.toISOString()}`).sort();
      assert.deepEqual(times(again), times(acked), 'acknowledging again keeps the first time');
      const history = async () => (await pool.query<{ n: number; properties: number; undone: number }>(
        `SELECT count(*)::int AS n, count(DISTINCT property_id)::int AS properties, count(undone_at)::int AS undone
           FROM feed_acknowledgement_history WHERE organization_id = $1 AND change_id = ANY($2::bigint[])`, [a.organizationId, countyIds])).rows[0];
      assert.deepEqual(await history(), { n: 300, properties: 300, undone: 0 }, 'one history row per property');
      // The report reads the whole selection at once (S-08), and says when it was cut.
      const report = await listAcknowledgementExport(pool, a.organizationId, {}, 10_000);
      assert.equal(report.entries.filter((e) => e.title.includes('Länsvarning')).length, 300);
      assert.equal(report.truncated, false);
      assert.equal((await listAcknowledgementExport(pool, a.organizationId, {}, 100)).truncated, true);
      assert.equal((await listAcknowledgementExport(pool, b.organizationId, {}, 10_000)).entries.length, 0);
      assert.equal((await unacknowledgeFeedChanges(pool, a.organizationId, countyIds, a.userId)).length, 300);
      assert.deepEqual(await history(), { n: 300, properties: 300, undone: 300 });
      const reopened = (await listRecentChangesForOrg(pool, a.organizationId, 6, a.userId)).filter((row) => row.headline === 'Länsvarning');
      assert.ok(reopened.every((row) => row.acknowledged_at === null));

      // The event page (S-09): every property of the organization once, with the row to acknowledge.
      const countyEventId = feed.find((row) => row.headline === 'Länsvarning')!.event_id!;
      const page = await loadOrgEvent(pool, a.organizationId, countyEventId);
      assert.equal(page?.properties.length, 300);
      assert.ok(page!.properties.every((p) => p.matched && p.change_id && countyIds.includes(p.change_id)));
      assert.equal(page!.event.headline, 'Länsvarning');
      assert.equal(await loadOrgEvent(pool, b.organizationId, countyEventId), null, 'another organization does not see it');
      const key = countyEventId.replace(/-/g, '').slice(0, 16);
      assert.equal(await findOrgEventByLinkKey(pool, a.organizationId, key), countyEventId);
      assert.equal(await findOrgEventByLinkKey(pool, b.organizationId, key), null);
    } finally {
      await endEventsById(pool, 'smhi_warnings', [county.externalId, ...small.map((w) => w.externalId)], 'test_finished');
      for (const id of ids) await deleteProperty(pool, a, id);
    }
  });

  it('a re-match scoped to one organization never touches the matches of another (Fas 6 / S-29)', async () => {
    const a = { organizationId: await ensureOrganization(pool, ORG_A, 'org-a'), userId: 'user_testA' };
    const b = { organizationId: await ensureOrganization(pool, ORG_B, 'org-b'), userId: 'user_testB' };
    const pa = await createProperty(pool, a, { ...sveavagen, name: 'Scope A' });
    const pb = await createProperty(pool, b, { ...sveavagen, name: 'Scope B' });
    const warning = ev({ externalId: 'scope-warning', geometry: box(18.06, 59.33, 0.05) });
    const matches = async (propertyId: string) => (await pool.query('SELECT 1 FROM property_event_matches m JOIN source_events e ON e.id = m.event_id WHERE m.property_id = $1 AND e.external_id = $2', [propertyId, warning.externalId])).rows.length;
    try {
      await upsertSourceEvents(pool, 'smhi_warnings', [warning]);
      await rematchEvents(pool);
      assert.equal(await matches(pa.id), 1);
      assert.equal(await matches(pb.id), 1);
      // A moves out of the warning: re-matching A ends A's match only.
      await updateProperty(pool, a, pa.id, { location: { lat: 57.7, lon: 11.97 } });
      const changes = await rematchEvents(pool, { organizationId: a.organizationId });
      assert.equal(await matches(pa.id), 0);
      assert.equal(await matches(pb.id), 1, 'B keeps its match');
      assert.ok(changes.every((c) => c.organizationId === a.organizationId));
      assert.deepEqual(await rematchEvents(pool, { organizationId: b.organizationId }), [], 'nothing new for B');

      // The property limit is per organization (S-30): its own limit, else the default (1000).
      const app = await buildApp(loadServerEnv({ NODE_ENV: 'test' }), { logger: false, verifyAuth: verify, db: pool });
      try {
        const create = () => app.inject({ method: 'POST', url: '/v1/properties', headers: { authorization: 'Bearer tok-a', 'content-type': 'application/json' }, payload: { ...sveavagen, name: 'Scope A2' } });
        await pool.query('UPDATE organizations SET max_properties = 1 WHERE id = $1', [a.organizationId]);
        assert.equal((await create()).statusCode, 409);
        await pool.query('UPDATE organizations SET max_properties = NULL WHERE id = $1', [a.organizationId]);
        const created = await create();
        assert.equal(created.statusCode, 201, created.body);
        await deleteProperty(pool, a, created.json().property.id);
      } finally {
        await app.close();
      }
    } finally {
      await endEventsById(pool, 'smhi_warnings', [warning.externalId], 'test_finished');
      await deleteProperty(pool, a, pa.id);
      await deleteProperty(pool, b, pb.id);
    }
  });

  it('imports 500 rows with a status per row and re-matches once (Fas 6 / S-28)', async () => {
    const a = { organizationId: await ensureOrganization(pool, ORG_A, 'org-a'), userId: 'user_testA' };
    const b = { organizationId: await ensureOrganization(pool, ORG_B, 'org-b'), userId: 'user_testB' };
    // Address search stand-in: "Saknas …" finds nothing, "Gata …" only the street, the rest a building.
    const searches: string[] = [];
    const geocoder: GeocodingProvider = {
      id: 'geoapify_geocoding',
      suggest: async () => ({ ok: true, data: [], fetchedAt: new Date().toISOString() }),
      resolve: async (text) => {
        searches.push(text);
        if (text.startsWith('Saknas')) return { ok: true, data: null, fetchedAt: new Date().toISOString() };
        const n = Number(/(\d+)/.exec(text)?.[1] ?? 0);
        return {
          ok: true,
          fetchedAt: new Date().toISOString(),
          data: { label: `${text}, Sverige`, lat: 59.3 + n / 10_000, lon: 18 + n / 10_000, precision: text.startsWith('Gata') ? 'street' : 'building', placeId: `imp-${text}`, provider: 'geoapify' },
        };
      },
    };
    // Count the re-matches (and wait for them) by wrapping the service's private run.
    const service = new MonitoringService(pool, loadServerEnv({ NODE_ENV: 'test' }), new MonitoringBus(), undefined, { propertyChangeDebounceMs: 50 });
    const inner = service as unknown as { rematchOrganization(org: string, changes: number): Promise<void> };
    const original = inner.rematchOrganization.bind(service);
    const runs: Array<{ org: string; changes: number }> = [];
    let running: Promise<void> = Promise.resolve();
    inner.rematchOrganization = (org, changes) => {
      runs.push({ org, changes });
      running = original(org, changes);
      return running;
    };
    const settle = async () => {
      await new Promise((r) => setTimeout(r, 200));
      await running;
    };
    const app = await buildApp(loadServerEnv({ NODE_ENV: 'test' }), { logger: false, verifyAuth: verify, db: pool, geocoder, monitoring: service, importGeocodePerSecond: 10_000 });
    const A = { authorization: 'Bearer tok-a' };
    const post = (token: string, rows: unknown[], final = true) =>
      app.inject({ method: 'POST', url: '/v1/properties/import', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, payload: { rows, final } });
    // 500 rows: 10 not found, 40 street hits, 64 with coordinates, 386 buildings.
    const rows = Array.from({ length: 500 }, (_, i) => {
      const n = i + 1;
      const base = { row: n + 1, name: `Import ${n}` };
      if (n % 50 === 0) return { ...base, address: `Saknas ${n}, Ingenstad` };
      if (n % 10 === 0) return { ...base, address: `Gata ${n}, Uppsala` };
      if (n % 7 === 0) return { ...base, address: `Koordinatvägen ${n}, Kista`, location: { lat: 59.4, lon: 17.95 } };
      return { ...base, address: `Importvägen ${n}, Stockholm` };
    });
    try {
      const results: PropertyImportResult[] = [];
      for (let i = 0; i < rows.length; i += 25) {
        const res = await post('tok-a', rows.slice(i, i + 25), i + 25 >= rows.length);
        assert.equal(res.statusCode, 200, res.body);
        results.push(...(res.json() as { results: PropertyImportResult[] }).results);
      }
      assert.equal(results.length, 500);
      assert.deepEqual(results.map((r) => r.row), rows.map((r) => r.row), 'one status per row, in file order');
      const count = (status: string) => results.filter((r) => r.status === status).length;
      assert.deepEqual({ created: count('created'), notFound: count('not_found') }, { created: 490, notFound: 10 });
      assert.equal(results.filter((r) => r.needsReview).length, 40);
      assert.equal(searches.length, 500 - 64, 'rows with coordinates are not searched');
      assert.equal((await listProperties(pool, a)).filter((p) => p.name.startsWith('Import ')).length, 490);
      // One re-match for the whole import, after its last batch, counting every property it created.
      await settle();
      assert.deepEqual(runs, [{ org: a.organizationId, changes: 490 }]);

      // Importing the same file again (an interrupted import resumed) creates nothing and searches nothing.
      const againRes = await post('tok-a', rows.slice(0, 25));
      assert.equal(againRes.statusCode, 200, againRes.body);
      const again = againRes.json() as { results: PropertyImportResult[] };
      assert.ok(again.results.every((r) => r.status === 'duplicate' && r.propertyId), JSON.stringify(again.results.slice(0, 3)));
      assert.equal(searches.length, 500 - 64);
      await settle();
      assert.equal(runs.length, 1, 'no re-match when nothing was created');

      // Review list: the 40 street hits; saving the pin where it is takes one off the list.
      const review = async (token = 'tok-a') =>
        ((await app.inject({ method: 'GET', url: '/v1/properties/position-review', headers: { authorization: `Bearer ${token}` } })).json() as { properties: PositionReviewItem[] }).properties.filter((p) =>
          p.name.startsWith('Import '),
        );
      const listed = await review();
      assert.equal(listed.length, 40);
      assert.ok(listed.every((p) => p.precision === 'street' && p.label?.startsWith('Gata ')));
      const patched = await app.inject({ method: 'PATCH', url: `/v1/properties/${listed[0]!.id}`, headers: A, payload: { location: listed[0]!.location } });
      assert.equal(patched.statusCode, 200, patched.body);
      assert.equal((await review()).length, 39);
      assert.equal((await review('tok-b')).length, 0, 'B sees none of them');

      // Another organization: the same addresses are new there, and its own limit applies.
      const before = (await listProperties(pool, b)).length;
      await pool.query('UPDATE organizations SET max_properties = $2 WHERE id = $1', [b.organizationId, before + 10]);
      const forBRes = await post('tok-b', rows.slice(0, 25));
      assert.equal(forBRes.statusCode, 200, forBRes.body);
      const forB = forBRes.json() as { results: PropertyImportResult[]; remaining: number };
      assert.equal(forB.results.filter((r) => r.status === 'created').length, 10);
      assert.ok(forB.results.filter((r) => r.status !== 'created').every((r) => r.status === 'limit_reached'));
      assert.equal(forB.remaining, 0);
      assert.equal((await listProperties(pool, a)).filter((p) => p.name.startsWith('Import ')).length, 490, 'A is untouched');

      // Validation: more than 25 rows, or coordinates outside Sweden, are refused as a whole.
      assert.equal((await post('tok-a', rows.slice(0, 26))).statusCode, 400);
      assert.equal((await post('tok-a', [{ row: 1, name: 'Paris', address: 'Rue de Rivoli 1', location: { lat: 48.86, lon: 2.35 } }])).statusCode, 400);
      assert.equal((await app.inject({ method: 'POST', url: '/v1/properties/import', payload: { rows: rows.slice(0, 1) } })).statusCode, 401);
      await settle();
    } finally {
      await app.close();
      await pool.query('UPDATE organizations SET max_properties = NULL WHERE id = $1', [b.organizationId]);
      await pool.query(`DELETE FROM properties WHERE organization_id = ANY($1::uuid[]) AND name LIKE 'Import %'`, [[a.organizationId, b.organizationId]]);
    }
  });

  it('migration 0003 creates monitoring tables and seeds the source catalog', async () => {
    const { rows } = await pool.query<{ t: string }>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public'`);
    const names = rows.map((r) => r.t);
    for (const t of ['provider_jobs', 'admin_areas', 'source_events', 'property_event_matches', 'monitoring_changes', 'observation_stations', 'property_forecasts', 'property_context'])
      assert.ok(names.includes(t), t);
    const { rows: cat } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM source_catalog`);
    assert.ok(cat[0]!.n >= 13);
  });

  it('job leasing is exclusive, survives restarts via expiry and honours requestJobRun', async () => {
    await ensureJobs(pool, [{ jobId: 'test_job', sourceId: 'smhi_warnings', intervalSeconds: 60, enabled: true }]);
    const a = await leaseDueJob(pool, 'test_job', 'owner-a', 30);
    assert.ok(a);
    assert.equal(await leaseDueJob(pool, 'test_job', 'owner-b', 30), null, 'second owner cannot lease');
    await finishJob(pool, 'test_job', 'owner-a', { status: 'error', items: 0, durationMs: 5, errorCode: 'timeout', nextRunInSeconds: 120 });
    const { rows } = await pool.query(`SELECT consecutive_failures, last_status, next_run_at > now() AS later FROM provider_jobs WHERE job_id = 'test_job'`);
    assert.deepEqual([rows[0].consecutive_failures, rows[0].last_status, rows[0].later], [1, 'error', true]);
    assert.equal(await leaseDueJob(pool, 'test_job', 'owner-b', 30), null, 'not due yet');
    await requestJobRun(pool, ['test_job']);
    assert.ok(await leaseDueJob(pool, 'test_job', 'owner-b', 30), 'due again');
    // Crashed owner: an expired lease can be taken over.
    await pool.query(`UPDATE provider_jobs SET lease_until = now() - interval '1 second', next_run_at = now() WHERE job_id = 'test_job'`);
    assert.ok(await leaseDueJob(pool, 'test_job', 'owner-c', 30));
    const { rows: runs } = await pool.query(`SELECT count(*)::int AS n FROM integration_runs WHERE job_id = 'test_job'`);
    assert.equal(runs[0].n, 1);
  });

  it('listOverdueJobs reports how late due jobs are and skips jobs in backoff or disabled', async () => {
    await ensureJobs(pool, ['overdue_a', 'overdue_b', 'overdue_off'].map((jobId) => ({ jobId, sourceId: null, intervalSeconds: 30, enabled: jobId !== 'overdue_off' })));
    await pool.query(`UPDATE provider_jobs SET next_run_at = now() - interval '95 seconds' WHERE job_id IN ('overdue_a', 'overdue_off')`);
    await pool.query(`UPDATE provider_jobs SET next_run_at = now() + interval '60 seconds' WHERE job_id = 'overdue_b'`);
    const late = await listOverdueJobs(pool, ['overdue_a', 'overdue_b', 'overdue_off', 'missing_job']);
    assert.deepEqual(late.map((l) => l.jobId), ['overdue_a']);
    assert.ok(late[0]!.overdueSeconds >= 95 && late[0]!.overdueSeconds < 120, String(late[0]!.overdueSeconds));
    assert.deepEqual(await listOverdueJobs(pool, []), []);
    await pool.query(`DELETE FROM provider_jobs WHERE job_id LIKE 'overdue_%'`);
  });

  it('PostGIS matching: polygons, county, radius; dedup; versioning; end; isolation; retention', async () => {
    const A = { organizationId: await ensureOrganization(pool, ORG_A, 'org-a'), userId: 'user_testA' };
    const B = { organizationId: await ensureOrganization(pool, ORG_B, 'org-b'), userId: 'user_testB' };
    const pa = await createProperty(pool, A, sveavagen);
    const pb = await createProperty(pool, B, goteborg);
    await upsertCountyAreas(pool, 'smhi_warnings', [{ code: '01', name: 'Stockholms län', sourceRef: '1', geometry: box(18.0, 59.4, 0.6) }]);

    // Warning polygons: one over Stockholm, one over Göteborg.
    let r = await upsertSourceEvents(pool, 'smhi_warnings', [
      ev({ externalId: 'w-sthlm', geometry: box(18.06, 59.33, 0.1) }),
      ev({ externalId: 'w-gbg', level: 'Orange', severity: 'warning', geometry: box(11.97, 57.70, 0.1) }),
    ]);
    assert.deepEqual(r, { inserted: 2, updated: 0, unchanged: 0 });
    let changes = await rematchEvents(pool);
    assert.equal(changes.filter((c) => c.changeType === 'new').length, 2);
    assert.equal(changes.find((c) => c.propertyId === pa.id)?.organizationId, A.organizationId);
    assert.equal((await rematchEvents(pool)).length, 0, 're-running is idempotent (dedup_key)');

    // Unchanged re-fetch keeps version; changed text bumps version → one "updated" change.
    r = await upsertSourceEvents(pool, 'smhi_warnings', [ev({ externalId: 'w-sthlm', geometry: box(18.06, 59.33, 0.1) }), ev({ externalId: 'w-gbg', level: 'Orange', severity: 'warning', geometry: box(11.97, 57.70, 0.1) })]);
    assert.deepEqual(r, { inserted: 0, updated: 0, unchanged: 2 });
    await upsertSourceEvents(pool, 'smhi_warnings', [ev({ externalId: 'w-sthlm', headline: 'Snöfall – uppdaterad', geometry: box(18.06, 59.33, 0.1) })]);
    changes = await rematchEvents(pool);
    assert.deepEqual(changes.map((c) => [c.propertyId, c.changeType]), [[pa.id, 'updated']]);

    // County-scoped Krisinformation news matches Stockholm only; national news matches both.
    await upsertSourceEvents(pool, 'krisinformation', [
      ev({ externalId: 'news:1', dataClass: 'PUBLIC_EVENT', category: 'Crisis', level: 'Info', severity: 'info', countyNames: ['Stockholms län'] }),
      ev({ externalId: 'news:2', dataClass: 'PUBLIC_EVENT', category: 'Crisis', level: 'Info', severity: 'info', countyNames: ['*'] }),
    ]);
    // Traffic: one line ~1.3 km from Sveavägen, one ~19 km away. Organization A watches traffic within
    // 2 km (Inställningar); new organizations start at 500 m.
    assert.equal((await getOrganizationSettings(pool, A.organizationId)).trafficRadiusM, 500);
    await pool.query('UPDATE organizations SET traffic_radius_m = 2000 WHERE id = $1', [A.organizationId]);
    await upsertSourceEvents(pool, 'trafikverket', [
      ev({ externalId: 'tv-near', dataClass: 'PUBLIC_EVENT', category: 'Traffic', level: null, severity: 'warning', geometryWkt: 'LINESTRING (18.06 59.325, 18.08 59.325)' }),
      ev({ externalId: 'tv-far', dataClass: 'PUBLIC_EVENT', category: 'Traffic', level: null, severity: 'warning', geometryWkt: 'POINT (18.4 59.33)' }),
    ]);
    await rematchEvents(pool);
    const ma = await loadOrgMonitoring(pool, A.organizationId);
    const mb = await loadOrgMonitoring(pool, B.organizationId);
    const ids = (m: typeof ma) => m.events.map((e) => e.external_id).sort();
    assert.deepEqual(ids(ma), ['news:1', 'news:2', 'tv-near', 'w-sthlm']);
    assert.deepEqual(ids(mb), ['news:2', 'w-gbg']);
    const near = ma.events.find((e) => e.external_id === 'tv-near')!;
    assert.equal(near.match_method, 'within_radius');
    assert.ok(Number(near.distance_m) > 1_100 && Number(near.distance_m) < 1_500, `distance ${near.distance_m}`);
    // A shorter distance drops the match at once without "Avslutad" feed rows; a longer one restores it
    // silently, and the next rematch does not report it as new.
    const changesBefore = (await pool.query('SELECT count(*)::int AS n FROM monitoring_changes')).rows[0].n;
    assert.deepEqual(await saveTrafficRadius(pool, A.organizationId, 500), { removed: 1, added: 0 });
    assert.ok(!(await loadOrgMonitoring(pool, A.organizationId)).events.some((e) => e.external_id === 'tv-near'));
    assert.deepEqual(await rematchEvents(pool), []);
    assert.deepEqual(await saveTrafficRadius(pool, A.organizationId, 2000), { removed: 0, added: 1 });
    assert.deepEqual(await rematchEvents(pool), []);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM monitoring_changes')).rows[0].n, changesBefore);
    // A message for the whole county (no municipality list) covers the property's municipality (ADR 0003).
    assert.equal(ma.events.find((e) => e.external_id === 'news:1')!.match_method, 'municipality');
    assert.ok(ma.events.every((e) => e.property_id === pa.id) && mb.events.every((e) => e.property_id === pb.id), 'tenant isolation');
    assert.deepEqual(ma.counties.map((c) => c.code), ['01']);

    // VMA: naming the property's municipality → 'municipality'; naming only OTHER municipalities in the
    // same county → 'county' (shown as Bevaka, not Kritisk – ADR 0003).
    await upsertSourceEvents(pool, 'krisinformation', [
      ev({ externalId: 'vma:own', level: 'VMA', severity: 'critical', category: 'Crisis', countyNames: ['Stockholms län'], extra: { municipalities: ['Stockholms kommun'] } }),
      ev({ externalId: 'vma:other', level: 'VMA', severity: 'critical', category: 'Crisis', countyNames: ['Stockholms län'], extra: { municipalities: ['Norrtälje kommun'] } }),
    ]);
    await rematchEvents(pool);
    const vm = (await loadOrgMonitoring(pool, A.organizationId)).events;
    assert.equal(vm.find((e) => e.external_id === 'vma:own')!.match_method, 'municipality');
    assert.equal(vm.find((e) => e.external_id === 'vma:other')!.match_method, 'county');
    assert.ok(!(await loadOrgMonitoring(pool, B.organizationId)).events.some((e) => e.external_id.startsWith('vma:')), 'other county never matches');

    // A complete fetch without w-sthlm ends it → "ended" change, match removed.
    assert.equal(await endMissingEvents(pool, 'smhi_warnings', ['w-gbg']), 1);
    changes = await rematchEvents(pool);
    assert.deepEqual(changes.map((c) => [c.propertyId, c.changeType]), [[pa.id, 'ended']]);
    assert.ok(!(await loadOrgMonitoring(pool, A.organizationId)).events.some((e) => e.external_id === 'w-sthlm'));

    // Validity already passed → stored as ended, never matched.
    await upsertSourceEvents(pool, 'smhi_warnings', [ev({ externalId: 'w-old', geometry: box(18.06, 59.33, 0.1), validTo: new Date(Date.now() - 3_600_000).toISOString() })]);
    await rematchEvents(pool);
    assert.ok(!(await loadOrgMonitoring(pool, A.organizationId)).events.some((e) => e.external_id === 'w-old'));

    // Stations: nearest per parameter with real distance; stale values ignored.
    await upsertStationObservations(pool, 'smhi_observations', [
      { stationId: 's1', parameter: 'air_temperature', name: 'Nära', lat: 59.342, lon: 18.055, value: 1.5, unit: '°C', observedAt: new Date().toISOString(), quality: 'G', extra: {} },
      { stationId: 's2', parameter: 'air_temperature', name: 'Långt', lat: 59.6, lon: 17.9, value: 9, unit: '°C', observedAt: new Date().toISOString(), quality: 'G', extra: {} },
      { stationId: 's3', parameter: 'air_temperature', name: 'Gammal', lat: 59.3368, lon: 18.0627, value: 5, unit: '°C', observedAt: new Date(Date.now() - 10 * 3_600_000).toISOString(), quality: 'G', extra: {} },
    ]);
    const obs = (await loadOrgMonitoring(pool, A.organizationId, pa.id)).observations.filter((o) => o.parameter === 'air_temperature');
    assert.equal(obs.length, 1);
    assert.equal(obs[0]!.name, 'Nära');
    assert.ok(obs[0]!.distance_m > 500 && obs[0]!.distance_m < 1_000, `distance ${obs[0]!.distance_m}`);

    // Context rows are tenant scoped as well: a write with the wrong organization is a no-op.
    await upsertPropertyContext(pool, { propertyId: pa.id, organizationId: A.organizationId, sourceId: 'scb', contextKey: 'municipality_stats', dataClass: 'REGIONAL_STATISTIC', status: 'ok', payload: { regionCode: '0180' }, sourceTimestamp: null });
    await upsertPropertyContext(pool, { propertyId: pa.id, organizationId: B.organizationId, sourceId: 'scb', contextKey: 'other', dataClass: 'REGIONAL_STATISTIC', status: 'ok', payload: { hijack: true }, sourceTimestamp: null });
    assert.equal((await loadOrgMonitoring(pool, B.organizationId)).contexts.length, 0);
    assert.equal((await loadOrgMonitoring(pool, A.organizationId)).contexts.length, 1);

    // API: warnings endpoint for own property; other org gets 404.
    const app = await buildApp(loadServerEnv({ NODE_ENV: 'test' }), { logger: false, verifyAuth: verify, db: pool });
    try {
      const w = await app.inject({ method: 'GET', url: `/v1/properties/${pb.id}/warnings`, headers: { authorization: 'Bearer tok-b' } });
      assert.equal(w.statusCode, 200, w.body);
      assert.deepEqual(w.json().warnings.map((x: { level: string }) => x.level), ['Orange']);
      assert.equal(w.json().status, 'warning');
      assert.equal((await app.inject({ method: 'GET', url: `/v1/properties/${pb.id}/warnings`, headers: { authorization: 'Bearer tok-a' } })).statusCode, 404);
      const pf = await app.inject({ method: 'GET', url: '/v1/portfolio', headers: { authorization: 'Bearer tok-a' } });
      const snap = pf.json().properties[0];
      // The portfolio is the LIST (Fas 3 / S-10): nearby observations come with the property's own snapshot.
      assert.deepEqual(snap.monitoring.observations, []);
      const one = await app.inject({ method: 'GET', url: `/v1/properties/${pa.id}/snapshot`, headers: { authorization: 'Bearer tok-a' } });
      assert.equal(one.json().snapshot.monitoring.observations[0].stationName, 'Nära');
      assert.ok(snap.events.some((e: { category: string }) => e.category === 'Traffic'));
      assert.equal(snap.demoRisk, null);
      const ch = await app.inject({ method: 'GET', url: '/v1/changes', headers: { authorization: 'Bearer tok-a' } });
      assert.ok(ch.json().changes.length >= 3);
      assert.ok(ch.json().changes.every((c: { propertyId: string }) => c.propertyId === pa.id));
    } finally {
      await app.close();
    }


    // Nearby-only observation history: idempotent writes, actual timestamp PK, organization scoped reads.
    const quarter=Math.floor(Date.now()/900000)*900000;
    const historyBase={stationId:'rain-history',parameter:'precipitation_15min',name:'Historikstation',lat:59.3368,lon:18.0627,value:1.5,unit:'mm',observedAt:new Date(quarter).toISOString(),quality:'G',extra:{}};
    const history=Array.from({length:8},(_,i)=>({...historyBase,observedAt:new Date(quarter-i*900000).toISOString()}));
    assert.equal(await insertObservationHistory(pool,'smhi_observations',history),8);
    assert.equal(await insertObservationHistory(pool,'smhi_observations',history),0,'retry is deduplicated');
    assert.equal(await insertObservationHistory(pool,'smhi_observations',[{...historyBase,stationId:'far-history',lat:65,lon:20}]),0,'distant station is not stored');
    await upsertStationObservations(pool,'smhi_observations',[historyBase]);
    assert.equal((await loadOrgMonitoring(pool,A.organizationId)).history!.filter(h=>h.station_id==='rain-history').length,8);
    assert.equal((await loadOrgMonitoring(pool,B.organizationId)).history!.filter(h=>h.station_id==='rain-history').length,0);

    // Backfill selection: the nearest rain station of an active property with gaps, as the snapshot shows it.
    const backfillOpts={sourceId:'smhi_observations',parameter:'precipitation_15min',distanceM:50_000,maxAgeHours:3,hours:72,minCoverage:0.97,retryHours:6,limit:10};
    const needing=await stationsNeedingBackfill(pool,backfillOpts);
    assert.deepEqual(needing.map(s=>s.stationId),['rain-history'],'Göteborg has no rain station within 50 km; Stockholm station has 8 of 288 values');
    assert.equal(needing[0]!.stored,8);
    assert.ok(Math.abs(needing[0]!.lat-59.3368)<1e-6 && Math.abs(needing[0]!.lon-18.0627)<1e-6,'station position comes from the stored station');
    await markBackfillChecked(pool,'smhi_observations','rain-history','precipitation_15min',false);
    assert.equal((await stationsNeedingBackfill(pool,backfillOpts)).length,0,'a tried station waits for the retry window');
    await pool.query(`UPDATE observation_backfill_checks SET checked_at=now()-interval '7 hours' WHERE station_id='rain-history'`);
    assert.equal((await stationsNeedingBackfill(pool,backfillOpts)).length,1,'retried after the window');
    const full=Array.from({length:288},(_,i)=>({...historyBase,observedAt:new Date(quarter-i*900000).toISOString()}));
    assert.equal(await insertObservationHistory(pool,'smhi_observations',full),280,'only the missing quarter-hours are added');
    assert.equal((await stationsNeedingBackfill(pool,backfillOpts)).length,0,'a complete station is not backfilled');
    await markBackfillChecked(pool,'smhi_observations','rain-history','precipitation_15min',true);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM observation_backfill_checks WHERE station_id='rain-history' AND success`)).rows[0].n,1,'check row is upserted');

    const ten=Math.floor(Date.now()/600000)*600000;
    assert.equal(await insertObservationHistory(pool,'smhi_oceanography',[
      {...historyBase,parameter:'sea_level',observedAt:new Date(ten).toISOString()},
      {...historyBase,parameter:'sea_level',observedAt:new Date(ten-300000).toISOString()},
    ]),1,'only exact ten-minute sea readings are stored');

    await saveNowcastPoint(pool,'59.34,18.06',59.34,18.06,{coverage:'ok',updatedAt:new Date().toISOString(),temperature:2,points:[{validAt:new Date().toISOString(),rateMmH:1}]},new Date().toISOString(),new Date(Date.now()+300000).toISOString(),'Fri, 13 Nov 2026 17:00:00 GMT');
    const before304=(await pool.query('SELECT series FROM nowcast_points WHERE point_key=$1',['59.34,18.06'])).rows[0];
    await revalidateNowcastPoint(pool,'59.34,18.06',new Date().toISOString(),new Date(Date.now()+600000).toISOString(),'Fri, 13 Nov 2026 17:00:00 GMT');
    assert.deepEqual((await pool.query('SELECT series FROM nowcast_points WHERE point_key=$1',['59.34,18.06'])).rows[0],before304);
    assert.equal((await loadOrgMonitoring(pool,A.organizationId,pa.id)).nowcasts!.length,1);
    assert.equal((await loadOrgMonitoring(pool,B.organizationId,pb.id)).nowcasts!.length,0);

    await upsertStationObservations(pool,'smhi_hydrology',[{...historyBase,stationId:'flow-ref',parameter:'water_flow',unit:'m³/s'}]);
    await saveFlowReferences(pool,'flow-ref',[{month:new Date().getUTCMonth()+1,reference:{p75:20,p95:40,samples:5000,years:5}}],true);
    await saveFlowReferences(pool,'flow-ref',[],false);
    assert.equal((await loadOrgMonitoring(pool,A.organizationId)).hydrologyReferences!.find(r=>r.station_id==='flow-ref')!.p75,20,'failed fetch preserves references');
    assert.equal((await loadOrgMonitoring(pool,B.organizationId)).hydrologyReferences!.length,0);

    // Retention keeps recent records and deletes only values beyond each configured window.
    await pool.query(`INSERT INTO observation_history(source_id,station_id,parameter,observed_at,value) VALUES
      ('smhi_observations','expired','precipitation_15min',now()-interval '36 days',1),
      ('smhi_observations','retained','precipitation_15min',now()-interval '34 days',1)`);
    await pool.query(`UPDATE nowcast_points SET fetched_at=now()-interval '2 days'`);
    // Retention removes ended events after the window (cascade removes their matches).
    await pool.query(`UPDATE source_events SET ended_at = now() - interval '8 days' WHERE status <> 'active'`);
    const del = await applyRetention(pool);
    assert.ok(del.events >= 2, JSON.stringify(del));
    assert.equal(del.observationHistory,1);assert.equal(del.nowcast,1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM observation_history WHERE station_id='retained'")).rows[0].n,1);
    await deleteProperty(pool, A, pa.id);
    await deleteProperty(pool, B, pb.id);
    const { rows: left } = await pool.query(`SELECT count(*)::int AS n FROM property_event_matches`);
    assert.equal(left[0].n, 0, 'matches cascade with the property');
  });
  registerNotificationTests(pool);
  registerUtilityOutageTests(pool);
});
