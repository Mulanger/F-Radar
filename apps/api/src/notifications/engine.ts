import type {
  NotificationCondition,
  NotificationRuleInput,
} from "@fastighetsradar/domain";
import {
  precipitationTotal,
  type ForecastStep,
} from "@fastighetsradar/integrations";

export function inQuietHours(
  q: NotificationRuleInput["quietHours"],
  now: Date,
  emergency: boolean,
): boolean {
  if (!q.enabled || (emergency && q.emergencyException)) return false;
  const hm = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return q.start < q.end
    ? hm >= q.start && hm < q.end
    : hm >= q.start || hm < q.end;
}
export function forecastValue(
  c: Extract<NotificationCondition, { category: "forecast" }>,
  steps: ForecastStep[],
  now: Date,
): number | null {
  if (c.metric === "precipitationMean")
    return precipitationTotal(steps, now, c.hours);
  const until = now.getTime() + c.hours * 3600000;
  const selected = steps.filter(
    (s) => Date.parse(s.time) >= now.getTime() && Date.parse(s.time) <= until,
  );
  if (
    !selected.length ||
    selected.some((s) => s[c.metric] === null || !Number.isFinite(s[c.metric]))
  )
    return null;
  if (Date.parse(selected.at(-1)!.time) < until - 3600000) return null;
  const values = selected.map((s) => s[c.metric] as number);
  return c.operator === "lt" ? Math.min(...values) : Math.max(...values);
}
export function thresholdTransition(
  c: Extract<NotificationCondition, { category: "forecast" }>,
  value: number | null,
  previous: boolean | null,
) {
  if (value === null || !Number.isFinite(value))
    return { latched: previous, trigger: false };
  const beyond =
    c.operator === "gt" ? value > c.threshold : value < c.threshold;
  const rearmed =
    c.operator === "gt"
      ? value <= c.threshold - c.hysteresis
      : value >= c.threshold + c.hysteresis;
  const latched = previous === true ? !rearmed : beyond;
  // First snapshot is a baseline: existing conditions never become a backfilled SMS.
  return { latched, trigger: previous === false && beyond };
}
export interface EventCandidate {
  source_id: string;
  external_id: string;
  version: number;
  level: string | null;
  severity: string;
  data_class: string;
  status: string;
  headline: string;
  event_type: string;
  published_at: Date | null;
  source_updated_at: Date | null;
  valid_to: Date | null;
  last_seen_at: Date;
  change_type: string;
  created_at: Date;
  dedup_key: string;
  distance_m: string | null;
  match_method: string | null;
}
export function eventEligible(
  c: NotificationCondition,
  e: EventCandidate,
  now: Date,
  activatedAt: Date,
  test = false,
): boolean {
  // Forecast rules use thresholds; outage rules use outageSmsPhase.
  if (c.category === "forecast" || c.category === "power_outage") return false;
  if (
    !test &&
    (e.created_at < activatedAt ||
      now.getTime() - e.created_at.getTime() > 30 * 60000)
  )
    return false;
  if (
    c.category === "smhi_warning" &&
    (e.source_id !== "smhi_warnings" || !c.levels.includes(e.level as "Yellow"))
  )
    return false;
  if (
    c.category === "vma" &&
    (e.source_id !== "krisinformation" ||
      e.level !== "VMA" ||
      e.data_class !== "OFFICIAL_WARNING")
  )
    return false;
  const ended = e.change_type === "ended" || e.change_type === "cancelled";
  if (ended)
    return (
      c.category !== "traffic" &&
      c.cancellations &&
      (e.status === "ended" || e.status === "cancelled")
    );
  if (e.status !== "active" || (e.valid_to && e.valid_to <= now)) return false;
  const freshness = e.source_id === "krisinformation" ? 40 * 60000 : 20 * 60000;
  if (now.getTime() - e.last_seen_at.getTime() > freshness) return false;
  if (e.change_type === "updated" && !c.updates) return false;
  if (!test && !e.dedup_key.endsWith(`:v${e.version}`)) return false;
  const issued = e.source_updated_at ?? e.published_at;
  if (!test && e.change_type === "new" && (!issued || issued < activatedAt))
    return false;
  if (c.category === "smhi_warning")
    return (
      e.source_id === "smhi_warnings" &&
      e.data_class === "OFFICIAL_WARNING" &&
      c.levels.includes(e.level as "Yellow") &&
      e.match_method === "polygon_intersection"
    );
  if (c.category === "vma")
    return (
      e.source_id === "krisinformation" &&
      e.data_class === "OFFICIAL_WARNING" &&
      e.level === "VMA" &&
      ["county", "municipality"].includes(e.match_method ?? "")
    );
  const start =
    e.change_type === "updated"
      ? e.source_updated_at
      : (e.published_at ?? e.source_updated_at);
  return (
    e.source_id === "trafikverket" &&
    e.severity === "warning" &&
    e.distance_m !== null &&
    Number(e.distance_m) <= c.radiusMeters &&
    !!start &&
    now.getTime() - start.getTime() <= 24 * 3600000
  );
}
export const metricLabels = {
  precipitationMean: ["nederbörd", "mm"],
  windSpeed: ["vind", "m/s"],
  windGust: ["byvind", "m/s"],
  airTemperature: ["temperatur", "C"],
  relativeHumidity: ["luftfuktighet", "%"],
} as const;
export function smsText(
  names: string[],
  description: string,
  source: string,
  timestamp: Date,
  link: string,
): string {
  const where =
    names.length === 1
      ? names[0]!.slice(0, 65)
      : `${names[0]!.slice(0, 40)} + ${names.length - 1} fastigheter`;
  const time = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
  return `FastighetsRadar: ${where}. ${description.replace(/[\r\n]+/g, " ").slice(0, 155)}. ${time}. Källa: ${source}. ${link}`;
}

