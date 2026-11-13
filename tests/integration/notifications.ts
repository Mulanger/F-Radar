import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import type { NotificationRuleInput } from "../../packages/domain/src";

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
          assert.equal(
            rows.filter((r) => r.status === "queued").length,
            scope === "minute" ? 0 : 1,
          );
          assert.ok(rows.some((r) => r.status === "suppressed_limit"));
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
