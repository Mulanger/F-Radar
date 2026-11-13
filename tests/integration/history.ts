import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type pg from 'pg';
import { loadServerEnv } from '../../packages/config/src';
import { HISTORY, PropertyHistorySchema, addHistoryDays, swedishDateKey } from '../../packages/domain/src';
import {
  aggregateStoredHistory,
  applyRetention,
  createProperty,
  deleteProperty,
  endMissingEvents,
  ensureOrganization,
  historyBackfillTargets,
  listMigrations,
  propertyHistoryEvents,
  propertyHistoryStations,
  rematchEvents,
  propertyHourlyHistory,
  upsertStationObservations,
  saveHistoryCatalog,
  saveHistoryNormals,
  saveStationDaily,
  upsertSourceEvents,
  type SourceEventInput,
} from '../../packages/db/src';
import { HISTORY_PARAMETERS } from '../../packages/integrations/src';
import { buildApp } from '../../apps/api/src/app';

export function registerHistoryTests(pool: pg.Pool) {
  describe('property history on real PostgreSQL/PostGIS', () => {
    it('archives versions and closures, isolates organizations, keeps shared daily data, and cascades deletion', async () => {
      const a = await ensureOrganization(pool, 'org_historyAAAAAAAA');
      const b = await ensureOrganization(pool, 'org_historyBBBBBBBB');
      const orgA = { organizationId: a, userId: 'user_historyA' };
      const orgB = { organizationId: b, userId: 'user_historyB' };
      const property = await createProperty(pool, orgA, {
        name: 'Historiktest',
        address: 'Sveavägen 42, Stockholm',
        location: { lat: 59.3368, lon: 18.0627 },
        geocode: { provider: 'manual_pin', precision: 'building' },
      });
      const from = new Date(Date.now() - 2 * HISTORY.dayMs).toISOString();
      const to = new Date(Date.now() + HISTORY.dayMs).toISOString();
      const event: SourceEventInput = {
        externalId: 'history-versioned',
        dataClass: 'OFFICIAL_WARNING',
        category: 'Weather',
        level: 'Yellow',
        severity: 'monitor',
        eventType: 'Regn',
        headline: 'Regn',
        description: 'Officiell text\nbevaras exakt.',
        areaLabel: 'Stockholm',
        countyNames: [],
        geometryWkt: 'POLYGON((18 59.3,18.1 59.3,18.1 59.4,18 59.4,18 59.3))',
        geometry: null,
        publishedAt: from,
        sourceUpdatedAt: from,
        validFrom: from,
        validTo: to,
        status: 'active',
        sourceUrl: 'https://www.smhi.se',
        attribution: 'Källa: SMHI',
        extra: {},
      };
      await upsertSourceEvents(pool, 'smhi_warnings', [event]);
      await rematchEvents(pool);

      // Apply the actual migration to pre-existing matches in an isolated, rolled-back test schema.
      const migration = (await listMigrations()).find((m) => m.version === '0007')!;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('CREATE SCHEMA history_seed_test');
        await client.query('SET LOCAL search_path=history_seed_test,public');
        for (const name of [
          'organizations',
          'properties',
          'source_catalog',
          'source_events',
          'property_event_matches',
        ]) {
          await client.query(`CREATE TABLE ${name} (LIKE public.${name} INCLUDING ALL)`);
          await client.query(`INSERT INTO ${name} SELECT * FROM public.${name}`);
        }
        await client.query(migration.sql);
        const seeded = await client.query(
          `SELECT description FROM history_seed_test.property_event_history WHERE property_id=$1 AND external_id=$2`,
          [property.id, event.externalId],
        );
        assert.equal(seeded.rows[0].description, event.description);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }

      await upsertSourceEvents(pool, 'smhi_warnings', [
        { ...event, level: 'Orange', severity: 'warning', sourceUpdatedAt: new Date().toISOString() },
      ]);
      await rematchEvents(pool);
      await rematchEvents(pool);
      const period = { from: swedishDateKey(from), to: swedishDateKey(to) };
      const archive = (await propertyHistoryEvents(pool, a, property.id, period)).find(
        (e) => e.externalId === event.externalId,
      )!;
      assert.deepEqual(
        archive.versions.map((v) => v.level),
        ['Yellow', 'Orange'],
      );
      assert.equal(archive.versions[0].text, event.description);
      assert.deepEqual(await propertyHistoryEvents(pool, b, property.id, period), []);

      // Losing and regaining a match preserves both intervals without inventing a source version.
      await pool.query(
        `DELETE FROM property_event_matches WHERE property_id=$1 AND event_id IN (SELECT id FROM source_events WHERE external_id=$2)`,
        [property.id, event.externalId],
      );
      const unmatched = (await propertyHistoryEvents(pool, a, property.id, period)).find(
        (e) => e.externalId === event.externalId,
      )!;
      assert.ok(unmatched.versions.at(-1)!.matchedUntil);
      await rematchEvents(pool);
      const matchedAgain = (await propertyHistoryEvents(pool, a, property.id, period)).find(
        (e) => e.externalId === event.externalId,
      )!;
      assert.equal(matchedAgain.versions.length, 2);
      assert.equal(matchedAgain.versions.at(-1)!.matches.length, 2);
      assert.equal(matchedAgain.versions.at(-1)!.matchedUntil, null);

      // Traffic outside 1 km and informational traffic are deliberately absent from the archive.
      await upsertSourceEvents(pool, 'trafikverket', [
        {
          ...event,
          externalId: 'history-traffic-near',
          dataClass: 'PUBLIC_EVENT',
          category: 'Traffic',
          level: null,
          severity: 'warning',
          geometryWkt: 'POINT(18.0627 59.337)',
        },
        {
          ...event,
          externalId: 'history-traffic-far',
          dataClass: 'PUBLIC_EVENT',
          category: 'Traffic',
          level: null,
          severity: 'warning',
          geometryWkt: 'POINT(18.0627 59.350)',
        },
        {
          ...event,
          externalId: 'history-traffic-info',
          dataClass: 'PUBLIC_EVENT',
          category: 'Traffic',
          level: null,
          severity: 'info',
          geometryWkt: 'POINT(18.0627 59.337)',
        },
      ]);
      await rematchEvents(pool);
      const traffic = (await propertyHistoryEvents(pool, a, property.id, period)).filter(
        (e) => e.category === 'Traffic',
      );
      assert.deepEqual(
        traffic.map((e) => e.externalId),
        ['history-traffic-near'],
      );
      assert.equal(traffic[0].official, false);
      assert.equal(traffic[0].versions[0].level, 'Info');

      const date = addHistoryDays(swedishDateKey(new Date()), -1);
      await saveHistoryCatalog(pool, 'smhi_observations', 'precipitation', [
        {
          stationId: 'history-rain',
          name: 'Historikstation',
          lat: 59.34,
          lon: 18.06,
          from: '1991-01-01T00:00:00Z',
          to: new Date().toISOString(),
        },
      ]);
      const days = Array.from({ length: 365 }, (_, i) => ({
        date: addHistoryDays(date, -i),
        value: i % 3,
        coverage: 1,
        origin: 'smhi_archive' as const,
      }));
      await saveStationDaily(pool, 'smhi_observations', 'history-rain', 'precipitation', 'smhi_06_utc', days);
      await saveHistoryNormals(
        pool,
        'history-rain',
        Array.from({ length: 12 }, (_, i) => ({ month: i + 1, value: 50, years: 24 })),
        true,
      );
      const parameters = HISTORY_PARAMETERS.filter((p) => p.key === 'precipitation');
      assert.ok((await historyBackfillTargets(pool, parameters)).some((t) => t.stationId === 'history-rain'));
      assert.ok(
        (await propertyHistoryStations(pool, a, property.id, parameters)).some((s) => s.historyDays >= 300),
      );
      assert.deepEqual(await propertyHistoryStations(pool, b, property.id, parameters), []);

      const app = await buildApp(loadServerEnv({ NODE_ENV: 'test' }), {
        logger: false,
        db: pool,
        verifyAuth: async (req) => ({
          userId: 'user_history',
          sessionId: 'session_history',
          clerkOrgId:
            req.headers.authorization === 'Bearer b' ? 'org_historyBBBBBBBB' : 'org_historyAAAAAAAA',
          orgRole: 'org:admin',
          orgSlug: 'history',
        }),
      });
      try {
        const url = `/v1/properties/${property.id}/history?range=12m`;
        const response = await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer a' } });
        assert.equal(response.statusCode, 200, response.body);
        const h = PropertyHistorySchema.parse(response.json());
        assert.equal(h.daily.dates.length, 365);
        assert.equal(h.stations[0].name, 'Historikstation');
        assert.ok(h.events.some((e) => e.externalId === event.externalId));
        assert.ok(Buffer.byteLength(response.body) < 50 * 1024);
        assert.equal(
          (await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer b' } })).statusCode,
          404,
        );
      } finally {
        await app.close();
      }

      await endMissingEvents(pool, 'smhi_warnings', []);
      await rematchEvents(pool);
      const closed = (await propertyHistoryEvents(pool, a, property.id, period)).find(
        (e) => e.externalId === event.externalId,
      )!;
      assert.ok(closed.versions.every((v) => v.endType === 'ended' && v.endedAt));
      await pool.query(`UPDATE source_events SET ended_at=now()-interval '8 days' WHERE external_id=$1`, [
        event.externalId,
      ]);
      await applyRetention(pool);
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM property_event_history WHERE property_id=$1 AND external_id=$2',
            [property.id, event.externalId],
          )
        ).rows[0].n,
        2,
        'survives source-event deletion',
      );

      // Retention and aggregation are exercised before raw data cleanup.
      await pool.query(
        `INSERT INTO observation_history(source_id,station_id,parameter,observed_at,value)
        SELECT 'smhi_observations','aggregate-history','precipitation_15min',t,1
        FROM generate_series((($1::date)::timestamp AT TIME ZONE 'Europe/Stockholm')+interval '15 minutes',
          (($1::date+1)::timestamp AT TIME ZONE 'Europe/Stockholm'),interval '15 minutes') t`,
        [date],
      );
      await aggregateStoredHistory(pool);
      const aggregate = await pool.query(
        `SELECT value,coverage,day_definition FROM station_daily WHERE station_id='aggregate-history'`,
      );
      assert.equal(aggregate.rows[0].value, 96);
      assert.equal(aggregate.rows[0].coverage, 1);
      assert.equal(aggregate.rows[0].day_definition, 'swedish_calendar');
      await upsertStationObservations(pool, 'smhi_observations', [
        {
          stationId: 'aggregate-history',
          parameter: 'precipitation_15min',
          name: 'Timstation',
          lat: 59.3368,
          lon: 18.0627,
          value: 1,
          unit: 'mm',
          observedAt: new Date().toISOString(),
          quality: 'G',
          extra: {},
        },
      ]);
      // The stored test quarters above have no quality flag; only published G/Y data qualifies for complete hours.
      await pool.query(`UPDATE observation_history SET quality='G' WHERE station_id='aggregate-history'`);
      const hourlyPeriod = { from: date, to: date };
      const hourly = await propertyHourlyHistory(pool, a, property.id, hourlyPeriod);
      assert.equal(hourly!.values.length, 24);
      assert.ok(hourly!.values.every((v) => v === 4));
      assert.equal(await propertyHourlyHistory(pool, b, property.id, hourlyPeriod), null);
      await pool.query(
        `DELETE FROM observation_history WHERE station_id='aggregate-history' AND observed_at=(($1::date)::timestamp AT TIME ZONE 'Europe/Stockholm')+interval '15 minutes'`,
        [date],
      );
      const incompleteHour = await propertyHourlyHistory(pool, a, property.id, hourlyPeriod);
      assert.equal(incompleteHour!.values[0], null);
      assert.equal(incompleteHour!.coverage[0], 0.75);
      await pool.query(`INSERT INTO station_daily(source_id,station_id,parameter,day_definition,date,value,coverage,origin)
        VALUES('smhi_observations','expired-history','precipitation','smhi_06_utc',(now()-interval '6 years')::date,2,1,'smhi_archive')`);
      await pool.query(
        `UPDATE property_event_history SET ended_at=now()-interval '25 months',valid_to=now()-interval '25 months' WHERE external_id=$1`,
        [event.externalId],
      );
      const deleted = await applyRetention(pool);
      assert.ok(deleted.eventHistory >= 2);
      assert.equal(deleted.stationDaily, 1);
      await deleteProperty(pool, orgB, property.id);
      assert.ok(
        (await pool.query('SELECT 1 FROM property_event_history WHERE property_id=$1', [property.id])).rows
          .length > 0,
        'other org cannot delete',
      );
      await deleteProperty(pool, orgA, property.id);
      assert.equal(
        (await pool.query('SELECT 1 FROM property_event_history WHERE property_id=$1', [property.id])).rows
          .length,
        0,
      );
      assert.equal(
        (await pool.query(`SELECT count(*)::int AS n FROM station_daily WHERE station_id='history-rain'`))
          .rows[0].n,
        365,
        'public station data remains shared',
      );
    });
  });
}
