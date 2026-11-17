import { formatClock, formatWeekdayClock, swedishDateKey, type ActivityItem } from '@fastighetsradar/domain';
import { SEV, WL } from '../design/tokens';

/** One row in the property's "Tidslinje" (desktop card and mobile section). */
export interface TimelineEntry {
  time: string;
  title: string;
  detail: string;
  c: string;
}

const DONE = 'oklch(0.55 0.12 155)';
const SOURCE: Record<string, string> = { smhi_warnings: 'SMHI', krisinformation: 'Krisinformation', trafikverket: 'Trafikverket', sl_deviations: 'SL', utility_outages: 'Nätbolag' };
const SEVERITY_C: Record<string, string> = { critical: SEV.critical.c, warning: SEV.warning.c, monitor: SEV.monitor.c, info: SEV.unknown.c, unknown: SEV.unknown.c };

const SMS_SENT = new Set(['simulated', 'accepted', 'sent', 'delivered']);
const SMS_FAILED = new Set(['simulated_failure', 'failed', 'unknown']);
const SMS_STOPPED: Record<string, string> = {
  suppressed_cooldown: 'karenstid',
  suppressed_quiet_hours: 'tysta timmar',
  suppressed_limit: 'gräns för antal SMS',
  suppressed_cost: 'kostnadstak',
  pending_verification: 'mottagare ej verifierad',
  not_eligible: 'mottagare ej behörig',
  delivery_disabled: 'utskick avstängt',
};

/** "14:32" today, "Igår 14:32" yesterday, otherwise "tis 14:32" (Swedish time). */
export function timelineTime(at: string, nowIso: string): string {
  const day = swedishDateKey(at);
  if (day === swedishDateKey(nowIso)) return formatClock(at);
  if (day === swedishDateKey(new Date(Date.parse(nowIso) - 86_400_000))) return `Igår ${formatClock(at)}`;
  return formatWeekdayClock(at);
}

function changeEntry(x: Extract<ActivityItem, { kind: 'change' }>): Omit<TimelineEntry, 'time'> {
  const ended = x.changeType === 'ended' || x.changeType === 'cancelled';
  // Outage headlines already name the operator; attribution is a long licence line.
  const src = SOURCE[x.sourceId] ?? x.sourceId;
  if (x.sourceId === 'smhi_warnings') {
    const lvl = x.level && x.level in WL ? WL[x.level as keyof typeof WL] : null;
    const name = !lvl ? 'Varning' : x.level === 'Info' ? 'Meddelande' : `${lvl.label} varning`;
    const verb = x.changeType === 'new' ? 'utfärdad' : x.changeType === 'updated' ? 'uppdaterad' : x.changeType === 'cancelled' ? 'återkallad' : 'avslutad';
    return {
      title: ended ? `${x.changeType === 'cancelled' ? 'Återkallad' : 'Avslutad'} — ${name.toLowerCase()}, ${x.headline}` : `${name} ${x.level === 'Info' ? verb.replace(/d$/, 't') : verb} — ${x.headline}`,
      detail: src,
      c: ended ? DONE : lvl?.fg ?? SEVERITY_C[x.severity] ?? SEV.unknown.c,
    };
  }
  if (x.sourceId === 'krisinformation') {
    const verb = x.changeType === 'new' ? 'VMA utfärdat' : x.changeType === 'updated' ? 'VMA uppdaterat' : 'VMA avslutat';
    return { title: `${verb} — ${x.headline}`, detail: src, c: ended ? DONE : WL.VMA.fg };
  }
  if (x.sourceId === 'utility_outages') {
    // Outage headlines are complete sentences ("Strömmen är tillbaka enligt …").
    return { title: x.headline, detail: src, c: ended ? DONE : SEVERITY_C[x.severity] ?? SEV.unknown.c };
  }
  const prefix = x.changeType === 'new' ? '' : x.changeType === 'updated' ? 'Uppdaterad — ' : 'Avslutad — ';
  return { title: prefix + x.headline, detail: src, c: ended ? DONE : SEVERITY_C[x.severity] ?? SEV.unknown.c };
}

function smsEntry(x: Extract<ActivityItem, { kind: 'sms' }>): Omit<TimelineEntry, 'time'> {
  const who = `${x.recipients} mottagare · ${x.ruleName}`;
  const label = x.isTest ? 'Testlarm' : 'SMS-larm';
  if (SMS_SENT.has(x.status)) return { title: `${label} skickat`, detail: who + (x.status === 'simulated' ? ' · simulerat' : ''), c: DONE };
  if (SMS_FAILED.has(x.status)) return { title: `${label} misslyckades`, detail: who, c: SEV.warning.c };
  return { title: `${label} skickades inte`, detail: `${who} · ${SMS_STOPPED[x.status] ?? x.status}`, c: SEV.unknown.c };
}

/** Live "Tidslinje": the API's activity log (newest first) as display rows. */
export function liveTimeline(items: ActivityItem[], nowIso: string): TimelineEntry[] {
  return [...items]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((x) => ({ time: timelineTime(x.at, nowIso), ...(x.kind === 'sms' ? smsEntry(x) : changeEntry(x)) }));
}