/* ------------------------------------------------------------------ */
/* Grid-operator outages (docs/plans/stromavbrott.md §7)                */
/* ------------------------------------------------------------------ */

export type OutageSmsPhase = "start" | "planned" | "change" | "restored";

export interface OutageCandidate {
  change_type: string;
  created_at: Date;
  last_seen_at: Date;
  source_updated_at: Date | null;
  match_method: string | null;
  geocode_precision: string | null;
  position_source: string | null;
  utility: string;
  kind: string;
  state: string;
  planned_start: Date | null;
}

const SMS_MATCHES = ["outage_polygon", "outage_address"];

/**
 * Which SMS (if any) a change of a matched outage may produce for a power_outage rule.
 * Anti-spam: only polygon/address matches with a confirmed property position; never area/near
 * matches, never kind 'unknown'. "restored"/"change" additionally require an earlier SMS about the
 * same outage (checked when enqueuing).
 */
export function outageSmsPhase(
  c: Extract<NotificationCondition, { category: "power_outage" }>,
  e: OutageCandidate,
  now: Date,
  activatedAt: Date,
  test = false,
): OutageSmsPhase | null {
  if (!SMS_MATCHES.includes(e.match_method ?? "")) return null;
  // A polygon match needs a confirmed position; an address-list match is by the property's address.
  const confirmed =
    e.match_method === "outage_address" ||
    e.position_source === "manual_pin" ||
    e.position_source === "manual_adjusted" ||
    e.geocode_precision === "building";
  if (!confirmed) return null;
  if (!(c.utilities as string[]).includes(e.utility)) return null;
  if (e.kind === "unknown") return null;
  if (
    !test &&
    (e.created_at < activatedAt ||
      now.getTime() - e.created_at.getTime() > 30 * 60000)
  )
    return null;
  const ended = e.change_type === "ended";
  if (ended) {
    if (e.state === "restored") return c.restored ? "restored" : null;
    // A vanished unplanned/unknown outage is not known to be over: no SMS at all (never "tillbaka").
    if (e.state === "withdrawn") return e.kind === "planned" && c.changes ? "change" : null;
    return null;
  }
  if (!test && now.getTime() - e.last_seen_at.getTime() > 20 * 60000) return null;
  if (e.change_type === "new") {
    if (e.kind === "unplanned" && e.state === "ongoing") return c.unplanned ? "start" : null;
    if (e.kind === "planned" && e.state === "upcoming")
      return c.planned && !!e.planned_start && e.planned_start.getTime() > now.getTime() + 2 * 3600000 ? "planned" : null;
    return null;
  }
  if (e.change_type === "updated" && e.kind === "planned" && e.state === "upcoming")
    return c.changes ? "change" : null;
  return null;
}

/** Reminder window: 18:00–21:00 Stockholm time on the day before a planned start. */
export function inReminderWindow(plannedStart: Date, now: Date): boolean {
  const day = (d: Date) =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  // Start is on the next local calendar day (now + 24 h stays on that day for 18–21 local times, DST included)…
  if (day(plannedStart) !== day(new Date(now.getTime() + 24 * 3600000))) return false;
  const hm = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  // …and it is evening now.
  return hm >= "18:00" && hm < "21:00";
}
