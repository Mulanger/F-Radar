import type { Queryable } from "@fastighetsradar/db";
import type {
  NotificationRecipient,
  NotificationRule,
  NotificationRuleInput,
} from "@fastighetsradar/domain";
import { HttpProblem } from "../errors";

export type TransactionClient = Queryable & { release(): void };
export async function notificationTransaction<T>(
  db: Queryable,
  fn: (client: Queryable) => Promise<T>,
): Promise<T> {
  const pool = db as Queryable & { connect?: () => Promise<TransactionClient> };
  if (!pool.connect)
    throw new HttpProblem(
      503,
      "Transactional notification storage unavailable",
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '15s'");
    // A global transaction lock gives budget reservations a total order across workers and tenants.
    await client.query("SELECT pg_advisory_xact_lock(704004)");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof HttpProblem) throw err;
    // PostgreSQL constraint errors can include a full phone number in `detail`; never log them.
    if (err && typeof err === "object" && "code" in err)
      throw new HttpProblem(503, "Notification storage unavailable");
    throw err;
  } finally {
    client.release();
  }
}
export interface RuleRow {
  id: string;
  organization_id: string;
  name: string;
  enabled: boolean;
  config: NotificationRuleInput;
  created_at: Date;
  updated_at: Date;
  activated_at: Date;
  last_change_id: string;
}
export interface RecipientRow {
  id: string;
  organization_id: string;
  phone_e164: string;
  consent_at: Date | null;
  verified_at: Date | null;
  verification_expires_at: Date | null;
  challenge_hash: string | null;
  challenge_expires_at: Date | null;
  challenge_attempts: number;
  verification_method: string | null;
}
export const maskPhone = (phone: string) =>
  `${phone.slice(0, 3)} ••• •• ${phone.slice(-4)}`;
