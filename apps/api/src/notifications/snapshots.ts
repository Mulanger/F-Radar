import type { PropertySnapshot, SourceId } from "@fastighetsradar/domain";
import { NOTIFICATION_CATEGORIES } from "@fastighetsradar/domain";
import type { Queryable } from "@fastighetsradar/db";
import { loadRules, maskPhone, type RecipientRow } from "./store";

/** Enriches the existing dashboard contract; never performs evaluation or provider calls. */
export async function notificationSnapshots(
  db: Queryable,
  org: string,
  snapshots: PropertySnapshot[],
): Promise<PropertySnapshot[]> {
  const rules = await loadRules(db, org);
  const recipients = (
    await db.query<RecipientRow>(
      "SELECT * FROM sms_recipients WHERE organization_id=$1",
      [org],
    )
  ).rows;
  const paused = (
    await db.query<{ id: string }>(
      "SELECT id FROM properties WHERE organization_id=$1 AND sms_notifications_paused",
      [org],
    )
  ).rows;
  return snapshots.map((s) => {
    const matching = rules.filter(
      (r) =>
        r.config.scope === "all_future" ||
        r.config.propertyIds.includes(s.property.id),
    );
    const ids = new Set(matching.flatMap((r) => r.config.recipientIds));
    const numbers = recipients.filter((r) => ids.has(r.id));
    return {
      ...s,
      sms: {
        enabled:
          matching.some((r) => r.enabled) &&
          !paused.some((p) => p.id === s.property.id),
        recipientsLabel: numbers.length
          ? numbers.map((r) => maskPhone(r.phone_e164)).join(", ") +
            " · Testläge"
          : "Ingen mottagare · Testläge",
        recipientCount: numbers.length,
      },
      alertRules: matching.map((r) => {
        const c = r.config.condition,
          cat = NOTIFICATION_CATEGORIES.find((cat) => cat.id === c.category)!;
        return {
          id: r.id,
          organizationId: s.property.organizationId,
          propertyId: s.property.id,
          code:
            c.category === "forecast"
              ? "VP"
              : c.category === "traffic"
                ? "TR"
                : c.category === "vma"
                  ? "VMA"
                  : "OV",
          name: r.name,
          conditionLabel: cat.label + " · Testläge",
          sourceId: cat.source as SourceId,
          metricKey: "notification",
          operator: "any" as const,
          threshold: null,
          unit: null,
          aggregationWindow: null,
          channel: "sms" as const,
          enabled: r.enabled,
          cooldownMinutes: r.config.cooldownMinutes,
          quietHours: {
            enabled: r.config.quietHours.enabled,
            from: r.config.quietHours.start,
            to: r.config.quietHours.end,
            timezone: "Europe/Stockholm",
          },
        };
      }),
    };
  });
}
