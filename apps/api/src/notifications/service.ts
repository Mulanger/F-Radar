import { createHash, randomUUID } from "node:crypto";
import type { Queryable } from "@fastighetsradar/db";
import type { ServerEnv } from "@fastighetsradar/config";
import {
  NOTIFICATION_CATEGORIES,
  type NotificationActivity,
  type NotificationDashboard,
} from "@fastighetsradar/domain";
import {
  estimateSmsParts,
  notificationTransport,
  type ForecastStep,
  type NotificationTransport,
  type SimulationScenario,
} from "@fastighetsradar/integrations";
import {
  eventEligible,
  forecastValue,
  inQuietHours,
  metricLabels,
  smsText,
  thresholdTransition,
  type EventCandidate,
} from "./engine";
import {
  loadRules,
  maskPhone,
  notificationTransaction,
  publicRecipient,
  publicRule,
  type RecipientRow,
  type RuleRow,
} from "./store";
import { HttpProblem } from "../errors";

interface Property {
  id: string;
  name: string;
  notification_link_key: string;
}
interface Candidate extends EventCandidate {
  property_id: string;
  event_id: string;
  id: string;
}
interface Trigger {
  key: string;
  properties: Property[];
  description: string;
  source: string;
  timestamp: Date;
  emergency: boolean;
  eligible: boolean;
  detail?: string;
  evidence?: {
    eventId?: string;
    version?: number;
    ended?: boolean;
    forecastPropertyId?: string;
  };
}
interface OutboxRow {
  id: string;
  organization_id: string;
  recipient_id: string;
  rule_id: string;
  status: string;
  message: string | null;
  provider: string;
  attempt_count: number;
  simulation_scenario: SimulationScenario;
  eligible_until: Date;
  lease_owner: string | null;
  is_test: boolean;
  trigger_evidence: NonNullable<Trigger["evidence"]>;
}
const unitPrice = (env: ServerEnv) =>
  (env.SMS_ESTIMATED_PRICE_PER_PART_SEK ?? 0) > 0
    ? env.SMS_ESTIMATED_PRICE_PER_PART_SEK!
    : null;
const scopeKey = (phone: string) =>
  createHash("sha256").update(phone).digest("hex");

