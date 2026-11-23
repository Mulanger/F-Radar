import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import type pg from 'pg';
import { loadServerEnv } from '../../packages/config/src';
import {
  createProperty,
  ensureOrganization,
  listOrgPropertyConcessions,
  listOrgUtilityOutages,
  listActiveAlarmChangesForOrg,
  listRecentChangesForOrg,
  listPropertyActivity,
  getPropertyEventMapEvent,
  loadOrgEvent,
  rematchUtilityOutages,
  replaceConcessionAreas,
  replaceNationalConcessions,
  storeUtilityOutages,
  recordUtilityCoverageGaps,
  type UtilityOutageInput,
} from '../../packages/db/src';
import { buildApp } from '../../apps/api/src/app';
import { NotificationService } from '../../apps/api/src/notifications/service';
import type { NotificationRuleInput } from '../../packages/domain/src';
import { buildUtilityCoverageReport, type PropertyUtilityStatus } from '../../packages/domain/src';

/**
 * Grid-operator outages on real PostGIS (docs/plans/stromavbrott.md §10): per-property precision,
 * lifecycle/debounce, feed rows and the anti-spam SMS guarantee.
 *
 * Isolation: every test gets its own operator id and its own ~110 m × ~57 m box, 2 km north of the
 * previous one, so outages from one test can never match another test's properties.
 */
const LON = 17.5;
const boxAt = (lat: number) => ({
  type: 'Polygon',
  coordinates: [[[LON - 0.0005, lat - 0.0005], [LON + 0.0005, lat - 0.0005], [LON + 0.0005, lat + 0.0005], [LON - 0.0005, lat + 0.0005], [LON - 0.0005, lat - 0.0005]]],
});
let seq = 0;
let LAT = 59.5;
let BOX = boxAt(LAT);
let OP = { id: 'test_operator_0', name: 'Testnät AB' };
/** Starts a fresh, isolated test area (node:test runs these tests sequentially). */
function newArea() {
  seq++;
  LAT = 59.5 + seq * 0.02;
  BOX = boxAt(LAT);
  OP = { id: `test_operator_${randomUUID().slice(0, 8)}`, name: 'Testnät AB' };
}

const outage = (o: Partial<UtilityOutageInput> = {}): UtilityOutageInput => ({
  operatorId: OP.id,
  operatorName: OP.name,
  utility: 'electricity',
  externalId: `${OP.id}:${randomUUID()}`,
  kind: 'unplanned',
  state: 'ongoing',
  affectedCustomers: 40,
  areaCustomerTotal: null,
  reportedAt: new Date().toISOString(),
  plannedStart: null,
  plannedEnd: null,
  actualStart: new Date(Date.now() - 10 * 60_000).toISOString(),
  estimatedRestore: new Date(Date.now() + 2 * 3600_000).toISOString(),
  restoredAt: null,
  precision: 'polygon',
  geometry: BOX,
  addresses: null,
  postalCodes: [],
  municipalityCode: null,
  placeLabel: 'Testområdet',
  operatorText: 'Felsökning pågår (testdata)',
  cause: null,
  sourceUrl: 'https://example.test/karta',
  attribution: 'Källa: Testnät AB – avbrottskarta',
  ...o,
});