export function publicRecipient(
  r: RecipientRow,
  now = new Date(),
): NotificationRecipient {
  return {
    id: r.id,
    maskedPhone: maskPhone(r.phone_e164),
    consent: !!r.consent_at,
    verificationStatus:
      r.verified_at &&
      r.verification_expires_at &&
      r.verification_expires_at > now
        ? "verified"
        : r.verified_at
          ? "expired"
          : "pending",
    verificationExpiresAt: r.verification_expires_at?.toISOString() ?? null,
  };
}
export function publicRule(r: RuleRow): NotificationRule {
  return {
    ...r.config,
    enabled: r.enabled,
    id: r.id,
    name: r.name,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
export async function loadRules(
  db: Queryable,
  org: string,
): Promise<RuleRow[]> {
  const { rows } = await db.query<RuleRow>(
    `SELECT * FROM alert_rules WHERE organization_id=$1 AND sms_version=1 ORDER BY created_at`,
    [org],
  );
  // Scope comes from constrained relations. Never leave stale property/recipient IDs after deletion.
  const props = await db.query<{ rule_id: string; property_id: string }>(
    "SELECT rule_id,property_id FROM alert_rule_properties WHERE organization_id=$1",
    [org],
  );
  const recipients = await db.query<{ rule_id: string; recipient_id: string }>(
    "SELECT rule_id,recipient_id FROM alert_rule_recipients WHERE organization_id=$1",
    [org],
  );
  return rows.map((r) => ({
    ...r,
    config: {
      ...r.config,
      enabled: r.enabled,
      propertyIds: props.rows
        .filter((p) => p.rule_id === r.id)
        .map((p) => p.property_id),
      recipientIds: recipients.rows
        .filter((p) => p.rule_id === r.id)
        .map((p) => p.recipient_id),
    },
  }));
}
export async function saveRule(
  db: Queryable,
  org: string,
  input: NotificationRuleInput,
  id?: string,
): Promise<string> {
  return notificationTransaction(db, async (tx) => {
    if (
      id &&
      !(
        await tx.query(
          "SELECT id FROM alert_rules WHERE organization_id=$1 AND id=$2 AND sms_version=1 FOR UPDATE",
          [org, id],
        )
      ).rows.length
    )
      throw new HttpProblem(404, "Rule not found");
    if (
      !id &&
      Number(
        (
          await tx.query<{ n: string }>(
            "SELECT count(*) AS n FROM alert_rules WHERE organization_id=$1",
            [org],
          )
        ).rows[0]!.n,
      ) >= 50
    )
      throw new HttpProblem(409, "Maximum 50 rules");
    const propertyIds =
      (input.scope === "all_current" && !id) || input.scope === "all_future"
        ? (
            await tx.query<{ id: string }>(
              "SELECT id FROM properties WHERE organization_id=$1",
              [org],
            )
          ).rows.map((r) => r.id)
        : [...new Set(input.propertyIds)];
    const recipientIds = [...new Set(input.recipientIds)];
    const validProperties = await tx.query(
      "SELECT id FROM properties WHERE organization_id=$1 AND id=ANY($2::uuid[])",
      [org, propertyIds],
    );
    const validRecipients = await tx.query(
      "SELECT id FROM sms_recipients WHERE organization_id=$1 AND id=ANY($2::uuid[])",
      [org, recipientIds],
    );
    if (
      validProperties.rows.length !== propertyIds.length ||
      validRecipients.rows.length !== recipientIds.length
    )
      throw new HttpProblem(400, "Invalid property or recipient scope");
    const config = { ...input, propertyIds, recipientIds };
    const source = {
      smhi_warning: "smhi_warnings",
      forecast: "smhi_forecast",
      vma: "krisinformation",
      traffic: "trafikverket",
    }[input.condition.category];
    let ruleId = id;
    if (ruleId) {
      await tx.query(
        `UPDATE alert_rules SET name=$3, config=$4::jsonb, enabled=$5, source_id=$6, cooldown_minutes=$7, quiet_hours=$8::jsonb,
        activated_at=now(), last_change_id=(SELECT coalesce(max(id),0) FROM monitoring_changes WHERE organization_id=$1), updated_at=now()
        WHERE organization_id=$1 AND id=$2`,
        [
          org,
          ruleId,
          input.name,
          JSON.stringify(config),
          input.enabled,
          source,
          input.cooldownMinutes,
          JSON.stringify(input.quietHours),
        ],
      );
      await tx.query(
        "DELETE FROM alert_rule_properties WHERE organization_id=$1 AND rule_id=$2",
        [org, ruleId],
      );
      await tx.query(
        "DELETE FROM alert_rule_recipients WHERE organization_id=$1 AND rule_id=$2",
        [org, ruleId],
      );
      await tx.query(
        "DELETE FROM alert_evaluation_state WHERE organization_id=$1 AND rule_id=$2",
        [org, ruleId],
      );
      await tx.query(
        "UPDATE notification_outbox SET status='not_eligible',message=NULL,detail='Regeln ändrades före bearbetning',lease_owner=NULL,lease_until=NULL WHERE organization_id=$1 AND rule_id=$2 AND status IN ('queued','retry')",
        [org, ruleId],
      );
    } else {
      ruleId = (
        await tx.query<{ id: string }>(
          `INSERT INTO alert_rules(organization_id,name,config,enabled,source_id,metric_key,operator,sms_version,cooldown_minutes,quiet_hours,last_change_id)
        VALUES($1,$2,$3::jsonb,$4,$5,'notification','any',1,$6,$7::jsonb,(SELECT coalesce(max(id),0) FROM monitoring_changes WHERE organization_id=$1)) RETURNING id`,
          [
            org,
            input.name,
            JSON.stringify(config),
            input.enabled,
            source,
            input.cooldownMinutes,
            JSON.stringify(input.quietHours),
          ],
        )
      ).rows[0]!.id;
    }
    await tx.query(
      "INSERT INTO alert_rule_properties(organization_id,rule_id,property_id) SELECT $1,$2,unnest($3::uuid[])",
      [org, ruleId, propertyIds],
    );
    await tx.query(
      "INSERT INTO alert_rule_recipients(organization_id,rule_id,recipient_id) SELECT $1,$2,unnest($3::uuid[])",
      [org, ruleId, recipientIds],
    );
    return ruleId!;
  });
}
