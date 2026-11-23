import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type pg from "pg";
import { loadServerEnv } from "../../packages/config/src";
import {
  createProperty,
  ensureOrganization,
  rematchEvents,
  upsertPropertyForecast,
  upsertSourceEvents,
  type SourceEventInput,
} from "../../packages/db/src";
import { buildApp } from "../../apps/api/src/app";
import { NotificationService } from "../../apps/api/src/notifications/service";
import { FakeVerificationProvider } from "../../apps/api/src/notifications/verification";
import { saveRule } from "../../apps/api/src/notifications/store";
import { eventLinkKey, GROUP_USED_BY_SMS_RULES, type NotificationRuleInput } from "../../packages/domain/src";

export function registerNotificationTests(pool: pg.Pool) {
  describe("Phase 4 notifications on real PostgreSQL/PostGIS", () => {
    async function fixture(
      extra: Record<string, string> = {},
      fake?: FakeVerificationProvider,
    ) {
      const clerkOrg = `org_sms${randomUUID().replaceAll("-", "")}`,
        otherClerk = `org_sms${randomUUID().replaceAll("-", "")}`;
      const org = await ensureOrganization(pool, clerkOrg),
        other = await ensureOrganization(pool, otherClerk);
      const env = loadServerEnv({
        NODE_ENV: "test",
        SMS_ESTIMATED_PRICE_PER_PART_SEK: "1",
        SMS_MAX_MESSAGES_PER_MINUTE: "100",
        ...extra,
      });
      const app = await buildApp(env, {
        db: pool,
        logger: false,
        verification: fake,
        verifyAuth: async (req) => {
          const token = req.headers.authorization;
          if (!token) return null;
          return {
            userId: "user_smsAdmin",
            sessionId: "session_sms",
            clerkOrgId: token === "Bearer other" ? otherClerk : clerkOrg,
            orgSlug: "test",
            orgRole: token === "Bearer member" ? "org:member" : "org:admin",
          };
        },
      });
      const request = async (
        method: "GET" | "POST" | "PATCH" | "DELETE",
        path: string,
        body?: unknown,
        token = "admin",
      ) =>
        app.inject({
          method,
          url: `/v1/notifications${path}`,
          headers: { authorization: `Bearer ${token}` },
          ...(body === undefined
            ? {}
            : { payload: body as Record<string, unknown> }),
        });
      const p = await createProperty(
        pool,
        { organizationId: org, userId: "user_smsAdmin" },
        {
          name: "SMS testfastighet",
          address: "Testgatan 1",
          location: { lat: 59.3, lon: 18 },
          geocode: { provider: "manual_pin", precision: "unknown" },
        },
      );
      const p2 = await createProperty(
        pool,
        { organizationId: org, userId: "user_smsAdmin" },
        {
          name: "SMS testfastighet 2",
          address: "Testgatan 2",
          location: { lat: 59.301, lon: 18 },
          geocode: { provider: "manual_pin", precision: "unknown" },
        },
      );
      const response = await request("POST", "/recipients", {
        phone: "0701234567",
        consent: true,
      });
      assert.equal(response.statusCode, 201, response.body);
      const recipient = response.json().recipient.id as string;
      const config: NotificationRuleInput = {
        name: "Officiella varningar",
        enabled: true,
        scope: "selected",
        propertyIds: [p.id, p2.id],
        recipientIds: [recipient],
        condition: {
          category: "smhi_warning",
          levels: ["Orange", "Red"],
          updates: true,
          cancellations: true,
        },
        cooldownMinutes: 360,
        quietHours: {
          enabled: false,
          start: "22:00",
          end: "07:00",
          emergencyException: false,
        },
        groupProperties: true,
        dailyPropertyLimit: 3,
        dailyRecipientLimit: 5,
      };
      const service = new NotificationService(pool, env);
      const eventId = `sms-${randomUUID()}`;
      const event = (
        patch: Partial<SourceEventInput> = {},
      ): SourceEventInput => ({
        externalId: eventId,
        dataClass: "OFFICIAL_WARNING",
        category: "Weather",
        level: "Orange",
        severity: "warning",
        eventType: "SNOW",
        headline: "Testfixture för officiell snövarning",
        description: "Isolerad testdata, inte en riktig varning",
        areaLabel: "Testpolygon",
        countyNames: [],
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [17.9, 59.2],
              [18.1, 59.2],
              [18.1, 59.4],
              [17.9, 59.4],
              [17.9, 59.2],
            ],
          ],
        },
        publishedAt: new Date().toISOString(),
        sourceUpdatedAt: new Date().toISOString(),
        validFrom: new Date().toISOString(),
        validTo: new Date(Date.now() + 3600000).toISOString(),
        status: "active",
        sourceUrl: "https://www.smhi.se/",
        attribution: "SMHI testfixture",
        extra: {},
        ...patch,
      });
      let saved: SourceEventInput | undefined;
      const publish = async (patch: Partial<SourceEventInput> = {}) => {
        saved = { ...(saved ?? event()), ...patch };
        await upsertSourceEvents(pool, "smhi_warnings", [saved]);
        await rematchEvents(pool);
      };
      const dispose = async () => {
        await app.close();
        await pool.query("DELETE FROM organizations WHERE id=ANY($1::uuid[])", [
          [org, other],
        ]);
        await pool.query("DELETE FROM source_events WHERE external_id=$1", [
          eventId,
        ]);
      };
      return {
        app,
        request,
        org,
        other,
        p,
        p2,
        recipient,
        config,
        service,
        publish,
        dispose,
        eventId,
      };
    }
    it("persists CRUD/scopes and rejects member/cross-tenant recipient and property changes", async () => {
      const f = await fixture();
      try {
        const created = await f.request("POST", "/rules", f.config);
        assert.equal(created.statusCode, 201, created.body);
        const id = created.json().id;
        assert.equal((await f.request("GET", "/rules")).json().rules.length, 1);
        assert.equal(
          (await f.request("GET", "/rules", undefined, "other")).json().rules
            .length,
          0,
        );
        assert.equal(
          (await f.request("GET", "/recipients", undefined, "other")).json()
            .recipients.length,
          0,
        );
        for (const [method, path, body] of [
          ["PATCH", `/rules/${id}`, { enabled: false }],
          ["DELETE", `/rules/${id}`, undefined],
          [
            "PATCH",
            `/recipients/${f.recipient}`,
            { phone: "0701234567", consent: false },
          ],
        ] as const)
          assert.equal(
            (await f.request(method, path, body, "member")).statusCode,
            403,
          );
        assert.equal(
          (
            await f.request(
              "PATCH",
              `/rules/${id}`,
              { enabled: false },
              "other",
            )
          ).statusCode,
          404,
        );
        assert.equal(
          (
            await f.request(
              "PATCH",
              `/recipients/${f.recipient}`,
              { phone: "0701234567", consent: false },
              "other",
            )
          ).statusCode,
          404,
        );
        assert.equal(
          (await f.request("POST", "/rules", f.config, "other")).statusCode,
          400,
        );
        assert.equal(
          (
            await f.request("PATCH", `/rules/${id}`, {
              ...f.config,
              name: "Ändrad",
            })
          ).statusCode,
          200,
        );
        const dashboard = (await f.request("GET", "")).json();
        assert.equal(dashboard.rules[0].name, "Ändrad");
        assert.ok(!JSON.stringify(dashboard).includes("+46701234567"));
        assert.equal(dashboard.usage.realCostSek, 0);
        // Composite foreign keys enforce tenant ownership even if application validation is bypassed.
        await assert.rejects(
          pool.query(
            "INSERT INTO alert_rule_properties(organization_id,rule_id,property_id) VALUES($1,$2,$3)",
            [f.other, id, f.p.id],
          ),
          /foreign key/,
        );
        assert.equal(
          (await f.request("DELETE", `/rules/${id}`)).statusCode,
          204,
        );
        assert.equal((await f.request("GET", "/rules")).json().rules.length, 0);
      } finally {
        await f.dispose();
      }
    });
    it("keeps all-current scopes frozen when toggled and includes future properties only by opt-in", async () => {
      const f = await fixture();
      try {
        const id = await saveRule(pool, f.org, {
          ...f.config,
          scope: "all_current",
        });
        const next = await createProperty(
          pool,
          { organizationId: f.org, userId: "user_smsAdmin" },
          {
            name: "Ny fastighet",
            address: "Ny 1",
            location: { lat: 59.3, lon: 18 },
            geocode: { provider: "manual_pin", precision: "unknown" },
          },
        );
        assert.equal(
          (await f.request("PATCH", `/rules/${id}`, { enabled: false }))
            .statusCode,
          200,
        );
        assert.equal(
          (await f.request("GET", "/rules")).json().rules[0].propertyIds.length,
          2,
        );
        const future = await saveRule(pool, f.org, {
          ...f.config,
          scope: "all_future",
        });
        await f.publish();
        await f.service.evaluateOrganization(f.org);
        await f.service.processOutbox();
        const rows = await pool.query(
          "SELECT p.property_id FROM notification_properties p JOIN notification_outbox n ON n.id=p.notification_id WHERE n.organization_id=$1 AND n.rule_id=$2",
          [f.org, future],
        );
        assert.ok(rows.rows.some((r) => r.property_id === next.id));
      } finally {
        await f.dispose();
      }
    });
    it("evaluates group rules against current members and scopes preview, test and activity to them", async () => {
      const f = await fixture();
      try {
        const group = await f.app.inject({ method: "POST", url: "/v1/property-groups", headers: { authorization: "Bearer admin" },
          payload: { name: "Innerstad", propertyIds: [f.p.id] } });
        assert.equal(group.statusCode, 201, group.body);
        const groupId = group.json().group.id as string;
        const response = await f.request("POST", "/rules", { ...f.config, scope: "group", groupId, dailyPropertyLimit: 10, dailyRecipientLimit: 10 });
        assert.equal(response.statusCode, 201, response.body);
        const id = response.json().id as string;
        const saved = (await f.request("GET", "/rules")).json().rules[0];
        assert.equal(saved.groupId, groupId);
        assert.deepEqual(saved.propertyIds, [], "Group membership is never saved as explicit property links");
        const dashboard = (await f.request("GET", "")).json();
        assert.deepEqual(dashboard.groups, [{ id: groupId, name: "Innerstad", propertyCount: 1 }]);
        assert.deepEqual(dashboard.properties.find((p: { id: string }) => p.id === f.p.id).groupIds, [groupId]);

        async function members(propertyIds: string[]) {
          const res = await f.app.inject({ method: "PUT", url: `/v1/property-groups/${groupId}/properties`,
            headers: { authorization: "Bearer admin" }, payload: { propertyIds } });
          assert.equal(res.statusCode, 200, res.body);
        }
        async function checkMatchingNames(headline: string, expected: string[]) {
          await f.publish({ headline });
          await f.service.evaluateOrganization(f.org);
          const { rows } = await pool.query<{ property_names: string[] }>(
            "SELECT property_names FROM notification_outbox WHERE organization_id=$1 AND rule_id=$2 AND NOT is_test ORDER BY created_at DESC LIMIT 1",
            [f.org, id],
          );
          assert.deepEqual([...rows[0]!.property_names].sort(), [...expected].sort());
        }
        await checkMatchingNames("Sommarens första testvarning", [f.p.name]);
        await members([f.p.id, f.p2.id]);
        await checkMatchingNames("Gruppen har fått en ny medlem", [f.p.name, f.p2.name]);
        await members([f.p2.id]);
        await checkMatchingNames("Gruppen har tagit bort första medlemmen", [f.p2.name]);
        const preview = (await f.request("POST", `/rules/${id}/preview`)).json();
        assert.equal(preview.propertyCount, 1);
        assert.ok(preview.message.includes(f.p2.name));
        const test = await f.request("POST", `/rules/${id}/test`, {});
        assert.equal(test.statusCode, 200, test.body);
        assert.deepEqual(test.json(), { generated: 1, propertyCount: 1, mode: "simulated" });
        assert.deepEqual((await f.service.activity(f.org)).find((a) => a.isTest)?.propertyNames, [f.p2.name]);
        await pool.query("UPDATE properties SET sms_notifications_paused=true WHERE organization_id=$1 AND id=$2", [f.org, f.p2.id]);
        const pausedPreview = await f.request("POST", `/rules/${id}/preview`);
        assert.equal(pausedPreview.statusCode, 200, pausedPreview.body);
        assert.equal(pausedPreview.json().propertyCount, 0);
        assert.equal(pausedPreview.json().eligible, false);
      } finally {
        await f.dispose();
      }
    });
    it("rejects foreign groups and prevents deleting a group used by a saved rule", async () => {
      const f = await fixture();
      try {
        const auth = (tenant: string) => ({ authorization: `Bearer ${tenant}` });
        const group = await f.app.inject({ method: "POST", url: "/v1/property-groups", headers: auth("admin"), payload: { name: "Innerstad" } });
        assert.equal(group.statusCode, 201, group.body);
        const groupId = group.json().group.id as string;
        const other = await f.request("POST", "/recipients", { phone: "0701234567", consent: true }, "other");
        assert.equal(other.statusCode, 201, other.body);
        const input = { ...f.config, scope: "group", groupId, propertyIds: [], enabled: false };
        assert.equal((await f.request("POST", "/rules", { ...input, recipientIds: [other.json().recipient.id] }, "other")).statusCode, 404);
        const saved = await f.request("POST", "/rules", input);
        assert.equal(saved.statusCode, 201, saved.body);
        const path = `/v1/property-groups/${groupId}`;
        assert.equal((await f.app.inject({ method: "DELETE", url: path, headers: auth("other") })).statusCode, 404);
        const blocked = await f.app.inject({ method: "DELETE", url: path, headers: auth("admin") });
        assert.equal(blocked.statusCode, 409, blocked.body);
        assert.equal(blocked.json().type, GROUP_USED_BY_SMS_RULES);
        assert.ok(blocked.json().detail.includes(f.config.name));
        assert.equal((await f.request("PATCH", `/rules/${saved.json().id}`, f.config)).statusCode, 200);
        assert.equal((await f.app.inject({ method: "DELETE", url: path, headers: auth("admin") })).statusCode, 204);
      } finally {
        await f.dispose();
      }
    });
    it("consumes Phase 3 geographic changes atomically, groups properties, dedupes polling/restarts and applies cooldown", async () => {
      const f = await fixture();
      try {
        await saveRule(pool, f.org, f.config);
        await f.publish();
        await Promise.all([
          f.service.evaluateOrganization(f.org),
          new NotificationService(pool, f.service.env).evaluateOrganization(
            f.org,
          ),
        ]);
        let out = (
          await pool.query(
            "SELECT * FROM notification_outbox WHERE organization_id=$1",
            [f.org],
          )
        ).rows;
        assert.equal(out.length, 1);
        assert.equal(out[0].property_names.length, 2);
        assert.equal(out[0].verification_required, true);
        await f.service.processOutbox();
        assert.equal((await f.service.activity(f.org))[0].status, "simulated");
        await f.publish();
        await f.service.evaluateOrganization(f.org);
        assert.equal((await f.service.activity(f.org)).length, 1);
        await f.publish({
          headline: "Materiellt uppdaterad officiell testvarning",
        });
        await f.service.evaluateOrganization(f.org);
        assert.ok(
          (await f.service.activity(f.org)).some(
            (a) => a.status === "suppressed_cooldown",
          ),
        );
        out = (
          await pool.query(
            "SELECT message FROM notification_outbox WHERE organization_id=$1",
            [f.org],
          )
        ).rows;
        assert.ok(out.every((r) => r.message === null));
        assert.equal((await f.service.usage(f.org)).simulated, 1);
      } finally {
        await f.dispose();
      }
    });
    it("links a grouped SMS to the event page and a single-property SMS to the property (Fas 2 / S-09)", async () => {
      const f = await fixture();
      try {
        const grouped = await saveRule(pool, f.org, f.config);
        const single = await saveRule(pool, f.org, { ...f.config, name: "En fastighet", propertyIds: [f.config.propertyIds[0]!] });
        await f.publish();
        const { rows } = await pool.query<{ id: string }>("SELECT id::text FROM source_events WHERE external_id=$1", [f.eventId]);
        const key = eventLinkKey(rows[0]!.id)!;
        const groupedText = (await f.service.preview(f.org, grouped)).message;
        assert.ok(groupedText.includes(`/h/${key}`), groupedText);
        const singleText = (await f.service.preview(f.org, single)).message;
        assert.ok(/\/p\/[a-f0-9]{16}/.test(singleText) && !singleText.includes("/h/"), singleText);
        // The short link resolves only for the organization the event reached.
        const own = await f.app.inject({ method: "GET", url: `/v1/events/links/${key}`, headers: { authorization: "Bearer admin" } });
        assert.equal(own.statusCode, 200, own.body);
        assert.equal(own.json().id, rows[0]!.id);
        const page = await f.app.inject({ method: "GET", url: `/v1/events/${rows[0]!.id}`, headers: { authorization: "Bearer admin" } });
        assert.equal(page.statusCode, 200, page.body);
        assert.equal(page.json().properties.length, 2);
        assert.equal(page.json().event.description, "Isolerad testdata, inte en riktig varning");
        assert.ok(page.json().properties.every((p: { ackRequired: boolean; changeId: string | null }) => p.ackRequired && p.changeId));
        assert.equal((await f.app.inject({ method: "GET", url: `/v1/events/links/${key}`, headers: { authorization: "Bearer other" } })).statusCode, 404);
        assert.equal((await f.app.inject({ method: "GET", url: `/v1/events/${rows[0]!.id}`, headers: { authorization: "Bearer other" } })).statusCode, 404);
      } finally {
        await f.dispose();
      }
    });

    it("Fas 5: a large event queues instead of dropping, VMA passes the daily caps, a group drops only properties over their cap, VMA goes first", async (t) => {
      const f = await fixture();
      const day = "(now() AT TIME ZONE 'UTC')::date";
      try {
        const ids = [f.p.id, f.p2.id];
        for (let i = 0; i < 298; i++) {
          ids.push((await createProperty(pool, { organizationId: f.org, userId: "user_smsAdmin" }, {
            name: `Länsfastighet ${i}`, address: `Länsgatan ${i}`,
            location: { lat: 59.21 + (i % 20) * 0.008, lon: 17.91 + Math.floor(i / 20) * 0.012 },
            geocode: { provider: "manual_pin", precision: "unknown" },
          })).id);
        }
        const byRule = async (rule: string) => (await pool.query<{ status: string; n: number; detail: string | null }>(
          "SELECT status, cardinality(property_names) AS n, detail FROM notification_outbox WHERE organization_id=$1 AND rule_id=$2 ORDER BY created_at", [f.org, rule])).rows;
        // The platform minute is full, and five properties already had their three SMS today.
        await pool.query("INSERT INTO notification_rate_buckets(minute,messages) VALUES(date_trunc('minute',now()),100) ON CONFLICT(minute) DO UPDATE SET messages=100");
        await pool.query(`INSERT INTO notification_daily_usage(organization_id,day,scope_key,messages,estimated_cost_sek) SELECT $1,${day},'property:'||x,3,0 FROM unnest($2::uuid[]) x`, [f.org, ids.slice(0, 5)]);
        const grouped = await saveRule(pool, f.org, { ...f.config, name: "Samlad länsvarning", propertyIds: ids });
        await f.publish();
        let t0 = performance.now();
        await f.service.evaluateOrganization(f.org);
        const groupedMs = Math.round(performance.now() - t0);
        const g = await byRule(grouped);
        t.diagnostic(`grouped Orange over 300 (minute full, 5 at cap): ${JSON.stringify(g)} in ${groupedMs} ms`);

        // The recipient has used its daily SMS and the organization its day: a VMA arrives.
        const phoneKey = `recipient:${createHash("sha256").update("+46701234567").digest("hex")}`;
        await pool.query(`INSERT INTO notification_daily_usage(organization_id,day,scope_key,messages,estimated_cost_sek) VALUES($1,${day},$2,20,0),($1,${day},'org',20,0)
          ON CONFLICT(organization_id,day,scope_key) DO UPDATE SET messages=20`, [f.org, phoneKey]);
        const vmaRule = await saveRule(pool, f.org, { ...f.config, name: "VMA", propertyIds: ids, condition: { category: "vma", updates: true, cancellations: true } as NotificationRuleInput["condition"] });
        const vmaId = `vma-${randomUUID()}`;
        await upsertSourceEvents(pool, "krisinformation", [{
          externalId: vmaId, dataClass: "OFFICIAL_WARNING", category: "Crisis", level: "VMA", severity: "critical", eventType: "VMA",
          headline: "Testfixture VMA", description: "Isolerad testdata", areaLabel: "Hela landet", countyNames: ["*"],
          geometry: { type: "Polygon", coordinates: [[[17.9, 59.2], [18.1, 59.2], [18.1, 59.4], [17.9, 59.4], [17.9, 59.2]]] },
          publishedAt: new Date().toISOString(), sourceUpdatedAt: new Date().toISOString(), validFrom: new Date().toISOString(),
          validTo: new Date(Date.now() + 3600000).toISOString(), status: "active", sourceUrl: null, attribution: "Testfixture", extra: {},
        }]);
        await rematchEvents(pool);
        await f.service.evaluateOrganization(f.org);
        const v = await byRule(vmaRule);
        t.diagnostic(`VMA after the daily caps: ${JSON.stringify(v)}`);

        // One more message fits in this minute: the VMA must go before the earlier Orange warning.
        await pool.query("UPDATE notification_rate_buckets SET messages=$1 WHERE minute=date_trunc('minute',now())", [f.service.env.SMS_MAX_MESSAGES_PER_MINUTE - 1]);
        await f.service.processOutbox();
        const sent = (await pool.query<{ rule_name: string; status: string }>(
          "SELECT rule_name, status FROM notification_outbox WHERE organization_id=$1 AND status='simulated' ORDER BY updated_at", [f.org])).rows;
        t.diagnostic(`sent with one free slot: ${JSON.stringify(sent)}`);

        assert.deepEqual(g.map((r) => [r.status, r.n]), [["queued", 295]], "queued for the 295 properties under their cap");
        assert.match(g[0]!.detail ?? "", /5 fastigheter/);
        assert.equal(v[0]?.status === "queued" || v[0]?.status === "simulated", true, "the VMA is not stopped by the daily caps");
        assert.deepEqual(sent.map((r) => r.rule_name), ["VMA"], "only the VMA in the one free slot");
        await pool.query("UPDATE notification_rate_buckets SET messages=0 WHERE minute=date_trunc('minute',now())");
        t0 = performance.now();
        await f.service.processOutbox();
        t.diagnostic(`drained the rest in ${Math.round(performance.now() - t0)} ms`);
        await pool.query(`DELETE FROM source_events WHERE external_id=$1`, [vmaId]);
      } finally {
        await pool.query("DELETE FROM notification_rate_buckets WHERE minute>=date_trunc('minute',now()-interval '2 minutes')");
        await f.dispose();
      }
    });

    it("Fas 5: an ungrouped rule over 300 properties is evaluated without holding up others for long", async (t) => {
      const f = await fixture();
      try {
        const ids = [f.p.id, f.p2.id];
        for (let i = 0; i < 298; i++) {
          ids.push((await createProperty(pool, { organizationId: f.org, userId: "user_smsAdmin" }, {
            name: `Ensam ${i}`, address: `Ensamgatan ${i}`,
            location: { lat: 59.21 + (i % 20) * 0.008, lon: 17.91 + Math.floor(i / 20) * 0.012 },
            geocode: { provider: "manual_pin", precision: "unknown" },
          })).id);
        }
        const rule = await saveRule(pool, f.org, { ...f.config, name: "En per fastighet", propertyIds: ids, groupProperties: false });
        await f.publish();
        const t0 = performance.now();
        await f.service.evaluateOrganization(f.org);
        const ms = Math.round(performance.now() - t0);
        const rows = (await pool.query<{ status: string; n: number }>(
          "SELECT status, count(*)::int AS n FROM notification_outbox WHERE organization_id=$1 AND rule_id=$2 GROUP BY status ORDER BY status", [f.org, rule])).rows;
        t.diagnostic(`ungrouped Orange over 300: ${JSON.stringify(rows)} in ${ms} ms`);
        assert.equal(rows.reduce((a, r) => a + r.n, 0), 300);
      } finally {
        await pool.query("DELETE FROM notification_rate_buckets WHERE minute>=date_trunc('minute',now()-interval '2 minutes')");
        await f.dispose();
      }
    });

    it("does not backfill old events, suppresses quiet hours permanently and enforces daily/monthly/cost caps", async () => {
      for (const type of [
        "old",
        "quiet",
        "daily",
        "monthly",
        "cost",
      ] as const) {
        const f = await fixture(
          type === "daily"
            ? { SMS_DAILY_LIMIT_PER_ORG: "0" }
            : type === "monthly"
              ? { SMS_SIMULATION_MONTHLY_LIMIT: "0" }
              : type === "cost"
                ? {
                    SMS_MAX_GLOBAL_MONTHLY_COST_SEK: "1",
                    SMS_ESTIMATED_PRICE_PER_PART_SEK: "10",
                  }
                : {},
        );
        try {
          if (type === "old") await f.publish();
          const id = await saveRule(pool, f.org, {
            ...f.config,
            quietHours: {
              ...f.config.quietHours,
              enabled: type === "quiet",
              start: "00:00",
              end: "23:59",
            },
          });
          if (type !== "old") await f.publish();
          await f.service.evaluateOrganization(f.org);
          const rows = await f.service.activity(f.org);
          if (type === "old") assert.equal(rows.length, 0);
          else
            assert.equal(
              rows[0].status,
              type === "quiet"
                ? "suppressed_quiet_hours"
                : type === "cost"
                  ? "suppressed_cost"
                  : "suppressed_limit",
            );
          assert.equal((await f.service.usage(f.org)).simulated, 0);
          if (type === "quiet") {
            // Ending quiet hours does not replay the consumed transition.
            await pool.query(
              "UPDATE alert_rules SET config=jsonb_set(config,'{quietHours,enabled}','false') WHERE organization_id=$1 AND id=$2",
              [f.org, id],
            );
            await f.service.evaluateOrganization(f.org);
            assert.equal((await f.service.activity(f.org)).length, 1);
          }
        } finally {
          await f.dispose();
        }
      }
    });
    it("persists forecast baseline and crossing state through worker restart", async () => {
      const f = await fixture();
      try {
        await saveRule(pool, f.org, {
          ...f.config,
          condition: {
            category: "forecast",
            metric: "windGust",
            operator: "gt",
            threshold: 25,
            hours: 1,
            hysteresis: 2,
          },
        });
        const referenceTime = new Date().toISOString();
        const put = async (windGust: number) =>
          upsertPropertyForecast(pool, {
            propertyId: f.p.id,
            organizationId: f.org,
            sourceId: "smhi_forecast",
            referenceTime,
            createdTime: referenceTime,
            grid: null,
            series: {
              v: 1,
              steps: [
                {
                  time: new Date(Date.now() + 3600000).toISOString(),
                  intervalStart: referenceTime,
                  windGust,
                },
              ],
            },
          });
        await put(20);
        await f.service.evaluateOrganization(f.org);
        assert.equal((await f.service.activity(f.org)).length, 0);
        await put(30);
        await new NotificationService(pool, f.service.env).evaluateOrganization(
          f.org,
        );
        assert.equal((await f.service.activity(f.org)).length, 1);
        await put(31);
        await f.service.evaluateOrganization(f.org);
        assert.equal((await f.service.activity(f.org)).length, 1);
        await put(22);
        await f.service.evaluateOrganization(f.org);
        await put(30);
        await f.service.evaluateOrganization(f.org);
        assert.equal((await f.service.activity(f.org)).length, 2);
      } finally {
        await f.dispose();
      }
    });
    it("enforces recipient/property frequency and global per-minute limits with durable reservations", async () => {
      for (const scope of ["recipient", "property", "minute"] as const) {
        const f = await fixture(
          scope === "minute" ? { SMS_MAX_MESSAGES_PER_MINUTE: "0" } : {},
        );
        try {
          const id = await saveRule(pool, f.org, {
            ...f.config,
            dailyRecipientLimit: scope === "recipient" ? 1 : 10,
            dailyPropertyLimit: scope === "property" ? 1 : 10,
          });
          await f.publish();
          await f.service.evaluateOrganization(f.org, id);
          await f.service.evaluateOrganization(f.org, id);
          const rows = await f.service.activity(f.org);
          if (scope === "minute") {
            // Over the per-minute rate a message waits in the queue instead of being dropped (Fas 5 / S-23).
            assert.equal(rows.filter((r) => r.status === "queued").length, 2);
            assert.ok(!rows.some((r) => r.status === "suppressed_limit"));
            assert.equal(await f.service.processOutbox(), 0, "nothing is sent while the minute is full");
            assert.equal((await f.service.activity(f.org)).filter((r) => r.status === "queued").length, 2);
          } else {
            assert.equal(rows.filter((r) => r.status === "queued").length, 1);
            assert.ok(rows.some((r) => r.status === "suppressed_limit"));
          }
        } finally {
          await f.dispose();
        }
      }
    });
    it("rechecks source validity and property opt-out before processing queued work", async () => {
      for (const reason of ["expired", "paused"] as const) {
        const f = await fixture();
        try {
          await saveRule(pool, f.org, f.config);
          await f.publish();
          await f.service.evaluateOrganization(f.org);
          if (reason === "expired") await f.publish({ status: "cancelled" });
          else
            await f.request("PATCH", `/properties/${f.p.id}`, {
              enabled: false,
            });
          await f.service.processOutbox();
          assert.equal(
            (await f.service.activity(f.org))[0].status,
            "not_eligible",
          );
        } finally {
          await f.dispose();
        }
      }
    });
    it("simulates failures/timeouts, bounds retries and safely recovers expired worker leases", async () => {
      const f = await fixture();
      try {
        f.config.dailyPropertyLimit = 10;
        f.config.dailyRecipientLimit = 10;
        const id = await saveRule(pool, f.org, f.config);
        await f.publish();
        for (const scenario of ["failure", "timeout", "unavailable"] as const) {
          await f.service.evaluateOrganization(f.org, id, scenario);
          await f.service.processOutbox();
        }
        let activity = await f.service.activity(f.org);
        assert.ok(activity.some((a) => a.status === "simulated_failure"));
        assert.ok(activity.some((a) => a.status === "unknown"));
        assert.ok(activity.some((a) => a.status === "retry"));
        for (let i = 0; i < 3; i++) {
          await pool.query(
            "UPDATE notification_outbox SET next_attempt_at=now() WHERE organization_id=$1 AND status='retry'",
            [f.org],
          );
          await new NotificationService(pool, f.service.env).processOutbox();
        }
        activity = await f.service.activity(f.org);
        assert.ok(activity.some((a) => a.status === "failed"));
        assert.ok(!activity.some((a) => a.status === "retry"));
        // Restart after a local simulator lease was claimed, before its result was stored.
        await f.service.evaluateOrganization(f.org, id, "success");
        await pool.query(
          "UPDATE notification_outbox SET status='processing',attempt_count=1,lease_owner='crashed',lease_until=now()-interval '1 minute' WHERE organization_id=$1 AND status='queued'",
          [f.org],
        );
        await new NotificationService(pool, f.service.env).processOutbox();
        assert.ok(
          (await f.service.activity(f.org)).some(
            (a) => a.status === "simulated",
          ),
        );
        assert.equal((await f.service.usage(f.org)).simulated, 4);
        const unknown = (
          await pool.query(
            "SELECT attempt_count FROM notification_outbox WHERE organization_id=$1 AND status='unknown'",
            [f.org],
          )
        ).rows;
        assert.equal(unknown[0].attempt_count, 1);
      } finally {
        await f.dispose();
      }
    });
    it("requires a real verification channel, expires OTPs, commits failed attempt limits and resets on edit", async () => {
      const noChannel = await fixture();
      try {
        const r = await noChannel.request(
          "POST",
          `/recipients/${noChannel.recipient}/verification`,
          {},
        );
        assert.equal(r.json().channelAvailable, false);
        assert.equal(
          (await noChannel.request("GET", "/recipients")).json().recipients[0]
            .verificationStatus,
          "pending",
        );
      } finally {
        await noChannel.dispose();
      }
      const fake = new FakeVerificationProvider("test"),
        f = await fixture({}, fake);
      try {
        assert.equal(
          (
            await f.request(
              "POST",
              `/recipients/${f.recipient}/verification`,
              {},
            )
          ).statusCode,
          200,
        );
        const code = fake.codes.get("+46701234567")!;
        await pool.query(
          "UPDATE sms_recipients SET challenge_expires_at=now()-interval '1 second' WHERE organization_id=$1",
          [f.org],
        );
        assert.equal(
          (
            await f.request(
              "POST",
              `/recipients/${f.recipient}/verification/complete`,
              { code },
            )
          ).statusCode,
          400,
        );
        await pool.query(
          "UPDATE sms_recipients SET challenge_expires_at=now()+interval '10 minutes' WHERE organization_id=$1",
          [f.org],
        );
        for (let i = 0; i < 5; i++)
          assert.equal(
            (
              await f.request(
                "POST",
                `/recipients/${f.recipient}/verification/complete`,
                { code: "000000" },
              )
            ).statusCode,
            400,
          );
        assert.equal(
          (
            await f.request(
              "POST",
              `/recipients/${f.recipient}/verification/complete`,
              { code },
            )
          ).statusCode,
          400,
        );
        await pool.query(
          "UPDATE sms_recipients SET challenge_attempts=0 WHERE organization_id=$1",
          [f.org],
        );
        assert.equal(
          (
            await f.request(
              "POST",
              `/recipients/${f.recipient}/verification/complete`,
              { code },
            )
          ).statusCode,
          200,
        );
        await pool.query(
          "UPDATE sms_recipients SET verification_expires_at=now()-interval '1 second' WHERE organization_id=$1",
          [f.org],
        );
        assert.equal(
          (await f.request("GET", "/recipients")).json().recipients[0]
            .verificationStatus,
          "expired",
        );
        assert.equal(
          (
            await f.request("PATCH", `/recipients/${f.recipient}`, {
              phone: "0731234567",
              consent: true,
            })
          ).statusCode,
          200,
        );
        assert.equal(
          (await f.request("GET", "/recipients")).json().recipients[0]
            .verificationStatus,
          "pending",
        );
      } finally {
        await f.dispose();
      }
    });
    it("authenticates form webhooks, handles duplicates/out-of-order reports, and never changes a simulation", async () => {
      const secret = "test-webhook-credential-32-characters-long",
        f = await fixture({ SMS_WEBHOOK_AUTH_SECRET: secret });
      try {
        const id = await saveRule(pool, f.org, f.config),
          providerId = "s" + "a".repeat(32);
        await pool.query(
          `INSERT INTO notification_outbox(organization_id,rule_id,recipient_id,dedup_key,rule_name,property_names,parts,status,provider,provider_id,eligible_until) VALUES($1,$2,$3,$4,'Test',ARRAY['Test'],1,'accepted','46elks',$5,now()+interval '1 hour')`,
          [f.org, id, f.recipient, randomUUID(), providerId],
        );
        const send = async (status: string, auth = true) =>
          f.app.inject({
            method: "POST",
            url: "/v1/webhooks/46elks",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              ...(auth
                ? {
                    authorization: `Basic ${Buffer.from(`elks:${secret}`).toString("base64")}`,
                  }
                : {}),
            },
            payload: new URLSearchParams({ id: providerId, status }).toString(),
          });
        assert.equal((await send("delivered", false)).statusCode, 401);
        for (const status of ["delivered", "delivered", "sent", "failed"])
          assert.equal((await send(status)).statusCode, 204);
        assert.equal(
          (
            await pool.query(
              "SELECT status FROM notification_outbox WHERE provider_id=$1",
              [providerId],
            )
          ).rows[0].status,
          "delivered",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM sms_delivery_callbacks c JOIN notification_outbox n ON n.id=c.notification_id WHERE n.organization_id=$1",
              [f.org],
            )
          ).rows[0].n,
          3,
        );
      } finally {
        await f.dispose();
      }
    });
    it("automatically removes short activity while retaining anonymous monthly usage", async () => {
      const f = await fixture();
      try {
        await saveRule(pool, f.org, f.config);
        await f.publish();
        await f.service.evaluateOrganization(f.org);
        await f.service.processOutbox();
        await pool.query(
          "UPDATE notification_outbox SET created_at=now()-interval '31 days' WHERE organization_id=$1",
          [f.org],
        );
        await f.service.cleanup();
        assert.equal((await f.service.activity(f.org)).length, 0);
        assert.equal((await f.service.usage(f.org)).simulated, 1);
      } finally {
        await f.dispose();
      }
    });
  });
}