export function registerUtilityOutageTests(pool: pg.Pool) {
  describe('Grid operator outages on real PostgreSQL/PostGIS', () => {
    async function fixture() {
      newArea();
      const clerkOrg = `org_uo${randomUUID().replaceAll('-', '')}`;
      const org = await ensureOrganization(pool, clerkOrg);
      const ctx = { organizationId: org, userId: 'user_outageTest' };
      const confirmed = (name: string, lat: number, lon: number) =>
        createProperty(pool, ctx, { name, address: `${name} 1`, location: { lat, lon }, geocode: { provider: 'manual_pin', precision: 'unknown' } });
      const inside = await confirmed('Inuti', LAT, LON);
      const outside = await confirmed('200 m bort', LAT + 0.0018, LON);
      // ~15 m north of the box edge (edge at LAT + 0.0005).
      const adjacent = await confirmed('Kanten', LAT + 0.00064, LON);
      const approx = await createProperty(pool, ctx, {
        name: 'Ungefärlig',
        address: 'Gatan, Teststad',
        location: { lat: LAT - 0.0001, lon: LON - 0.0001 },
        geocode: { provider: 'geoapify', precision: 'street', geocodedPoint: { lat: LAT - 0.0001, lon: LON - 0.0001 } },
      });
      return { org, clerkOrg, inside, outside, adjacent, approx };
    }
    const matchesFor = async (externalId: string) =>
      (
        await pool.query<{ property_id: string; match_method: string; effective_severity: string | null }>(
          `SELECT m.property_id, m.match_method, m.effective_severity FROM property_event_matches m JOIN source_events e ON e.id = m.event_id
            WHERE e.external_id = $1`,
          [externalId],
        )
      ).rows;
    const changesFor = async (externalId: string) =>
      (
        await pool.query<{ property_id: string; change_type: string; severity: string; headline: string }>(
          `SELECT c.property_id, c.change_type, c.severity, c.headline FROM monitoring_changes c JOIN source_events e ON e.id = c.event_id
            WHERE e.external_id = $1 ORDER BY c.id`,
          [externalId],
        )
      ).rows;

    it('coverage signals are tenant-isolated, idempotent and resolved when coverage recovers', async () => {
      const f = await fixture();
      const secondOrg = await ensureOrganization(pool, `org_other${randomUUID().replaceAll('-', '')}`);
      const status: PropertyUtilityStatus = {
        utility: 'electricity', coverage: 'not_monitored', operator: { id: OP.id, name: OP.name, mapUrl: null },
        updatedAt: null, current: [], upcoming: [], nearby: [], recentlyRestored: [],
      };
      const items = [f.inside, f.approx].map((p) => ({ id: p.id, geocodePrecision: p.geocode.precision, positionSource: p.positionSource, statuses: [status] }));
      const report = buildUtilityCoverageReport(items, 'electricity');
      assert.equal(report.notMonitored, 2);
      assert.equal(report.approximatePosition, 1);
      await recordUtilityCoverageGaps(pool, f.org, [report]);
      await recordUtilityCoverageGaps(pool, f.org, [report]);
      await recordUtilityCoverageGaps(pool, secondOrg, [report]); // forged cross-tenant property ids rejected
      const gaps = (await pool.query('SELECT organization_id, property_id FROM utility_coverage_gaps WHERE organization_id = ANY($1::uuid[]) AND resolved_at IS NULL', [[f.org, secondOrg]])).rows;
      assert.equal(gaps.length, 2);
      assert.ok(gaps.every((g) => g.organization_id === f.org));
      const recovered = buildUtilityCoverageReport(items.map((p) => ({ ...p, statuses: [{ ...status, coverage: 'monitored' as const }] })), 'electricity');
      await recordUtilityCoverageGaps(pool, f.org, [recovered]);
      const resolved = (await pool.query('SELECT resolved_at FROM utility_coverage_gaps WHERE organization_id = $1', [f.org])).rows;
      assert.equal(resolved.length, 2);
      assert.ok(resolved.every((g) => g.resolved_at));
    });

    it('water uses the same PostGIS pipeline: area recommendations red, information neutral, no inferred cancellation', async () => {
      const f = await fixture();
      const info = outage({ utility: 'water', noticeKind: 'information', kind: 'unknown', state: 'unknown', precision: 'area', affectedCustomers: null });
      await storeUtilityOutages(pool, OP.id, [info], true, new Date(), { utilities: ['water'], reportsRestored: true });
      await rematchUtilityOutages(pool);
      assert.equal((await changesFor(info.externalId)).find((x) => x.property_id === f.inside.id)?.severity, 'info');
      const category = (await pool.query('SELECT category FROM source_events WHERE external_id = $1', [info.externalId])).rows[0];
      assert.equal(category.category, 'WaterSupply');
      const boil = { ...info, noticeKind: 'boil_water' as const, kind: 'unplanned' as const, state: 'ongoing' as const };
      await storeUtilityOutages(pool, OP.id, [boil], true, new Date(), { utilities: ['water'], reportsRestored: true });
      await rematchUtilityOutages(pool);
      const matches = await matchesFor(info.externalId);
      assert.equal(matches.find((m) => m.property_id === f.inside.id)?.effective_severity, 'critical');
      assert.equal(matches.find((m) => m.property_id === f.approx.id)?.effective_severity, 'critical');
      assert.ok(!matches.some((m) => m.property_id === f.outside.id || m.property_id === f.adjacent.id));
      // Turning off a utility cannot end its stored notices through the next electricity-only poll.
      await storeUtilityOutages(pool, OP.id, [], true, new Date(), { utilities: ['electricity'] });
      await storeUtilityOutages(pool, OP.id, [], true, new Date(), { utilities: ['electricity'] });
      let row = (await pool.query('SELECT u.state, u.missing_polls FROM utility_outages u JOIN source_events e ON e.id=u.event_id WHERE e.external_id=$1', [info.externalId])).rows[0];
      assert.equal(row.state, 'ongoing'); assert.equal(row.missing_polls, 0);
      await storeUtilityOutages(pool, OP.id, [], true, new Date(), { utilities: ['water'], reportsRestored: true });
      await storeUtilityOutages(pool, OP.id, [], true, new Date(), { utilities: ['water'], reportsRestored: true });
      row = (await pool.query('SELECT u.state, u.restored_inferred, e.headline FROM utility_outages u JOIN source_events e ON e.id=u.event_id WHERE e.external_id=$1', [info.externalId])).rows[0];
      assert.equal(row.state, 'withdrawn'); assert.equal(row.restored_inferred, false);
      assert.match(row.headline, /inget besked om att den upphört/);
    });

    it('matches public VA address points only as nearby information and keeps drawn areas separate', async () => {
      const f = await fixture();
      const points = outage({
        utility: 'water', kind: 'unknown', state: 'unknown', noticeKind: 'information', precision: 'point',
        geometry: { type: 'MultiPoint', coordinates: [[LON, LAT], [LON + 0.001, LAT]] },
      });
      const area = outage({ utility: 'water', kind: 'unknown', state: 'unknown', noticeKind: 'information', precision: 'area' });
      await storeUtilityOutages(pool, OP.id, [points, area], true, new Date(), { utilities: ['water'], reportsRestored: true });
      await rematchUtilityOutages(pool);
      const pointMatches = await matchesFor(points.externalId);
      assert.deepEqual(pointMatches.find((m) => m.property_id === f.inside.id), {
        property_id: f.inside.id, match_method: 'outage_point', effective_severity: null,
      });
      assert.ok(!pointMatches.some((m) => m.property_id === f.outside.id || m.property_id === f.adjacent.id));
      assert.deepEqual(await changesFor(points.externalId), []);
      const areaMatches = await matchesFor(area.externalId);
      assert.deepEqual(areaMatches.find((m) => m.property_id === f.inside.id), {
        property_id: f.inside.id, match_method: 'outage_area', effective_severity: 'info',
      });
      assert.ok(!areaMatches.some((m) => m.property_id === f.adjacent.id));
      const customerFeed = await listRecentChangesForOrg(pool, f.org, 50, 'user_outageTest');
      const internalChanges = await listRecentChangesForOrg(pool, f.org);
      assert.ok(internalChanges.some((c) => c.source_id === 'utility_outages'));
      assert.ok(customerFeed.every((c) => c.source_id !== 'utility_outages'));
      assert.deepEqual(await listPropertyActivity(pool, f.org, f.inside.id), []);
    });

    it('precision per property: inside red, approximate orange, edge panel-only, 200 m nothing', async () => {
      const f = await fixture();
      const o = outage();
      await storeUtilityOutages(pool, OP.id, [o], true);
      await rematchUtilityOutages(pool);
      const m = await matchesFor(o.externalId);
      const by = (id: string) => m.find((x) => x.property_id === id);
      assert.deepEqual([by(f.inside.id)?.match_method, by(f.inside.id)?.effective_severity], ['outage_polygon', 'critical']);
      assert.deepEqual([by(f.approx.id)?.match_method, by(f.approx.id)?.effective_severity], ['outage_polygon', 'warning']);
      assert.deepEqual([by(f.adjacent.id)?.match_method, by(f.adjacent.id)?.effective_severity], ['outage_adjacent', null]);
      assert.equal(by(f.outside.id), undefined, '200 m away is not matched at all');
      const c = await changesFor(o.externalId);
      assert.deepEqual(c.map((x) => [x.property_id, x.change_type, x.severity]).sort(), [[f.approx.id, 'new', 'warning'], [f.inside.id, 'new', 'critical']].sort());
      assert.equal(c.find((x) => x.property_id === f.inside.id)!.headline, 'Oplanerat strömavbrott – Testnät AB');
      assert.match(c.find((x) => x.property_id === f.approx.id)!.headline, /ungefärlig/);

      const rows = await listOrgUtilityOutages(pool, f.org);
      assert.equal(rows.filter((r) => r.event_id).length, 3, 'inside, approx and edge are listed for the panel');
    });

    it('customer-count changes never create feed rows; two missed polls end the outage with one "tillbaka" row', async () => {
      const f = await fixture();
      const o = outage();
      await storeUtilityOutages(pool, OP.id, [o], true);
      await rematchUtilityOutages(pool);
      await storeUtilityOutages(pool, OP.id, [{ ...o, affectedCustomers: 400, geometry: BOX }], true);
      await rematchUtilityOutages(pool);
      assert.equal((await changesFor(o.externalId)).length, 2, 'still only the two "new" rows');

      await storeUtilityOutages(pool, OP.id, [], true);
      await rematchUtilityOutages(pool);
      const after1 = await pool.query(`SELECT e.status, u.missing_polls FROM source_events e JOIN utility_outages u ON u.event_id = e.id WHERE e.external_id = $1`, [o.externalId]);
      assert.deepEqual([after1.rows[0].status, after1.rows[0].missing_polls], ['active', 1]);
      // A failed/partial fetch (complete = false) never counts as missing.
      await storeUtilityOutages(pool, OP.id, [], false);
      const still = await pool.query(`SELECT u.missing_polls FROM utility_outages u JOIN source_events e ON e.id = u.event_id WHERE e.external_id = $1`, [o.externalId]);
      assert.equal(still.rows[0].missing_polls, 1);

      await storeUtilityOutages(pool, OP.id, [], true);
      await rematchUtilityOutages(pool);
      const ended = await pool.query(`SELECT e.status, e.ended_reason, u.state, u.restored_inferred FROM source_events e JOIN utility_outages u ON u.event_id = e.id WHERE e.external_id = $1`, [o.externalId]);
      // The test operator only removes outages from its map: removal reads as "troligen tillbaka", never "enligt".
      assert.deepEqual(ended.rows[0], { status: 'ended', ended_reason: 'missing_from_feed', state: 'restored', restored_inferred: true });
      const c = await changesFor(o.externalId);
      const endRows = c.filter((x) => x.change_type === 'ended');
      assert.equal(endRows.length, 2);
      assert.ok(endRows.every((x) => x.headline === 'Strömmen är troligen tillbaka – avbrottet visas inte längre hos Testnät AB' && x.severity === 'info'));
      assert.ok(endRows.every((x) => x.property_id !== f.adjacent.id), 'panel-only matches never get feed rows');
    });

    it('operator that reports restoration: a vanished ticket is withdrawn, and silent while another covers the property', async () => {
      await fixture();
      const a = outage();
      const b = { ...outage(), externalId: `${a.externalId}-b` };
      const opts = { reportsRestored: true };
      await storeUtilityOutages(pool, OP.id, [a, b], true, new Date(), opts);
      await rematchUtilityOutages(pool);
      // Ticket a vanishes (merged into b, as Ellevio 581219 → 581216) for two complete polls.
      await storeUtilityOutages(pool, OP.id, [b], true, new Date(), opts);
      await storeUtilityOutages(pool, OP.id, [b], true, new Date(), opts);
      await rematchUtilityOutages(pool);
      const ended = await pool.query(`SELECT u.state, u.restored_inferred, e.headline FROM source_events e JOIN utility_outages u ON u.event_id = e.id WHERE e.external_id = $1`, [a.externalId]);
      assert.deepEqual(ended.rows[0], { state: 'withdrawn', restored_inferred: false, headline: 'Strömavbrott visas inte längre hos Testnät AB – inget besked om att det är åtgärdat' });
      assert.equal((await changesFor(a.externalId)).filter((x) => x.change_type === 'ended').length, 0, 'replaced, not over: no feed row');
    });

    it('planned work: blue when published, version bump only for a material time change', async () => {
      await fixture();
      // Whole hour, so "+5 min" provably stays in the same 15-minute rounding slot.
      const start = new Date(Math.ceil((Date.now() + 3 * 86_400_000) / 3_600_000) * 3_600_000);
      const o = outage({ kind: 'planned', state: 'upcoming', plannedStart: start.toISOString(), plannedEnd: new Date(start.getTime() + 4 * 3600_000).toISOString(), actualStart: null, estimatedRestore: null });
      await storeUtilityOutages(pool, OP.id, [o], true);
      await rematchUtilityOutages(pool);
      assert.ok((await changesFor(o.externalId)).every((x) => x.severity === 'monitor' && /^Planerat strömavbrott/.test(x.headline)));
      // +5 min rounds to the same 15-minute slot → no new version.
      await storeUtilityOutages(pool, OP.id, [{ ...o, plannedEnd: new Date(start.getTime() + 4 * 3600_000 + 5 * 60_000).toISOString() }], true);
      await rematchUtilityOutages(pool);
      assert.equal((await changesFor(o.externalId)).filter((x) => x.change_type === 'updated').length, 0);
      await storeUtilityOutages(pool, OP.id, [{ ...o, plannedEnd: new Date(start.getTime() + 6 * 3600_000).toISOString() }], true);
      await rematchUtilityOutages(pool);
      assert.equal((await changesFor(o.externalId)).filter((x) => x.change_type === 'updated').length, 2);
    });

    it('concession areas decide coverage, not matching', async () => {
      const f = await fixture();
      await replaceConcessionAreas(pool, OP.id, 'electricity', 'operator_feed', [{ externalRef: 'k1', geometry: { type: 'Polygon', coordinates: [[[LON - 0.01, LAT - 0.005], [LON + 0.01, LAT - 0.005], [LON + 0.01, LAT + 0.005], [LON - 0.01, LAT + 0.005], [LON - 0.01, LAT - 0.005]]] } }]);
      const c = await listOrgPropertyConcessions(pool, f.org);
      assert.ok(c.some((x) => x.property_id === f.inside.id && x.operator_id === OP.id));
      // Replacing is idempotent.
      await replaceConcessionAreas(pool, OP.id, 'electricity', 'operator_feed', [{ externalRef: 'k1', geometry: { type: 'Polygon', coordinates: [[[LON - 0.01, LAT - 0.005], [LON + 0.01, LAT - 0.005], [LON + 0.01, LAT + 0.005], [LON - 0.01, LAT + 0.005], [LON - 0.01, LAT - 0.005]]] } }]);
      const n = await pool.query(`SELECT count(*)::int AS n FROM grid_concession_areas WHERE operator_id = $1`, [OP.id]);
      assert.equal(n.rows[0].n, 1);
    });

    it('postal-area outages: blue feed row from 25 customers (with caveat), none below, never SMS precision', async () => {
      const f = await fixture();
      const big = outage({ precision: 'postal_area', affectedCustomers: 60 });
      const small = outage({ precision: 'postal_area', affectedCustomers: 8 });
      await storeUtilityOutages(pool, OP.id, [big, small], true);
      await rematchUtilityOutages(pool);
      const mBig = await matchesFor(big.externalId);
      assert.ok(mBig.every((x) => x.match_method === 'outage_postal_area'));
      assert.equal(mBig.find((x) => x.property_id === f.inside.id)?.effective_severity, 'monitor');
      const cBig = await changesFor(big.externalId);
      assert.ok(cBig.length > 0 && cBig.every((x) => x.severity === 'monitor' && x.headline.endsWith('– i fastighetens postnummerområde')));
      assert.equal((await changesFor(small.externalId)).length, 0, 'small area outage: no feed rows');
      assert.ok((await matchesFor(small.externalId)).every((x) => x.effective_severity === null), 'but listed for the panel');
    });

    it('national concession areas (SWEREF 99 TM) are transformed to WGS84 and replaced atomically', async () => {
      const f = await fixture();
      // ±5 km square around Gustaf Adolfs torg, Göteborg (≈ E 319 300, N 6 400 000 in SWEREF 99 TM).
      const sq = (e: number, n: number, d: number) => [[[e - d, n - d], [e + d, n - d], [e + d, n + d], [e - d, n + d], [e - d, n - d]]];
      const gbg = await createProperty(pool, { organizationId: f.org, userId: 'user_outageTest' }, { name: 'Göteborg', address: 'Gustaf Adolfs torg 1', location: { lat: 57.7072, lon: 11.9668 }, geocode: { provider: 'manual_pin', precision: 'unknown' } });
      const n = await replaceNationalConcessions(pool, [
        { operatorId: 'goteborg_energi', operatorName: 'Göteborg Energi Nät AB', externalRef: 'T1', rings: sq(319_300, 6_400_000, 5_000) },
        { operatorId: 'ei:Testnät Syd AB', operatorName: 'Testnät Syd AB', externalRef: 'T2', rings: sq(380_000, 6_160_000, 5_000) },
      ]);
      assert.equal(n, 2);
      const cov = await listOrgPropertyConcessions(pool, f.org);
      assert.deepEqual(cov.filter((x) => x.property_id === gbg.id).map((x) => [x.operator_id, x.operator_name]), [['goteborg_energi', 'Göteborg Energi Nät AB']]);
      const bbox = await pool.query(`SELECT ST_XMin(geom) AS x0, ST_YMin(geom) AS y0 FROM grid_concession_areas WHERE external_ref = 'T1'`);
      assert.ok(bbox.rows[0].x0 > 11.8 && bbox.rows[0].x0 < 11.9 && bbox.rows[0].y0 > 57.6 && bbox.rows[0].y0 < 57.7, JSON.stringify(bbox.rows[0]));
      // A new import replaces the previous national set.
      await replaceNationalConcessions(pool, [{ operatorId: 'goteborg_energi', operatorName: 'Göteborg Energi Nät AB', externalRef: 'T3', rings: sq(319_300, 6_400_000, 5_000) }]);
      const refs = await pool.query(`SELECT external_ref FROM grid_concession_areas WHERE source = 'national_dataset' ORDER BY 1`);
      assert.deepEqual(refs.rows.map((r) => r.external_ref), ['T3']);
    });

    it('address-list water outages match by street + number within the address area; old history is not "recent"', async () => {
      const f = await fixture();
      const ctx = { organizationId: f.org, userId: 'user_outageTest' };
      const geo = (street: string, housenumber: string) => ({ provider: 'geoapify' as const, precision: 'building' as const, label: `${street} ${housenumber}, 411 01 Göteborg, Sverige`, street, housenumber, geocodedPoint: { lat: LAT, lon: LON } });
      const listed = await createProperty(pool, ctx, { name: 'Listad', address: 'Stora Nygatan 3', location: { lat: LAT, lon: LON }, geocode: geo('Stora Nygatan', '3') });
      const other = await createProperty(pool, ctx, { name: 'Annat nummer', address: 'Stora Nygatan 5', location: { lat: LAT, lon: LON }, geocode: geo('Stora Nygatan', '5') });
      const street = await createProperty(pool, ctx, { name: 'Gatan', address: 'Richtersgatan 12', location: { lat: LAT, lon: LON }, geocode: geo('Richtersgatan', '12') });
      const start = new Date(Math.ceil((Date.now() + 2 * 86_400_000) / 3_600_000) * 3_600_000);
      const o = outage({
        utility: 'water', kind: 'planned', state: 'upcoming', precision: 'address_list', geometry: null,
        addresses: [{ street: 'stora nygatan', numbers: ['1', '3'] }, { street: 'richtersgatan', numbers: null }],
        plannedStart: start.toISOString(), plannedEnd: new Date(start.getTime() + 8 * 3600_000).toISOString(), actualStart: null, estimatedRestore: null,
        addressArea: { lat: LAT, lon: LON, radiusM: 5_000 },
      });
      await storeUtilityOutages(pool, OP.id, [o], true);
      await rematchUtilityOutages(pool);
      const m = await matchesFor(o.externalId);
      assert.equal(m.find((x) => x.property_id === listed.id)?.match_method, 'outage_address');
      assert.equal(m.find((x) => x.property_id === street.id)?.match_method, 'outage_street');
      assert.equal(m.find((x) => x.property_id === other.id), undefined);
      const c = await changesFor(o.externalId);
      assert.ok(c.some((x) => x.property_id === listed.id && /^Planerad vattenavstängning/.test(x.headline)));
      const stored = await pool.query(`SELECT street, housenumber FROM properties WHERE id = $1`, [listed.id]);
      assert.deepEqual(stored.rows[0], { street: 'Stora Nygatan', housenumber: '3' });
      // An outage restored years ago (feed history) is not stored at all.
      const old = outage({ state: 'restored', restoredAt: '2023-03-13T17:00:00.000Z' });
      await storeUtilityOutages(pool, OP.id, [o, old], true);
      const gone = await pool.query(`SELECT 1 FROM source_events WHERE external_id = $1`, [old.externalId]);
      assert.equal(gone.rowCount, 0);
    });

    it('migration 0011 back-fills street and house number from the geocoder label', async () => {
      const f = await fixture();
      const p = await createProperty(pool, { organizationId: f.org, userId: 'user_outageTest' }, { name: 'Gammal', address: 'Sveavägen 42', location: { lat: LAT, lon: LON }, geocode: { provider: 'geoapify', precision: 'building', label: 'Sveavägen 42 b, 111 35 Stockholm, Sverige', geocodedPoint: { lat: LAT, lon: LON } } });
      await pool.query(`UPDATE properties SET street = NULL, housenumber = NULL WHERE id = $1`, [p.id]);
      const dir = process.env.FASTIGHETSRADAR_MIGRATIONS_DIR ?? (await import('node:url')).fileURLToPath(new URL('../../packages/db/migrations', import.meta.url));
      const sql = (await import('node:fs')).readFileSync((await import('node:path')).join(dir, '0011_property_street_address.sql'), 'utf8').replace(/ALTER TABLE properties ADD COLUMN street text, ADD COLUMN housenumber text;/, '');
      await pool.query(sql);
      const r = await pool.query(`SELECT street, housenumber FROM properties WHERE id = $1`, [p.id]);
      assert.deepEqual(r.rows[0], { street: 'Sveavägen', housenumber: '42B' });
    });

    it('historic gas events are hidden and the stored lifecycle still supports explicit withdrawal', async () => {
      const f = await fixture();
      const gas = outage({ utility: 'gas' });
      await storeUtilityOutages(pool, OP.id, [gas], true, new Date(), { utilities: ['gas'], reportsRestored: true });
      await rematchUtilityOutages(pool);
      assert.deepEqual(await matchesFor(gas.externalId), []);
      const event = (await pool.query('SELECT id, category FROM source_events WHERE external_id=$1', [gas.externalId])).rows[0];
      assert.equal(event.category, 'Heating');
      // Simulate the match and feed item saved before gas was switched off.
      await pool.query(`INSERT INTO property_event_matches (property_id, event_id, organization_id, match_method, matched_version, effective_severity)
        VALUES ($1, $2, $3, 'outage_polygon', 1, 'warning')`, [f.inside.id, event.id, f.org]);
      await pool.query(`INSERT INTO monitoring_changes (property_id, event_id, organization_id, source_id, data_class, change_type, severity, headline, dedup_key)
        VALUES ($1, $2, $3, 'utility_outages', 'UTILITY_OUTAGE', 'new', 'warning', 'Oplanerat gasavbrott', $2::uuid::text)`, [f.inside.id, event.id, f.org]);
      assert.deepEqual(await listOrgUtilityOutages(pool, f.org), []);
      assert.deepEqual(await listRecentChangesForOrg(pool, f.org, 50, 'user'), []);
      assert.deepEqual(await listRecentChangesForOrg(pool, f.org), []);
      assert.deepEqual(await listActiveAlarmChangesForOrg(pool, f.org, 'user'), []);
      assert.deepEqual(await listPropertyActivity(pool, f.org, f.inside.id), []);
      assert.equal(await loadOrgEvent(pool, f.org, event.id), null);
      assert.equal(await getPropertyEventMapEvent(pool, f.org, f.inside.id, event.id), null);
      for (let i = 0; i < 3; i++) await storeUtilityOutages(pool, OP.id, [], true, new Date(), { utilities: ['gas'], reportsRestored: true });
      const ended = await pool.query('SELECT state, restored_inferred FROM utility_outages u JOIN source_events e ON e.id=u.event_id WHERE e.external_id=$1', [gas.externalId]);
      assert.deepEqual(ended.rows[0], { state: 'withdrawn', restored_inferred: false });
    });

    it('water SMS gates, exact matches, boiling dedup and explicit cancellation work in the shared pipeline', async () => {
      const f = await fixture();
      const env = loadServerEnv({ NODE_ENV: 'test', SOURCE_UTILITY_OUTAGES_ENABLED: 'true', SOURCE_UTILITY_WATER_ENABLED: 'true', SMS_WATER_OUTAGE_ENABLED: 'true', SMS_MAX_MESSAGES_PER_MINUTE: '100' });
      const app = await buildApp(env, { db: pool, logger: false, verifyAuth: async () => ({ userId: 'user_waterTest', sessionId: 's', clerkOrgId: f.clerkOrg, orgSlug: 't', orgRole: 'org:admin' }) });
      const rec = await app.inject({ method: 'POST', url: '/v1/notifications/recipients', headers: { authorization: 'Bearer x' }, payload: { phone: '0701234567', consent: true } });
      assert.equal(rec.statusCode, 201);
      const config: NotificationRuleInput = {
        name: 'Vatten', enabled: true, scope: 'all_current', propertyIds: [], recipientIds: [rec.json().recipient.id],
        condition: { category: 'water_outage', utilities: ['water'], unplanned: true, planned: true, plannedReminder: false, restored: true, changes: false },
        cooldownMinutes: 5, quietHours: { enabled: false, start: '22:00', end: '07:00', emergencyException: false }, groupProperties: true, dailyPropertyLimit: 10, dailyRecipientLimit: 10,
      };
      const rule = await app.inject({ method: 'POST', url: '/v1/notifications/rules', headers: { authorization: 'Bearer x' }, payload: config as unknown as Record<string, unknown> });
      assert.equal(rule.statusCode, 201, rule.body);
      const second = await app.inject({ method: 'POST', url: '/v1/notifications/rules', headers: { authorization: 'Bearer x' }, payload: { ...config, name: 'Vatten extra' } as unknown as Record<string, unknown> });
      assert.equal(second.statusCode, 201, second.body);
      const water = outage({ utility: 'water', noticeKind: 'boil_water', reportedAt: new Date().toISOString(), kind: 'unknown', state: 'ongoing' });
      await storeUtilityOutages(pool, OP.id, [water], true, new Date(), { utilities: ['water'], reportsRestored: true });
      await rematchUtilityOutages(pool);
      const count = async () => (await pool.query('SELECT message, parts, property_names, status FROM notification_outbox WHERE organization_id=$1 ORDER BY created_at', [f.org])).rows;
      await new NotificationService(pool, loadServerEnv({ NODE_ENV: 'test' })).evaluateOrganization(f.org);
      assert.equal((await count()).length, 0, 'default-off SMS category never queues');
      const service = new NotificationService(pool, env);
      await service.evaluateOrganization(f.org);
      let messages = await count();
      assert.equal(messages.length, 1);
      assert.deepEqual(messages[0].property_names, ['Inuti']);
      assert.equal(messages[0].parts, 1);
      assert.match(messages[0].message, /Kokningsrekommendation/);
      await storeUtilityOutages(pool, OP.id, [{ ...water, affectedCustomers: 99 }], true);
      await rematchUtilityOutages(pool); await service.evaluateOrganization(f.org);
      assert.equal((await count()).length, 1);
      await storeUtilityOutages(pool, OP.id, [{ ...water, state: 'restored' }], true);
      await rematchUtilityOutages(pool); await service.evaluateOrganization(f.org);
      messages = await count();
      assert.equal(messages.length, 2);
      assert.match(messages[1].message, /upphört enligt leverantör/);
      assert.equal(messages[1].parts, 1);
      await app.close();
    });

    it('anti-spam SMS: only the property inside the polygon triggers; restored goes only to those notified', async () => {
      const f = await fixture();
      const env = loadServerEnv({ NODE_ENV: 'test', SMS_ESTIMATED_PRICE_PER_PART_SEK: '1', SMS_MAX_MESSAGES_PER_MINUTE: '100' });
      const app = await buildApp(env, {
        db: pool,
        logger: false,
        verifyAuth: async () => ({ userId: 'user_outageTest', sessionId: 's', clerkOrgId: f.clerkOrg, orgSlug: 't', orgRole: 'org:admin' }),
      });
      const rec = await app.inject({ method: 'POST', url: '/v1/notifications/recipients', headers: { authorization: 'Bearer x' }, payload: { phone: '0701234567', consent: true } });
      assert.equal(rec.statusCode, 201, rec.body);
      const rule: NotificationRuleInput = {
        name: 'Strömavbrott',
        enabled: true,
        scope: 'all_current',
        propertyIds: [],
        recipientIds: [rec.json().recipient.id],
        condition: { category: 'power_outage', utilities: ['electricity'], unplanned: true, planned: true, plannedReminder: true, restored: true, changes: true },
        cooldownMinutes: 360,
        quietHours: { enabled: false, start: '22:00', end: '07:00', emergencyException: true },
        groupProperties: true,
        dailyPropertyLimit: 3,
        dailyRecipientLimit: 5,
      };
      const saved = await app.inject({ method: 'POST', url: '/v1/notifications/rules', headers: { authorization: 'Bearer x' }, payload: rule as unknown as Record<string, unknown> });
      assert.equal(saved.statusCode, 201, saved.body);

      const service = new NotificationService(pool, env);
      const o = outage();
      await storeUtilityOutages(pool, OP.id, [o], true);
      await rematchUtilityOutages(pool);
      await service.evaluateOrganization(f.org);
      const out = async () =>
        (
          await pool.query<{ message: string | null; status: string; names: string[] }>(
            `SELECT n.message, n.status, n.property_names AS names FROM notification_outbox n WHERE n.organization_id = $1 ORDER BY n.created_at`,
            [f.org],
          )
        ).rows;
      let rows = await out();
      assert.equal(rows.length, 1, JSON.stringify(rows));
      assert.deepEqual(rows[0]!.names, ['Inuti'], 'approximate, edge and 200 m properties get nothing');
      assert.match(rows[0]!.message ?? '', /Oplanerat strömavbrott registrerat som omfattar adressen/);
      assert.match(rows[0]!.message ?? '', /Källa: Testnät AB/);

      // Same outage again (count change) → nothing new.
      await storeUtilityOutages(pool, OP.id, [{ ...o, affectedCustomers: 99 }], true);
      await rematchUtilityOutages(pool);
      await service.evaluateOrganization(f.org);
      assert.equal((await out()).length, 1);

      // Restored explicitly by the operator → exactly one "tillbaka" message, despite the 6 h cooldown.
      await storeUtilityOutages(pool, OP.id, [{ ...o, state: 'restored', restoredAt: new Date().toISOString() }], true);
      await rematchUtilityOutages(pool);
      await service.evaluateOrganization(f.org);
      rows = await out();
      assert.equal(rows.length, 2, JSON.stringify(rows));
      assert.match(rows[1]!.message ?? '', /Strömmen är tillbaka/);
      assert.equal(rows[1]!.status, 'queued');
    });
  });
}
