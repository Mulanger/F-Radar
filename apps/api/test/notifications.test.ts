import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { loadServerEnv } from "@fastighetsradar/config";
import { NotificationRuleInputSchema } from "@fastighetsradar/domain";
import type { Queryable } from "@fastighetsradar/db";
import { demoPortfolio } from "@fastighetsradar/domain/fixtures";
import { notificationSnapshots } from "../src/notifications/snapshots";
import { NotificationService } from "../src/notifications/service";
import {
  eventEligible,
  forecastValue,
  inQuietHours,
  thresholdTransition,
  type EventCandidate,
} from "../src/notifications/engine";
import {
  FakeVerificationProvider,
  normalizeSwedishPhone,
} from "../src/notifications/verification";
import type { ForecastStep } from "@fastighetsradar/integrations";

const now = new Date("2026-11-13T12:00:00Z");
const forecast = {
  category: "forecast" as const,
  metric: "windGust" as const,
  operator: "gt" as const,
  threshold: 25,
  hours: 24,
  hysteresis: 2,
};
const warning = {
  category: "smhi_warning" as const,
  levels: ["Orange", "Red"] as Array<"Orange" | "Red">,
  updates: true,
  cancellations: false,
};
const event: EventCandidate = {
  source_id: "smhi_warnings",
  external_id: "official:area",
  version: 2,
  level: "Orange",
  severity: "warning",
  data_class: "OFFICIAL_WARNING",
  status: "active",
  headline: "Officiell varning",
  event_type: "SNOW",
  published_at: now,
  source_updated_at: now,
  valid_to: new Date(now.getTime() + 3600000),
  last_seen_at: now,
  change_type: "updated",
  created_at: now,
  dedup_key: "property:event:v2",
  distance_m: "0",
  match_method: "polygon_intersection",
};
describe("typed notification rules", () => {
  const groupId = "00000000-0000-4000-8000-000000000003";
  const groupRule = {
    name: "Testgrupp", enabled: true, scope: "group", groupId, propertyIds: [],
    recipientIds: ["00000000-0000-4000-8000-000000000002"], condition: warning,
    quietHours: { enabled: false, start: "22:00", end: "07:00", emergencyException: false },
  };

  it("requires a UUID for group scope and accepts saved rules without groupId", () => {
    expect(NotificationRuleInputSchema.parse(groupRule).groupId).toBe(groupId);
    for (const [value, message] of [[undefined, "Välj en fastighetsgrupp"], ["Innerstad", "Ogiltigt id för fastighetsgruppen"]]) {
      const result = NotificationRuleInputSchema.safeParse({ ...groupRule, groupId: value });
      expect(result.error?.issues).toEqual([expect.objectContaining({ path: ["groupId"], message })]);
    }
    expect(NotificationRuleInputSchema.safeParse({ ...groupRule, groupId: undefined, scope: "all_future" }).success).toBe(true);
  });

  it("uses current group membership for SMS flags and respects paused properties", async () => {
    const [first, second, paused] = demoPortfolio.properties.slice(0, 3).map((s, i) => ({
      ...s, property: { ...s.property, groupIds: i === 0 ? [] : [groupId] },
    }));
    const config = NotificationRuleInputSchema.parse(groupRule);
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("FROM alert_rules") ? [{ id: "r", name: config.name, enabled: true, config }]
      : sql.includes("AND sms_notifications_paused") ? [{ id: paused!.property.id }] : [] }));
    const db = { query } as unknown as Queryable;
    const flags = async (snapshots: typeof demoPortfolio.properties) => (await notificationSnapshots(db, "tenant", snapshots)).map((s) => s.sms.enabled);
    expect(await flags([first!, second!, paused!])).toEqual([false, true, false]);
    expect(await flags([{ ...first!, property: { ...first!.property, groupIds: [groupId] } }, { ...second!, property: { ...second!.property, groupIds: [] } }])).toEqual([true, false]);
  });

  it("passes the organization and group id to the evaluation query instead of a saved property list", async () => {
    const config = NotificationRuleInputSchema.parse(groupRule);
    const members = [{ id: "p", name: "Medlem", notification_link_key: "link" }];
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("FROM alert_rules") ? [{ id: "r", organization_id: "tenant", config }]
      : sql.includes("FROM properties p") ? members : [] }));
    const db = { connect: async () => ({ query, release: () => {} }) } as unknown as Queryable;
    const service = new NotificationService(db, loadServerEnv({ NODE_ENV: "test" }));
    expect(await service.preview("tenant", "r")).toMatchObject({ message: expect.stringContaining("Medlem"), propertyCount: 1 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("property_group_members WHERE organization_id=$1 AND group_id=$4"), ["tenant", "group", "r", groupId]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("c.property_id=ANY($2::uuid[])"), ["tenant", ["p"], "smhi_warnings", true, undefined]);
    members.length = 0;
    expect(await service.preview("tenant", "r")).toMatchObject({ message: expect.stringContaining("Regeln omfattar inga aktiva fastigheter"), propertyCount: 0, eligible: false });
  });

  it("validates scope, threshold semantics and quiet hours on the server", () => {
    const base = {
      name: "Test",
      enabled: false,
      scope: "selected",
      propertyIds: ["00000000-0000-4000-8000-000000000001"],
      recipientIds: ["00000000-0000-4000-8000-000000000002"],
      condition: forecast,
      cooldownMinutes: 30,
      quietHours: {
        enabled: true,
        start: "22:00",
        end: "07:00",
        emergencyException: false,
      },
      groupProperties: true,
      dailyPropertyLimit: 3,
      dailyRecipientLimit: 5,
    };
    expect(NotificationRuleInputSchema.safeParse(base).success).toBe(true);
    expect(
      NotificationRuleInputSchema.safeParse({ ...base, propertyIds: [] })
        .success,
    ).toBe(false);
    expect(
      NotificationRuleInputSchema.safeParse({
        ...base,
        condition: { ...forecast, metric: "relativeHumidity", threshold: 120 },
      }).success,
    ).toBe(false);
    expect(
      NotificationRuleInputSchema.safeParse({
        ...base,
        condition: { category: "statistics" },
      }).success,
    ).toBe(false);
    expect(
      NotificationRuleInputSchema.safeParse({
        ...base,
        quietHours: { ...base.quietHours, start: "24:00" },
      }).success,
    ).toBe(false);
  });
  it("baselines existing true conditions, detects crossings and rearms with hysteresis", () => {
    expect(thresholdTransition(forecast, 30, null)).toEqual({
      latched: true,
      trigger: false,
    });
    expect(thresholdTransition(forecast, 30, false)).toEqual({
      latched: true,
      trigger: true,
    });
    expect(thresholdTransition(forecast, 30, true)).toEqual({
      latched: true,
      trigger: false,
    });
    expect(thresholdTransition(forecast, 24, true).latched).toBe(true);
    expect(thresholdTransition(forecast, 23, true).latched).toBe(false);
    expect(thresholdTransition(forecast, null, false)).toEqual({
      latched: false,
      trigger: false,
    });
    expect(
      thresholdTransition({ ...forecast, operator: "lt" }, 20, false).trigger,
    ).toBe(true);
  });
  it("rejects missing forecast periods and uses existing normalized values", () => {
    const steps = Array.from({ length: 24 }, (_, i) => ({
      time: new Date(now.getTime() + (i + 1) * 3600000).toISOString(),
      intervalStart: new Date(now.getTime() + i * 3600000).toISOString(),
      windGust: 20 + i,
      precipitationMean: 1,
    })) as ForecastStep[];
    expect(forecastValue(forecast, steps, now)).toBe(43);
    expect(
      forecastValue({ ...forecast, metric: "precipitationMean" }, steps, now),
    ).toBe(24);
    expect(forecastValue(forecast, steps.slice(0, 2), now)).toBeNull();
    steps[5].windGust = null;
    expect(forecastValue(forecast, steps, now)).toBeNull();
  });
  it("filters official levels, stale data, old events and superseded versions", () => {
    const active = new Date(now.getTime() - 60000);
    expect(eventEligible(warning, event, now, active)).toBe(true);
    expect(
      eventEligible(warning, { ...event, level: "Yellow" }, now, active),
    ).toBe(false);
    expect(
      eventEligible(
        warning,
        { ...event, last_seen_at: new Date(now.getTime() - 3600000) },
        now,
        active,
      ),
    ).toBe(false);
    expect(
      eventEligible(
        warning,
        { ...event, created_at: new Date(now.getTime() - 3600000) },
        now,
        active,
      ),
    ).toBe(false);
    expect(eventEligible(warning, { ...event, version: 3 }, now, active)).toBe(
      false,
    );
    expect(
      eventEligible({ ...warning, updates: false }, event, now, active),
    ).toBe(false);
    expect(
      eventEligible(
        warning,
        { ...event, change_type: "ended", status: "ended" },
        now,
        active,
      ),
    ).toBe(false);
    expect(
      eventEligible(
        { ...warning, cancellations: true },
        { ...event, change_type: "ended", status: "ended" },
        now,
        active,
      ),
    ).toBe(true);
  });
  it("never treats ordinary county news as VMA or old roadworks as new disruption", () => {
    expect(
      eventEligible(
        { category: "vma", updates: true, cancellations: false },
        {
          ...event,
          source_id: "krisinformation",
          data_class: "PUBLIC_EVENT",
          level: "Info",
          match_method: "county",
        },
        now,
        new Date(0),
      ),
    ).toBe(false);
    const traffic = {
      ...event,
      source_id: "trafikverket",
      data_class: "PUBLIC_EVENT",
      level: null,
      match_method: "within_radius",
      distance_m: "1400",
    };
    expect(
      eventEligible(
        { category: "traffic", radiusMeters: 1000, updates: true },
        traffic,
        now,
        new Date(0),
      ),
    ).toBe(false);
    expect(
      eventEligible(
        { category: "traffic", radiusMeters: 2000, updates: true },
        { ...traffic, change_type:'new', published_at: new Date("2026-01-01") },
        now,
        new Date(0),
      ),
    ).toBe(false);
  });
});
describe("Stockholm quiet hours including DST", () => {
  const q = {
    enabled: true,
    start: "22:00",
    end: "07:00",
    emergencyException: false,
  };
  it("handles overnight, daytime and opted-in emergency exceptions", () => {
    expect(inQuietHours(q, new Date("2026-11-13T21:00Z"), false)).toBe(true);
    expect(inQuietHours(q, new Date("2026-07-13T20:00Z"), false)).toBe(true);
    expect(inQuietHours(q, new Date("2026-11-13T06:00Z"), false)).toBe(false);
    expect(
      inQuietHours({ ...q, start: "09:00", end: "17:00" }, now, false),
    ).toBe(true);
    expect(inQuietHours(q, new Date("2026-11-13T21:00Z"), true)).toBe(true);
    expect(
      inQuietHours(
        { ...q, emergencyException: true },
        new Date("2026-11-13T21:00Z"),
        true,
      ),
    ).toBe(false);
  });
  it("covers both instances of the repeated autumn hour and the spring jump", () => {
    const q = {
      enabled: true,
      start: "02:00",
      end: "03:00",
      emergencyException: false,
    };
    expect(inQuietHours(q, new Date("2026-10-25T00:30Z"), false)).toBe(true);
    expect(inQuietHours(q, new Date("2026-10-25T01:30Z"), false)).toBe(true);
    expect(inQuietHours(q, new Date("2026-03-29T01:30Z"), false)).toBe(false);
  });
});
describe("recipient validation", () => {
  it("normalizes Swedish mobile numbers into E.164", () => {
    for (const n of ["070 123 45 67", "+46 70 123 45 67", "0046701234567"])
      expect(normalizeSwedishPhone(n)).toBe("+46701234567");
  });
  it("rejects invalid, non-Swedish, landline and extracted text numbers", () => {
    for (const n of ["123", "+12025550123", "08-12345678", "call 0701234567"])
      expect(() => normalizeSwedishPhone(n)).toThrow();
    expect(() => new FakeVerificationProvider("production")).toThrow(
      /forbidden/,
    );
  });
});
describe("notification API guards", () => {
  it("rejects unauthenticated access and non-admin mutations", async () => {
    const app = await buildApp(loadServerEnv({ NODE_ENV: "test" }), {
      logger: false,
      db: {
        query: async <R>() => ({
          rows: [{ id: "00000000-0000-4000-8000-000000000001" }] as R[],
        }),
      },
      verifyAuth: async (req) =>
        req.headers.authorization
          ? {
              userId: "user_a",
              sessionId: "s",
              clerkOrgId: "org_a",
              orgRole: "org:member",
              orgSlug: "a",
            }
          : null,
    });
    try {
      for (const url of [
        "/v1/notifications",
        "/v1/notifications/rules",
        "/v1/notifications/recipients",
        "/v1/notifications/activity",
        "/v1/notifications/usage",
      ])
        expect((await app.inject({ url })).statusCode).toBe(401);
      for (const url of [
        "/v1/notifications/rules",
        "/v1/notifications/recipients",
        "/v1/notifications/rules/00000000-0000-4000-8000-000000000001/test",
      ])
        expect(
          (
            await app.inject({
              method: "POST",
              url,
              headers: { authorization: "Bearer member" },
              payload: {},
            })
          ).statusCode,
        ).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/webhooks/46elks",
            payload: {},
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/sms/send",
            payload: { to: "+46701234567" },
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
});
