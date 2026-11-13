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
  if (c.category === "forecast") return false;
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