export class NotificationService {
  constructor(
    readonly db: Queryable,
    readonly env: ServerEnv,
    private transport: NotificationTransport = notificationTransport(),
  ) {
    if (transport.name !== "simulated")
      throw new Error("Phase 4 scheduler requires SimulatedSmsProvider");
  }
  async dashboard(
    org: string,
    canManage: boolean,
  ): Promise<NotificationDashboard> {
    const [rules, recipients, properties, activity, usage] = await Promise.all([
      loadRules(this.db, org),
      this.db.query<RecipientRow>(
        "SELECT * FROM sms_recipients WHERE organization_id=$1 ORDER BY created_at",
        [org],
      ),
      this.db.query<Property>(
        "SELECT id,name FROM properties WHERE organization_id=$1 ORDER BY name",
        [org],
      ),
      this.activity(org),
      this.usage(org),
    ]);
    return {
      rules: rules.map(publicRule),
      recipients: recipients.rows.map((r) => publicRecipient(r)),
      properties: properties.rows,
      activity,
      usage,
      canManage,
      mode: "simulated",
      categories: NOTIFICATION_CATEGORIES,
    };
  }
  async activity(org: string): Promise<NotificationActivity[]> {
    const r = await this.db.query<{
      id: string;
      status: string;
      created_at: Date;
      rule_name: string;
      property_names: string[];
      phone_e164: string;
      parts: number;
      estimated_cost_sek: string | null;
      is_test: boolean;
      verification_required: boolean;
      detail: string | null;
    }>(
      `SELECT n.id,n.status,n.created_at,n.rule_name,n.property_names,r.phone_e164,n.parts,n.estimated_cost_sek,n.is_test,n.verification_required,n.detail
       FROM notification_outbox n JOIN sms_recipients r ON r.organization_id=n.organization_id AND r.id=n.recipient_id
       WHERE n.organization_id=$1 AND n.created_at > now()-interval '30 days' ORDER BY n.created_at DESC LIMIT 50`,
      [org],
    );
    return r.rows.map((a) => ({
      id: a.id,
      status: a.status,
      createdAt: a.created_at.toISOString(),
      ruleName: a.rule_name,
      propertyNames: a.property_names,
      maskedPhone: maskPhone(a.phone_e164),
      parts: a.parts,
      estimatedCostSek:
        a.estimated_cost_sek === null ? null : Number(a.estimated_cost_sek),
      isTest: a.is_test,
      verificationRequired: a.verification_required,
      detail: a.detail,
    }));
  }
  async usage(org: string) {
    const { rows } = await this.db.query<{
      simulated_messages: number;
      simulated_parts: number;
      estimated_cost_sek: string;
      real_cost_sek: string;
    }>(
      "SELECT * FROM notification_usage WHERE organization_id=$1 AND month=date_trunc('month',now() AT TIME ZONE 'UTC')::date",
      [org],
    );
    const u = rows[0];
    return {
      simulated: u?.simulated_messages ?? 0,
      parts: u?.simulated_parts ?? 0,
      estimatedCostSek:
        unitPrice(this.env) === null
          ? null
          : Number(u?.estimated_cost_sek ?? 0),
      realCostSek: Number(u?.real_cost_sek ?? 0),
      dailyLimit: this.env.SMS_DAILY_LIMIT_PER_ORG,
      monthlyLimit: this.env.SMS_SIMULATION_MONTHLY_LIMIT,
      globalMonthlyCapSek: this.env.SMS_MAX_GLOBAL_MONTHLY_COST_SEK,
      pricePerPartSek: unitPrice(this.env),
      retentionDays: 30,
    };
  }
  private async properties(tx: Queryable, r: RuleRow): Promise<Property[]> {
    return (
      await tx.query<Property>(
        `SELECT id,name,notification_link_key FROM properties WHERE organization_id=$1 AND status<>'paused' AND NOT sms_notifications_paused
      AND ($2 OR id IN (SELECT property_id FROM alert_rule_properties WHERE organization_id=$1 AND rule_id=$3)) ORDER BY id`,
        [r.organization_id, r.config.scope === "all_future", r.id],
      )
    ).rows;
  }
  private async eventTriggers(
    tx: Queryable,
    rule: RuleRow,
    props: Property[],
    now: Date,
    test: boolean,
  ): Promise<Trigger[]> {
    const { rows } = await tx.query<Candidate>(
      `SELECT c.*,e.external_id,e.version,e.level,e.status,e.event_type,e.published_at,e.source_updated_at,e.valid_to,e.last_seen_at,
      m.distance_m,m.match_method FROM monitoring_changes c JOIN source_events e ON e.id=c.event_id
      LEFT JOIN property_event_matches m ON m.event_id=c.event_id AND m.property_id=c.property_id AND m.organization_id=c.organization_id
      WHERE c.organization_id=$1 AND c.property_id=ANY($2::uuid[]) AND c.source_id=$3
      AND ($4 OR c.id > $5::bigint) AND c.created_at > now()-interval '30 days' ORDER BY c.id ${test ? "DESC LIMIT 500" : "LIMIT 5000"}`,
      [
        rule.organization_id,
        props.map((p) => p.id),
        NOTIFICATION_CATEGORIES.find(
          (c) => c.id === rule.config.condition.category,
        )!.source,
        test,
        rule.last_change_id,
      ],
    );
    if (!test && rows.length)
      await tx.query(
        "UPDATE alert_rules SET last_change_id=$3 WHERE organization_id=$1 AND id=$2",
        [rule.organization_id, rule.id, rows.at(-1)!.id],
      );
    const grouped = new Map<string, Trigger>();
    for (const e of rows) {
      const p = props.find((p) => p.id === e.property_id)!;
      const key = `${e.source_id}:${e.external_id}:${e.dedup_key.replace(`${e.property_id}:`, "")}${rule.config.groupProperties ? "" : `:${p.id}`}`;
      const eligible = eventEligible(
        rule.config.condition,
        e,
        now,
        rule.activated_at,
        test,
      );
      // Keep ended notifications source-specific; ordinary news never becomes a VMA all-clear.
      const typeMatches =
        rule.config.condition.category === "smhi_warning"
          ? e.source_id === "smhi_warnings" &&
            ["Yellow", "Orange", "Red"].includes(e.level ?? "")
          : rule.config.condition.category === "vma"
            ? e.level === "VMA" && e.data_class === "OFFICIAL_WARNING"
            : true;
      const end = e.change_type === "ended" || e.change_type === "cancelled";
      const level = (
        { Yellow: "gul", Orange: "orange", Red: "röd", VMA: "VMA" } as Record<
          string,
          string
        >
      )[e.level ?? ""];
      const label =
        rule.config.condition.category === "smhi_warning"
          ? `Officiell ${level ?? ""} varning: ${e.headline}`
          : rule.config.condition.category === "vma"
            ? `VMA (${e.match_method === "municipality" ? "kommun" : "regionalt område"}): ${e.headline}`
            : `Betydande trafikhändelse nära fastigheten: ${e.headline}`;
      const existing = grouped.get(key);
      if (existing) {
        if (!existing.properties.some((v) => v.id === p.id))
          existing.properties.push(p);
        existing.eligible ||= eligible && typeMatches;
      } else
        grouped.set(key, {
          key,
          properties: [p],
          description: `${end ? "Avslutad: " : e.change_type === "updated" ? "Uppdaterad: " : ""}${label}`,
          source:
            e.source_id === "smhi_warnings"
              ? "SMHI"
              : e.source_id === "krisinformation"
                ? "Krisinformation.se"
                : "Trafikverket",
          timestamp: e.source_updated_at ?? e.published_at ?? e.created_at,
          emergency: e.level === "Red" || e.level === "VMA",
          eligible: eligible && typeMatches,
          evidence: { eventId: e.event_id, version: e.version, ended: end },
        });
    }
    const triggers = [...grouped.values()];
    return test
      ? [triggers.find((t) => t.eligible) ?? triggers[0]].filter(
          (t): t is Trigger => !!t,
        )
      : triggers;
  }
  private async forecastTriggers(
    tx: Queryable,
    r: RuleRow,
    props: Property[],
    now: Date,
    test: boolean,
  ): Promise<Trigger[]> {
    const c = r.config.condition;
    if (c.category !== "forecast") return [];
    const forecasts = await tx.query<{
      property_id: string;
      reference_time: Date | null;
      fetched_at: Date;
      series: { steps?: ForecastStep[] };
    }>(
      "SELECT * FROM property_forecasts WHERE organization_id=$1 AND property_id=ANY($2::uuid[])",
      [r.organization_id, props.map((p) => p.id)],
    );
    const triggers: Trigger[] = [];
    for (const f of forecasts.rows) {
      if (
        !f.reference_time ||
        now.getTime() - f.reference_time.getTime() > 6 * 3600000 ||
        now.getTime() - f.fetched_at.getTime() > 6 * 3600000 ||
        !Array.isArray(f.series.steps)
      )
        continue;
      const p = props.find((p) => p.id === f.property_id)!;
      const state = (
        await tx.query<{
          latched: boolean;
          transition: string;
          reference_time: Date | null;
        }>(
          "SELECT * FROM alert_evaluation_state WHERE organization_id=$1 AND rule_id=$2 AND property_id=$3",
          [r.organization_id, r.id, p.id],
        )
      ).rows[0];
      if (
        !test &&
        state?.reference_time &&
        f.reference_time < state.reference_time
      )
        continue;
      const value = forecastValue(c, f.series.steps, now);
      const next = thresholdTransition(c, value, state?.latched ?? null);
      if (next.latched === null) continue;
      const transition =
        Number(state?.transition ?? 0) + (next.trigger ? 1 : 0);
      if (!test)
        await tx.query(
          `INSERT INTO alert_evaluation_state(organization_id,rule_id,property_id,latched,transition,reference_time)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,rule_id,property_id) DO UPDATE SET latched=$4,transition=$5,reference_time=$6,updated_at=now()`,
          [
            r.organization_id,
            r.id,
            p.id,
            next.latched,
            transition,
            f.reference_time,
          ],
        );
      if (test || next.trigger) {
        const [label, unit] = metricLabels[c.metric];
        triggers.push({
          key: `forecast:${p.id}:crossing:${transition}`,
          properties: [p],
          description: `Prognos ${label} ${value ?? "saknas"} ${unit} inom ${c.hours} h (${c.operator === "gt" ? "över" : "under"} ${c.threshold} ${unit})`,
          source: "SMHI",
          timestamp: f.reference_time,
          emergency: false,
          eligible:
            value !== null &&
            (c.operator === "gt" ? value > c.threshold : value < c.threshold),
          detail: test
            ? "Test med sparad SMHI-prognos; inga uppgifter har hittats på."
            : undefined,
          evidence: { forecastPropertyId: p.id },
        });
      }
    }
    return test ? triggers.slice(0, 1) : triggers;
  }
  private async triggers(tx: Queryable, r: RuleRow, now: Date, test: boolean) {
    const props = await this.properties(tx, r);
    const triggers =
      r.config.condition.category === "forecast"
        ? await this.forecastTriggers(tx, r, props, now, test)
        : await this.eventTriggers(tx, r, props, now, test);
    if (test && !triggers.length)
      triggers.push({
        key: "no-source-data",
        properties: props.slice(0, 1),
        description: "Ingen aktuell källhändelse finns för denna regel",
        source: "FastighetsRadar",
        timestamp: now,
        emergency: false,
        eligible: false,
        detail:
          "Ingen lämplig sparad källhändelse. Testet skapade inga mätvärden.",
      });
    return triggers;
  }
  async preview(org: string, id: string) {
    return notificationTransaction(this.db, async (tx) => {
      const r = (await loadRules(tx, org)).find((r) => r.id === id);
      if (!r) throw new HttpProblem(404, "Rule not found");
      const t = (await this.triggers(tx, r, new Date(), true))[0]!;
      const message = this.message(t);
      return {
        message,
        parts: estimateSmsParts(message),
        estimatedCostSek:
          unitPrice(this.env) === null
            ? null
            : estimateSmsParts(message) * unitPrice(this.env)!,
        eligible: t.eligible,
        sourceTimestamp: t.timestamp.toISOString(),
        simulated: true,
      };
    });
  }
  private message(t: Trigger) {
    return smsText(
      t.properties.map((p) => p.name),
      t.description,
      t.source,
      t.timestamp,
      t.properties[0]
        ? `${this.env.APP_URL}/p/${t.properties[0].notification_link_key}`
        : `${this.env.APP_URL}/sms-rules`,
    );
  }
  async evaluateOrganization(
    org: string,
    testRuleId?: string,
    scenario: SimulationScenario = "success",
  ): Promise<number> {
    return notificationTransaction(this.db, async (tx) => {
      const now = new Date();
      const rules = (await loadRules(tx, org)).filter((r) =>
        testRuleId ? r.id === testRuleId : r.enabled,
      );
      if (testRuleId && !rules.length)
        throw new HttpProblem(404, "Rule not found");
      let n = 0;
      for (const r of rules) {
        const recipients = await tx.query<RecipientRow>(
          `SELECT * FROM sms_recipients WHERE organization_id=$1 AND id IN
          (SELECT recipient_id FROM alert_rule_recipients WHERE organization_id=$1 AND rule_id=$2)`,
          [org, r.id],
        );
        const triggers = await this.triggers(tx, r, now, !!testRuleId);
        for (const t of triggers)
          for (const recipient of recipients.rows)
            if (
              await this.enqueue(
                tx,
                r,
                recipient,
                t,
                now,
                !!testRuleId,
                scenario,
              )
            )
              n++;
      }
      return n;
    });
  }
  private async enqueue(
    tx: Queryable,
    r: RuleRow,
    recipient: RecipientRow,
    t: Trigger,
    now: Date,
    test: boolean,
    scenario: SimulationScenario,
  ): Promise<boolean> {
    const org = r.organization_id;
    const key = `${org}:${recipient.id}:${r.id}:${test ? `test:${randomUUID()}` : t.key}`;
    if (
      (
        await tx.query(
          "SELECT id FROM notification_outbox WHERE dedup_key=$1",
          [key],
        )
      ).rows.length
    )
      return false;
    const message = this.message(t),
      parts = estimateSmsParts(message),
      price = unitPrice(this.env),
      cost = price === null ? null : Math.ceil(parts * price * 10000) / 10000;
    let status = "queued",
      detail = t.detail ?? null;
    if (
      !t.eligible ||
      (!test && !r.enabled) ||
      !t.properties.length ||
      parts > 12
    )
      status = "not_eligible";
    else if (!recipient.consent_at) status = "pending_verification";
    else if (inQuietHours(r.config.quietHours, now, t.emergency))
      status = "suppressed_quiet_hours";
    else {
      const recent = await tx.query(
        `SELECT id FROM notification_outbox WHERE organization_id=$1 AND recipient_id=$2 AND rule_id=$3 AND NOT is_test
        AND status IN ('queued','processing','retry','simulated','unknown','accepted','sent','delivered') AND created_at > $4::timestamptz-make_interval(mins=>$5)
        AND ($6 OR EXISTS(SELECT 1 FROM notification_properties p WHERE p.organization_id=$1 AND p.notification_id=notification_outbox.id AND p.property_id=ANY($7::uuid[]))) LIMIT 1`,
        [
          org,
          recipient.id,
          r.id,
          now,
          r.config.cooldownMinutes,
          r.config.groupProperties,
          t.properties.map((p) => p.id),
        ],
      );
      if (!test && recent.rows.length) status = "suppressed_cooldown";
      const daily = (
        await tx.query<{ scope_key: string; messages: number }>(
          "SELECT scope_key,messages FROM notification_daily_usage WHERE organization_id=$1 AND day=($2::timestamptz AT TIME ZONE 'UTC')::date",
          [org, now],
        )
      ).rows;
      const count = (key: string) =>
        daily.find((x) => x.scope_key === key)?.messages ?? 0;
      const month = (
        await tx.query<{
          simulated_messages: number;
          estimated_cost_sek: string;
        }>(
          "SELECT * FROM notification_usage WHERE organization_id=$1 AND month=date_trunc('month',$2::timestamptz AT TIME ZONE 'UTC')::date",
          [org, now],
        )
      ).rows[0];
      // Sum both minute buckets touching the rolling 60-second window (conservative at boundaries).
      const perMinute = Number(
        (
          await tx.query<{ n: string }>(
            "SELECT coalesce(sum(messages),0) AS n FROM notification_rate_buckets WHERE minute>=date_trunc('minute',now()-interval '1 minute')",
          )
        ).rows[0]!.n,
      );
      if (
        status === "queued" &&
        (count("org") >= this.env.SMS_DAILY_LIMIT_PER_ORG ||
          count(`recipient:${scopeKey(recipient.phone_e164)}`) >=
            r.config.dailyRecipientLimit ||
          t.properties.some(
            (p) => count(`property:${p.id}`) >= r.config.dailyPropertyLimit,
          ) ||
          (month?.simulated_messages ?? 0) >=
            this.env.SMS_SIMULATION_MONTHLY_LIMIT ||
          perMinute >= this.env.SMS_MAX_MESSAGES_PER_MINUTE)
      )
        status = "suppressed_limit";
      // A positive configured cost cap can also exercise budget suppression in simulation.
      // Real caps stay zero; simulator can run without a price because it incurs no cost.
      if (status === "queued" && this.env.SMS_MAX_GLOBAL_MONTHLY_COST_SEK > 0) {
        const total = Number(
          (
            await tx.query<{ total: string }>(
              "SELECT coalesce(sum(estimated_cost_sek),0) AS total FROM notification_global_usage WHERE month=date_trunc('month',now() AT TIME ZONE 'UTC')::date",
            )
          ).rows[0]!.total,
        );
        if (
          cost === null ||
          total + cost > this.env.SMS_MAX_GLOBAL_MONTHLY_COST_SEK
        )
          status = "suppressed_cost";
      }
    }
    const verified =
      !!recipient.verified_at &&
      !!recipient.verification_expires_at &&
      recipient.verification_expires_at > now &&
      recipient.verification_method !== "fake_test";
    if (status === "queued" && !verified)
      detail =
        detail ??
        "Simulerad även utan verifiering. Riktig leverans kräver verifierat nummer.";
    const row = (
      await tx.query<{ id: string }>(
        `INSERT INTO notification_outbox(organization_id,rule_id,recipient_id,dedup_key,rule_name,property_names,message,parts,estimated_cost_sek,status,is_test,verification_required,simulation_scenario,detail,eligible_until)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(dedup_key) DO NOTHING RETURNING id`,
        [
          org,
          r.id,
          recipient.id,
          key,
          r.name,
          t.properties.map((p) => p.name),
          status === "queued" ? message : null,
          Math.min(parts, 12),
          cost,
          status,
          test,
          !verified,
          scenario,
          detail,
          new Date(now.getTime() + 30 * 60000),
        ],
      )
    ).rows[0];
    if (!row) return false;
    await tx.query(
      "UPDATE notification_outbox SET trigger_evidence=$2::jsonb WHERE id=$1",
      [row.id, JSON.stringify(t.evidence ?? {})],
    );
    await tx.query(
      "INSERT INTO notification_properties(organization_id,notification_id,property_id) SELECT $1,$2,unnest($3::uuid[])",
      [org, row.id, t.properties.map((p) => p.id)],
    );
    if (status === "queued") {
      await tx.query(
        `INSERT INTO notification_global_usage(month,messages,parts,estimated_cost_sek) VALUES(date_trunc('month',$1::timestamptz AT TIME ZONE 'UTC')::date,1,$2,$3)
        ON CONFLICT(month) DO UPDATE SET messages=notification_global_usage.messages+1,parts=notification_global_usage.parts+$2,estimated_cost_sek=notification_global_usage.estimated_cost_sek+$3`,
        [now, parts, cost ?? 0],
      );
      await tx.query(
        `INSERT INTO notification_rate_buckets(minute,messages) VALUES(date_trunc('minute',$1::timestamptz),1)
        ON CONFLICT(minute) DO UPDATE SET messages=notification_rate_buckets.messages+1`,
        [now],
      );
      await tx.query(
        `INSERT INTO notification_usage(organization_id,month,simulated_messages,simulated_parts,estimated_cost_sek)
        VALUES($1,date_trunc('month',$2::timestamptz AT TIME ZONE 'UTC')::date,1,$3,$4)
        ON CONFLICT(organization_id,month) DO UPDATE SET simulated_messages=notification_usage.simulated_messages+1,simulated_parts=notification_usage.simulated_parts+$3,estimated_cost_sek=notification_usage.estimated_cost_sek+$4`,
        [org, now, parts, cost ?? 0],
      );
      for (const scope of [
        "org",
        `recipient:${scopeKey(recipient.phone_e164)}`,
        ...t.properties.map((p) => `property:${p.id}`),
      ]) {
        await tx.query(
          `INSERT INTO notification_daily_usage(organization_id,day,scope_key,messages,estimated_cost_sek) VALUES($1,($2::timestamptz AT TIME ZONE 'UTC')::date,$3,1,$4)
          ON CONFLICT(organization_id,day,scope_key) DO UPDATE SET messages=notification_daily_usage.messages+1,estimated_cost_sek=notification_daily_usage.estimated_cost_sek+$4`,
          [org, now, scope, cost ?? 0],
        );
      }
    }
    return true;
  }
  async processOutbox(max = 25): Promise<number> {
    let processed = 0;
    for (let i = 0; i < max; i++) {
      const owner = randomUUID();
      const row = await notificationTransaction(this.db, async (tx) => {
        // Only the simulator can be retried after a crash. Future live attempts become unknown.
        await tx.query(
          "UPDATE notification_outbox SET status=CASE WHEN provider='simulated' THEN 'retry' ELSE 'unknown' END,lease_owner=NULL,lease_until=NULL WHERE status='processing' AND lease_until<now()",
        );
        await tx.query(
          "UPDATE notification_outbox SET status='failed',message=NULL,detail='Maximalt antal simuleringsförsök' WHERE status='retry' AND attempt_count>=3",
        );
        await tx.query(
          "UPDATE notification_outbox SET status='not_eligible',message=NULL,detail='Aktualitetsfönstret har löpt ut' WHERE status IN ('queued','retry') AND eligible_until<now()",
        );
        return (
          await tx.query<OutboxRow>(
            `UPDATE notification_outbox SET status='processing',lease_owner=$1,lease_until=now()+interval '60 seconds',attempt_count=attempt_count+1,updated_at=now()
          WHERE id=(SELECT id FROM notification_outbox WHERE status IN ('queued','retry') AND next_attempt_at<=now() AND attempt_count<3 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
            [owner],
          )
        ).rows[0];
      });
      if (!row) break;
      processed++;
      const recipient = (
        await this.db.query<RecipientRow>(
          "SELECT * FROM sms_recipients WHERE organization_id=$1 AND id=$2",
          [row.organization_id, row.recipient_id],
        )
      ).rows[0];
      const rules = await loadRules(this.db, row.organization_id);
      const rule = rules.find((r) => r.id === row.rule_id);
      let result;
      const current = await this.currentEligibility(row, rule, recipient);
      try {
        result =
          current === null
            ? await this.transport.send({
                to: recipient!.phone_e164,
                message: row.message!,
                dedupKey: row.id,
                scenario: row.simulation_scenario,
              })
            : { outcome: "disabled" as const, code: current };
      } catch {
        result = { outcome: "unknown" as const, code: "transport_exception" };
      }
      await notificationTransaction(this.db, async (tx) => {
        let status =
          result.outcome === "simulated"
            ? "simulated"
            : result.outcome === "unknown"
              ? "unknown"
              : result.outcome === "disabled"
                ? "delivery_disabled"
                : result.outcome === "unavailable" && row.attempt_count < 3
                  ? "retry"
                  : result.outcome === "rejected"
                    ? "simulated_failure"
                    : "failed";
        if (row.provider !== "simulated") status = "delivery_disabled";
        if (result.code === "quiet_hours") status = "suppressed_quiet_hours";
        if (result.code === "source_not_current") status = "not_eligible";
        const update = await tx.query(
          `UPDATE notification_outbox SET status=$3,detail=coalesce($4,detail),message=CASE WHEN $3='retry' THEN message ELSE NULL END,lease_owner=NULL,lease_until=NULL,
          next_attempt_at=now()+make_interval(secs=>$5),updated_at=now() WHERE id=$1 AND lease_owner=$2 AND status='processing' RETURNING id`,
          [
            row.id,
            owner,
            status,
            result.code ?? null,
            Math.min(900, 30 * 2 ** row.attempt_count),
          ],
        );
        if (update.rows.length)
          await tx.query(
            "INSERT INTO notification_attempts(notification_id,attempt,outcome) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [row.id, row.attempt_count, result.outcome],
          );
      });
    }
    return processed;
  }
  private async currentEligibility(
    row: OutboxRow,
    rule: RuleRow | undefined,
    recipient: RecipientRow | undefined,
  ): Promise<string | null> {
    const now = new Date();
    if (
      !recipient?.consent_at ||
      !rule ||
      (!rule.enabled && !row.is_test) ||
      !row.message
    )
      return "recipient_or_rule_disabled";
    const props = (
      await this.db.query<{ id: string }>(
        `SELECT p.id FROM notification_properties n JOIN properties p ON p.organization_id=n.organization_id AND p.id=n.property_id
      WHERE n.organization_id=$1 AND n.notification_id=$2 AND NOT p.sms_notifications_paused AND p.status<>'paused'`,
        [row.organization_id, row.id],
      )
    ).rows;
    if (!props.length || row.eligible_until <= now) return "source_not_current";
    const originalCount = Number(
      (
        await this.db.query<{ n: string }>(
          "SELECT count(*) AS n FROM notification_properties WHERE organization_id=$1 AND notification_id=$2",
          [row.organization_id, row.id],
        )
      ).rows[0]!.n,
    );
    if (props.length !== originalCount) return "source_not_current";
    let emergency = false;
    if (row.trigger_evidence.eventId) {
      const e = (
        await this.db.query<{
          version: number;
          status: string;
          valid_to: Date | null;
          last_seen_at: Date;
          level: string | null;
          source_id: string;
        }>(
          "SELECT version,status,valid_to,last_seen_at,level,source_id FROM source_events WHERE id=$1",
          [row.trigger_evidence.eventId],
        )
      ).rows[0];
      if (!e || e.version !== row.trigger_evidence.version)
        return "source_not_current";
      if (
        row.trigger_evidence.ended
          ? !["ended", "cancelled"].includes(e.status)
          : e.status !== "active" ||
            (e.valid_to && e.valid_to <= now) ||
            now.getTime() - e.last_seen_at.getTime() >
              (e.source_id === "krisinformation" ? 40 : 20) * 60000
      )
        return "source_not_current";
      emergency = e.level === "Red" || e.level === "VMA";
    } else if (row.trigger_evidence.forecastPropertyId) {
      if (rule.config.condition.category !== "forecast")
        return "source_not_current";
      const f = (
        await this.db.query<{
          reference_time: Date;
          series: { steps: ForecastStep[] };
        }>(
          "SELECT reference_time,series FROM property_forecasts WHERE organization_id=$1 AND property_id=$2",
          [row.organization_id, row.trigger_evidence.forecastPropertyId],
        )
      ).rows[0];
      if (
        !f ||
        !f.reference_time ||
        now.getTime() - f.reference_time.getTime() > 6 * 3600000 ||
        !Array.isArray(f.series.steps)
      )
        return "source_not_current";
      const c = rule.config.condition,
        value = forecastValue(c, f.series.steps, now);
      if (
        value === null ||
        !(c.operator === "gt" ? value > c.threshold : value < c.threshold)
      )
        return "source_not_current";
    } else return "source_not_current";
    return inQuietHours(rule.config.quietHours, now, emergency)
      ? "quiet_hours"
      : null;
  }
  async tick(): Promise<number> {
    const orgs = await this.db.query<{ organization_id: string }>(
      "SELECT DISTINCT organization_id FROM alert_rules WHERE sms_version=1 AND enabled",
    );
    let n = 0;
    for (const o of orgs.rows)
      n += await this.evaluateOrganization(o.organization_id);
    n += await this.processOutbox();
    await this.cleanup();
    return n;
  }
  async cleanup() {
    await this.db.query(
      "DELETE FROM notification_outbox WHERE created_at<now()-interval '30 days'",
    );
    await this.db.query(
      "DELETE FROM notification_daily_usage WHERE day<(now() AT TIME ZONE 'UTC')::date-32",
    );
    await this.db.query(
      "DELETE FROM notification_usage WHERE month<(date_trunc('month',now() AT TIME ZONE 'UTC')-interval '13 months')::date",
    );
    await this.db.query(
      "DELETE FROM notification_global_usage WHERE month<(date_trunc('month',now() AT TIME ZONE 'UTC')-interval '13 months')::date",
    );
    await this.db.query(
      "DELETE FROM notification_rate_buckets WHERE minute<now()-interval '2 days'",
    );
    await this.db.query(
      "UPDATE sms_recipients SET challenge_hash=NULL,challenge_expires_at=NULL WHERE challenge_expires_at<now()",
    );
    await this.db.query(
      "DELETE FROM sms_recipients r WHERE consent_at IS NULL AND verified_at IS NULL AND updated_at<now()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM alert_rule_recipients a WHERE a.organization_id=r.organization_id AND a.recipient_id=r.id)",
    );
  }
}
