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
  deleteProperty,
  ensureOrganization,
  getProperty,
  listProperties,
  migrateUp,
  migrationStatus,
  updateProperty,
} from '../../packages/db/src';
import { buildApp } from '../../apps/api/src/app';
import type { AuthVerifier, VerifiedIdentity } from '../../apps/api/src/auth';

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
  },
};

async function resetSchema() {
  await pool.query(`
    DROP TABLE IF EXISTS property_monitoring, integration_runs, alert_rules, property_source_profiles, properties,
      source_catalog, organization_members, users, organizations, schema_migrations CASCADE;
    DROP FUNCTION IF EXISTS fr_set_updated_at() CASCADE;`);
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
});
