/** Temporary-tenant smoke test for the deployed Phase 4 worker. Never calls a provider itself. */
import { randomUUID } from "node:crypto";
import { loadServerEnv } from "../packages/config/src";
import {
  createPool,
  createProperty,
  ensureOrganization,
  upsertPropertyForecast,
} from "../packages/db/src";
import { NotificationService } from "../apps/api/src/notifications/service";
import { forecastValue } from "../apps/api/src/notifications/engine";
import { saveRule } from "../apps/api/src/notifications/store";
import type { ForecastStep } from "../packages/integrations/src";

if (process.env.PHASE4_DEPLOYMENT_SMOKE !== "1")
  throw new Error("Explicit Phase 4 smoke workflow required");
const url = process.env.DATABASE_URL;
if (!url || new URL(url).pathname !== "/fastighetsradar")
  throw new Error("Only the authorized FastighetsRadar database is supported");
const db = createPool(url);
const owner = "user_phase4DeploymentSmoke";
const title = "Phase4 smoke verification";
const [mode, id] = process.argv.slice(2);
try {
  if (mode === "setup") {
    const forecasts = await db.query<{
      reference_time: Date;
      created_time: Date;
      series: { steps: ForecastStep[] };
      lat: number;
      lon: number;
    }>(`SELECT f.reference_time,f.created_time,f.series,ST_Y(p.location::geometry) AS lat,ST_X(p.location::geometry) AS lon
      FROM property_forecasts f JOIN properties p ON p.id=f.property_id AND p.organization_id=f.organization_id
      WHERE f.reference_time>now()-interval '6 hours' ORDER BY f.fetched_at DESC LIMIT 20`);
    const c = {
      category: "forecast" as const,
      metric: "airTemperature" as const,
      operator: "gt" as const,
      threshold: -60,
      hours: 1,
      hysteresis: 1,
    };
    const forecast = forecasts.rows.find(
      (f) =>
        Array.isArray(f.series.steps) &&
        forecastValue(c, f.series.steps, new Date()) !== null,
    );
    if (!forecast)
      throw new Error(
        "No suitable real normalized forecast for deployment smoke test",
      );
    const org = await ensureOrganization(
      db,
      `org_phase4smoke${randomUUID().replaceAll("-", "")}`,
      title,
    );
    try {
      const property = await createProperty(
        db,
        { organizationId: org, userId: owner },
        {
          name: "Phase 4 smoke (temporary)",
          address: "Isolated deployment test",
          location: { lat: forecast.lat, lon: forecast.lon },
          geocode: { provider: "manual_pin", precision: "unknown" },
        },
      );
      await upsertPropertyForecast(db, {
        propertyId: property.id,
        organizationId: org,
        sourceId: "smhi_forecast",
        referenceTime: forecast.reference_time.toISOString(),
        createdTime: forecast.created_time.toISOString(),
        grid: null,
        series: forecast.series,
      });
      // Synthetic, unverified fixture, local simulation only. Never customer contact information.
      const recipient = (
        await db.query<{ id: string }>(
          "INSERT INTO sms_recipients(organization_id,phone_e164,consent_at,created_by) VALUES($1,'+46700000000',now(),$2) RETURNING id",
          [org, owner],
        )
      ).rows[0].id;
      const rule = await saveRule(db, org, {
        name: "Phase 4 deployment smoke (disabled)",
        enabled: false,
        scope: "selected",
        propertyIds: [property.id],
        recipientIds: [recipient],
        condition: c,
        cooldownMinutes: 360,
        quietHours: {
          enabled: false,
          start: "22:00",
          end: "07:00",
          emergencyException: false,
        },
        groupProperties: true,
        dailyPropertyLimit: 1,
        dailyRecipientLimit: 1,
      });
      const service = new NotificationService(
        db,
        loadServerEnv({
          NODE_ENV: "production",
          APP_URL: "https://f-radar.fr-2.instapods.app",
        }),
      );
      await service.evaluateOrganization(org, rule, "success");
      console.log(
        JSON.stringify({
          organizationId: org,
          ruleId: rule,
          activity: await service.activity(org),
        }),
      );
    } catch (err) {
      await db.query("DELETE FROM organizations WHERE id=$1 AND name=$2", [
        org,
        title,
      ]);
      throw err;
    }
  } else if (mode === "status" || mode === "cleanup") {
    if (!id || !/^[a-f0-9-]{36}$/.test(id))
      throw new Error("Explicit smoke organization UUID required");
    const found = await db.query(
      "SELECT id FROM organizations WHERE id=$1 AND name=$2 AND clerk_org_id LIKE 'org_phase4smoke%'",
      [id, title],
    );
    if (found.rows.length !== 1) throw new Error("Not a Phase 4 smoke tenant");
    const rows = await db.query(
      "SELECT status,provider,verification_required,attempt_count,message IS NULL AS text_cleared FROM notification_outbox WHERE organization_id=$1",
      [id],
    );
    console.log(
      JSON.stringify({ organizationId: id, notifications: rows.rows }),
    );
    if (mode === "cleanup") {
      if (
        rows.rows.length !== 1 ||
        rows.rows[0].status !== "simulated" ||
        rows.rows[0].provider !== "simulated"
      )
        throw new Error("Expected completed local simulation before cleanup");
      await db.query("DELETE FROM organizations WHERE id=$1 AND name=$2", [
        id,
        title,
      ]);
      console.log(
        JSON.stringify({ removedTemporaryTenant: true, realSmsSent: 0 }),
      );
    }
  } else throw new Error("Use setup, status <org UUID>, or cleanup <org UUID>");
} finally {
  await db.end();
}
