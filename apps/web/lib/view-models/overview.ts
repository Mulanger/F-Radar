import { nowcastBadge } from './nowcast';
import type { FeedItem, OfficialWarning, Portfolio, PropertySnapshot, PropertyStatus } from '@fastighetsradar/domain';
import { countActiveAlertEvents, formatClock, formatLongDate, formatNumber, formatShortDate, officialWarningEventKey, swedishDateKey, type RiskFactorKey } from '@fastighetsradar/domain';
import { C, EXPOSURE_SV, SEV, STATUS_ORDER, WL, riskStyle } from '../design/tokens';
import { smooth } from './chart';
import { filterByGroup, groupOptions } from './groups';
import { buildUpcomingEvents, upcomingCenter, upcomingUpdated } from './upcoming';
import { rulesFor, eventCounts } from './rules';
import { availability, isOfficialLevel, mappedExposure, metricValue, n0, riskScore, show } from './snapshot';

/**
 * Portfolio Overview view-model – a faithful port of the prototype's `renderVals()`
 * overview section, reading typed snapshots instead of hardcoded objects.
 */

export interface OverviewUi {
  ready: boolean;
  group: string;
  isSmsOn: (s: PropertySnapshot) => boolean;
  isRuleOn: (id: string, fallback: boolean) => boolean;
}

type CountedStatus = (typeof STATUS_ORDER)[number];
const sev = (st: PropertyStatus) => SEV[st] ?? SEV.unknown;
const riskOf = riskScore;
/** Properties where a risk factor reaches "Info" (watch) or higher (ADR 0003) – static data alone never counts. */
const factorAtLeastWatch = (s: PropertySnapshot, key: RiskFactorKey) => (s.riskIndex?.factors.find((f) => f.key === key)?.points ?? 0) >= 25;
const STATUS_RANK: Record<string, number> = { unknown: 0, normal: 0, monitor: 1, warning: 2, critical: 3 };
const WARN_RANK: Record<string, number> = { Yellow: 1, Orange: 2, Red: 3, VMA: 4 };
const worstWarning = (s: PropertySnapshot) =>
  [...s.warnings].filter((w) => isOfficialLevel(w.level)).sort((a, b) => (WARN_RANK[b.level] ?? 0) - (WARN_RANK[a.level] ?? 0))[0];
const worstRank = (s: PropertySnapshot) => WARN_RANK[worstWarning(s)?.level ?? ''] ?? 0;
/** "Orange varning (kraftig vind)" / "VMA (brand)" – the authority's own type text, first letter lower-cased. */
function describeWorst(s: PropertySnapshot): string {
  const w = worstWarning(s);
  // Status raised by an outage at the address (or another non-warning reason): use its stated reason.
  if (!w) return s.property.statusReason ?? sev(s.property.status).label;
  const type = w.type.split(' — ')[0]!;
  const what = type.charAt(0).toLocaleLowerCase('sv') + type.slice(1);
  if (w.level === 'VMA') return `${w.geo.match === 'county' ? 'VMA i länet' : 'VMA'} (${what})`;
  return `${WL[w.level].label} varning (${what})`;
}

/** One property behind a weather KPI pill ("Väderhändelser idag"). */
export interface WxItem {
  propertyId: string;
  name: string;
  text: string;
}
export interface WxSplit {
  label: string;
  n: number;
  /** Heading of the detail card, e.g. "Kraftigt regn". */
  title: string;
  /** The threshold, shown under the heading. */
  rule: string;
  items: WxItem[];
}

export { filterByGroup } from './groups';

/**
 * Feed time: "22:00" today, "igår 22:00" yesterday, otherwise "17 nov 22:00" – a recurring night
 * closure must not make yesterday's "Ny 22:00" look like tonight's.
 */
// Today and yesterday of the last `nowIso`: the same for every row of one feed.
let days: { nowIso: string; today: string; yesterday: string } | null = null;

export function feedTime(iso: string, nowIso: string): string {
  if (days?.nowIso !== nowIso) days = { nowIso, today: swedishDateKey(nowIso), yesterday: swedishDateKey(new Date(Date.parse(nowIso) - 86_400_000)) };
  const day = swedishDateKey(iso);
  if (day === days.today) return formatClock(iso);
  return `${day === days.yesterday ? 'igår' : formatShortDate(iso).replace(/\.$/, '')} ${formatClock(iso)}`;
}

/** Same published warning may reach several properties or be split into separate SMHI areas. */
function buildWarningPreview(properties: PropertySnapshot[]) {
  const groups = new Map<string, { warning: OfficialWarning; properties: Set<string>; regions: Set<string>; publishedAt: number }>();

  for (const { property, warnings } of properties) {
    for (const warning of warnings) {
      if (!isOfficialLevel(warning.level)) continue;
      const key = officialWarningEventKey(warning);
      const publishedAt = Date.parse(warning.issuedAt ?? warning.validFrom ?? '') || 0;
      let group = groups.get(key);
      if (!group) {
        group = { warning, properties: new Set(), regions: new Set(), publishedAt };
        groups.set(key, group);
      }
      if ((WARN_RANK[warning.level] ?? 0) > (WARN_RANK[group.warning.level] ?? 0)) group.warning = warning;
      group.publishedAt = Math.max(group.publishedAt, publishedAt);
      group.properties.add(property.id);
      if (warning.region) group.regions.add(warning.region);
    }
  }

  return Array.from(groups, ([id, { warning, properties, regions, publishedAt }]) => ({
    id,
    level: warning.level,
    title: warning.level === 'VMA' ? warning.type.replace('Viktigt meddelande till allmänheten — ', 'VMA — ') : warning.type,
    region: regions.size === 1 ? [...regions][0] : undefined,
    affected: properties.size,
    publishedAt,
  })).sort((a, b) => (WARN_RANK[b.level] ?? 0) - (WARN_RANK[a.level] ?? 0) || b.publishedAt - a.publishedAt || a.id.localeCompare(b.id));
}

export function buildOverviewVM(portfolio: Portfolio, ui: OverviewUi) {
  const { ready } = ui;
  const list = filterByGroup(portfolio, ui.group);
  const sorted = [...list].sort((a, b) => (riskOf(b) ?? -1) - (riskOf(a) ?? -1));
  const counts: Record<CountedStatus, number> = { normal: 0, monitor: 0, warning: 0, critical: 0 };
  list.forEach((s) => {
    if (s.property.status in counts) counts[s.property.status as CountedStatus]++;
  });
  const n = list.length || 1;

  const warningPreview = buildWarningPreview(list);
  const warnAff = list.filter((snap) => snap.warnings.some((warning) => isOfficialLevel(warning.level))).length;
  const wc: Partial<Record<keyof typeof WL, number>> = {};
  warningPreview.forEach(({ level }) => (wc[level] = (wc[level] ?? 0) + 1));

  const rain = (s: PropertySnapshot) => metricValue(s, 'weather.precipitation_24h');
  const gust = (s: PropertySnapshot) => metricValue(s, 'weather.wind_gust');
  const feels = (s: PropertySnapshot) => metricValue(s, 'weather.apparent_temperature');
  const temp = (s: PropertySnapshot) => metricValue(s, 'weather.air_temperature');
  const aqi = (s: PropertySnapshot) => metricValue(s, 'air_quality.index');

  // Weather KPI: which properties pass each threshold and by how much (worst first) – shown when a pill is clicked.
  const wxItems = (value: (s: PropertySnapshot) => number | null, hit: (v: number) => boolean, worst: 'max' | 'min', text: (v: number) => string): WxItem[] =>
    list
      .flatMap((s) => {
        const v = value(s);
        return v !== null && hit(v) ? [{ v, propertyId: s.property.id, name: s.property.name }] : [];
      })
      .sort((a, b) => (worst === 'max' ? b.v - a.v : a.v - b.v))
      .map(({ v, propertyId, name }) => ({ propertyId, name, text: text(v) }));
  const wxRain = wxItems(rain, (v) => v >= 15, 'max', (v) => `Väntar ${formatNumber(v, 1)} mm regn kommande 24 h`);
  const wxWind = wxItems(gust, (v) => v >= 15, 'max', (v) => `Byvind ${formatNumber(v, 0)} m/s just nu`);
  const wxFrost = wxItems(feels, (v) => v < 0, 'min', (v) => `Känns som ${formatNumber(v, 0)}° just nu`);
  const wxR = wxRain.length;
  const wxW = wxWind.length;
  const wxF = wxFrost.length;

  const smsProps = list.filter(ui.isSmsOn);
  const smsN = smsProps.reduce((a, s) => a + rulesFor(s, ui.isRuleOn).filter((r) => r.on).length, 0);
  const smsMax = list.reduce((a, s) => a + s.alertRules.length, 0);
  const totalAlerts = countActiveAlertEvents(list);

  // The fixture supplies a relative shape, not a history of event totals.
  const weights = portfolio.demoTrends?.alertsSparkWeights ?? [];
  const peakWeight = Math.max(1, ...weights);
  const spark = totalAlerts > 0 && weights.length > 1
    ? smooth(weights.map((v, i) => [(i / (weights.length - 1)) * 100, 28 - (v / peakWeight) * 24]))
    : '';

  const maxRainP = [...list].sort((a, b) => n0(rain(b)) - n0(rain(a)))[0];
  const gustP = [...list].sort((a, b) => n0(gust(b)) - n0(gust(a)))[0];
  const temps = list.map(temp).filter((v): v is number => v !== null);

  // Hero status: properties worth monitoring (Info or higher) and the most affected one.
  const C30 = 2 * Math.PI * 28;
  const flagged = list.filter((s) => STATUS_RANK[s.property.status] >= 1);
  const top = [...flagged].sort((a, b) => STATUS_RANK[b.property.status] - STATUS_RANK[a.property.status] || worstRank(b) - worstRank(a))[0];
  const assessedN = STATUS_ORDER.reduce((a, k) => a + counts[k], 0);
  const unassessedN = list.length - assessedN;
  /** `n` is null when nothing can be assessed (shown as "—", never 0). `label` is the worst status. */
  const status = (() => {
    const base = { total: list.length, n: null as number | null, label: SEV.unknown.label, fill: 0, c: SEV.unknown.c };
    if (!list.length) return { ...base, headline: 'Inga fastigheter ännu', detail: 'Lägg till en fastighet för att starta bevakningen' };
    if (!assessedN) return { ...base, headline: 'Status kan inte bedömas', detail: 'Varningskällorna är inte aktuella just nu' };
    const tail = unassessedN ? ` · ${unassessedN} ej bedömda` : '';
    return {
      ...base,
      n: flagged.length,
      headline: `${flagged.length} av ${list.length} ${list.length === 1 ? 'fastighet' : 'fastigheter'} att bevaka`,
      detail: (top ? `Högst: ${top.property.name} · ${describeWorst(top)}` : 'Inga fastigheter att bevaka just nu') + tail,
      label: top ? sev(top.property.status).label : SEV.normal.label,
      c: top ? sev(top.property.status).c : SEV.normal.c,
      fill: flagged.length / list.length,
    };
  })();

  // Per risk factor: properties at "Info" (watch) or higher. Regional news, static flood mapping, traffic and
  // outdoor air can never reach that alone, so they do not inflate these bars (ADR 0003).
  const catsRaw = [
    { label: 'Väder', n: list.filter((s) => factorAtLeastWatch(s, 'weather')).length, c: 'oklch(0.6 0.1 240)' },
    { label: 'Vatten', n: list.filter((s) => factorAtLeastWatch(s, 'water')).length, c: 'oklch(0.62 0.08 215)' },
    { label: 'VMA', n: list.filter((s) => factorAtLeastWatch(s, 'vma')).length, c: 'oklch(0.6 0.17 28)' },
    { label: 'El och värme', n: list.filter((s) => factorAtLeastWatch(s, 'power')).length, c: 'oklch(0.66 0.13 70)' },
  ];
  const catMax = Math.max(1, ...catsRaw.map((c) => c.n));

  const lvlC = { Low: 1, Medium: 2, High: 3, unknown: 0 } as const;
  const rows = sorted.map((s) => {
    const p = s.property;
    const st = sev(p.status);
    const w = s.warnings.find((x) => isOfficialLevel(x.level));
    const on = ui.isSmsOn(s);
    const flood = mappedExposure(s);
    const fl = lvlC[flood];
    const fc = flood === 'High' ? 'oklch(0.58 0.1 225)' : flood === 'Medium' ? 'oklch(0.68 0.08 220)' : 'oklch(0.75 0.05 220)';
    const ev = eventCounts(s);
    const a = aqi(s);
    const risk = riskOf(s);
    return {
      id: p.id,
      name: p.name,
      nowcast: nowcastBadge(s, portfolio.generatedAt),
      address: p.address,
      status: st.label,
      c: st.c,
      bg: st.bg,
      temp: show(temp(s)),
      rain: show(rain(s)),
      wind: show(metricValue(s, 'weather.wind_speed')),
      hum: show(metricValue(s, 'weather.relative_humidity')),
      warn: w ? WL[w.level].label + ' · ' + w.type.split(' — ')[0] : 'Ingen',
      wBg: w ? WL[w.level].bg : C.page,
      wFg: w ? WL[w.level].fg : C.text4,
      flood: flood === 'unknown' ? '—' : EXPOSURE_SV[flood] ?? flood,
      f1: fl >= 1 ? fc : C.trackOff,
      f2: fl >= 2 ? fc : C.trackOff,
      f3: fl >= 3 ? fc : C.trackOff,
      nearby: `${ev.traffic} trafik · ${ev.crisis} länsinfo`,
      aq: p.origin === 'live' ? s.monitoring?.airIndex?.label ?? '—' : a === null ? '—' : a > 75 ? 'Dålig' : a > 50 ? 'Måttlig' : 'Bra',
      aqC: a === null ? SEV.unknown.c : p.origin === 'live' ? (a >= 4 ? SEV.warning.c : SEV.unknown.c) : a > 75 ? SEV.critical.c : a > 50 ? SEV.warning.c : SEV.normal.c,
      alerts: s.activeAlertCount,
      risk: show(risk),
      riskW: ready && risk !== null ? risk + '%' : '0%',
      riskC: riskStyle(s.riskIndex?.level).c,
      riskTitle: s.riskIndex ? `${riskStyle(s.riskIndex.level).label}: ${s.riskIndex.summary}` : 'Ej bedömd',
      smsOn: on,
      snapshot: s,
    };
  });

  const byId = new Map(portfolio.properties.map((s) => [s.property.id, s]));
  const listIds = new Set(list.map((s) => s.property.id));
  const feed = portfolio.feed
    .filter((f) => listIds.has(f.propertyId))
    .map((f) => {
      // A current event with a position opens in colour; an ended one whose stretch is still stored, greyed out.
      // The feed row may be about any message of a merged closure (the feed and the list pick their own).
      const ev = f.eventId ? byId.get(f.propertyId)?.events.find((e) => (e.id === f.eventId || e.memberIds?.includes(f.eventId!)) && e.location) : undefined;
      const ended = !ev && !!f.eventId && f.eventEndedOnMap === true;
      // Fetch the exact traffic event on open, including updates to its source text.
      const opensTrafficDetails = f.origin === 'live' && f.sourceId === 'trafikverket' && !!f.eventId;
      const single = opensTrafficDetails || !ev && !!f.eventId && (ended || f.outageOnMap === true);
      return {
        id: f.id,
        rowKey: opensTrafficDetails ? `${f.propertyId}:${f.eventId}` : f.id,
        t: feedTime(f.publishedAt, portfolio.generatedAt),
        unreadUpdateId: f.unreadUpdateId ?? null,
        acknowledgementUpdate: f.acknowledgementUpdate === true,
        eventGroupKey: feedEventKey(f),
        title: f.acknowledgementUpdate ? f.title.replace(/^Uppdaterad: /, '') : f.title,
        src: f.sourceLabel,
        c: sev(f.severity).c,
        bg: sev(f.severity).bg,
        prop: byId.get(f.propertyId)?.property.name ?? '—',
        propertyId: f.propertyId,
        /** The source event behind the row: its page lists every property it reaches (Fas 2 / S-09). */
        eventId: f.eventId ?? null,
        /** Event to open in the map view, or null when the row has nothing to show there. */
        mapEventId: single ? f.updatedEventId ?? f.eventId! : ev?.id ?? null,
        /** The event has ended: the map shows where it was, greyed out. */
        mapEnded: ended,
        /** Load this one event for the map (ended event or utility outage) instead of the property's list. */
        mapSingle: single,
        opensTrafficDetails,
        /** Must be acknowledged by someone in the organization (warnings, VMA, critical, outages). */
        ackRequired: f.ackRequired === true,
        acknowledgedAt: f.acknowledgedAt ?? null,
        /** "Nattarbete 21–04" – a moon on the card. */
        nightWork: f.nightWork ?? null,
      };
    });

  const groups = groupOptions(portfolio).map((g) => ({ ...g, active: ui.group === g.id }));

  const avail = availability(portfolio);
  const assessed = STATUS_ORDER.reduce((a, k) => a + counts[k], 0);
  const notAssessed = list.length - assessed;

  return {
    list,
    avail,
    isEmpty: portfolio.properties.length === 0,
    assessed,
    notAssessed,
    dateLine: `${formatLongDate(portfolio.generatedAt)} · ${portfolio.regionLabel}${portfolio.origin === 'demo_fixture' ? ' · Demodata' : ''}`,
    updatedAt: formatClock(portfolio.generatedAt),
    narrative: portfolio.narrative,
    groups,
    hero: {
      count: list.length,
      status,
      statusDash: `${ready ? status.fill * C30 : 0} ${C30}`,
      avgTemp: temps.length ? formatNumber(temps.reduce((a, b) => a + b, 0) / temps.length, 1) : '—',
      maxRain: show(maxRainP ? rain(maxRainP) : null),
      maxRainAt: maxRainP?.property.name ?? '—',
      gust: show(gustP ? gust(gustP) : null),
      gustAt: gustP?.property.name ?? '—',
    },
    kpi: {
      total: list.length,
      bar: STATUS_ORDER.filter((k) => counts[k]).map((k) => ({ key: k, w: (counts[k] / n) * 100 + '%', c: SEV[k].c })),
      barLabel:
        notAssessed === list.length && list.length > 0
          ? `${list.length} ej bedömda ännu · inga offentliga datakällor anslutna`
          : STATUS_ORDER.map((k) => `${SEV[k].label}: ${counts[k]}`).join(' · ') + (notAssessed ? ` · Ej bedömda: ${notAssessed}` : ''),
      alerts: totalAlerts,
      spark,
      alertsDelta: portfolio.demoTrends?.alertsDeltaLabel ?? null,
      alertsSince: portfolio.demoTrends?.alertsSince ?? '',
      warnings: warningPreview.length,
      warnAffected: warnAff,
      warnChips: (Object.keys(wc) as Array<keyof typeof WL>).map((k) => ({ key: k, label: WL[k].label + ' ×' + wc[k], bg: WL[k].bg, fg: WL[k].fg })),
      wx: wxR + wxW + wxF,
      wxSplit: [
        { label: 'Regn', n: wxR, title: 'Kraftigt regn', rule: 'Minst 15 mm nederbörd kommande 24 h (SMHI-prognos)', items: wxRain },
        { label: 'Vind', n: wxW, title: 'Hård vind', rule: 'Byvind minst 15 m/s just nu (SMHI-prognos)', items: wxWind },
        { label: 'Frost', n: wxF, title: 'Minusgrader', rule: 'Upplevd temperatur under 0° just nu', items: wxFrost },
      ] satisfies WxSplit[],
      sms: smsN,
      smsW: ready ? (smsN / Math.max(1, smsMax)) * 100 + '%' : '0%',
      smsSub: `${smsProps.length} av ${list.length} fastigheter med SMS aktiverat`,
      /** SMS alerts switched on for at least one property (hero shows a check / cross, not a count). */
      smsOn: avail.alerts && smsProps.length > 0,
    },
    legend: [
      ...STATUS_ORDER.map((k) => ({ key: k as string, label: SEV[k].label, c: SEV[k].c, n: counts[k] })),
      ...(notAssessed ? [{ key: 'unknown', label: SEV.unknown.label, c: SEV.unknown.c, n: notAssessed }] : []),
    ],
    warningPreview,
    feed,
    rows,
    cats: catsRaw.map((c) => ({ ...c, w: ready ? (c.n / catMax) * 100 + '%' : '0%' })),
    upcoming: buildUpcomingEvents(portfolio, new Set(list.map((s) => s.property.id))),
    /** Centre of the properties in view (darkness on the upcoming timeline) and the forecast time. */
    upcomingCenter: upcomingCenter(portfolio, new Set(list.map((s) => s.property.id))),
    upcomingUpdated: upcomingUpdated(portfolio),
    /** Reference "now" for grouping upcoming rows into today / tomorrow (source clock in demo). */
    referenceAt: portfolio.generatedAt,
  };
}

export type OverviewVM = ReturnType<typeof buildOverviewVM>;
export type OverviewFeedRow = OverviewVM['feed'][number];

/** Collect matching properties under one card for the same source revision. */
/** What joins feed rows of one event into one card (`groupFeedRows`); null: a card of its own. */
export function feedEventKey(f: FeedItem): string | null {
  return f.eventId
    ? JSON.stringify([f.eventGroupId ?? [f.sourceId, f.eventId, f.updatedEventId, f.updatedAt ?? f.publishedAt], f.title, f.severity, f.nightWork])
    : null;
}

/** How many cards `groupFeedRows` makes of these items, without building the view model (S-20). */
export function countFeedEvents(items: FeedItem[]): number {
  let cards = 0;
  const events = new Map<string, Set<string>>();
  for (const f of items) {
    const key = feedEventKey(f);
    const members = key ? events.get(key) : undefined;
    if (members && !members.has(f.propertyId)) {
      members.add(f.propertyId);
      continue;
    }
    cards++;
    if (key && !members) events.set(key, new Set([f.propertyId]));
  }
  return cards;
}

export function groupFeedRows(feed: OverviewVM['feed']): OverviewFeedRow[][] {
  const groups: OverviewFeedRow[][] = [];
  const events = new Map<string, OverviewFeedRow[]>();
  for (const row of feed) {
    const key = row.eventGroupKey;
    const group = key ? events.get(key) : undefined;
    if (group && !group.some((member) => member.propertyId === row.propertyId)) {
      group.push(row);
    } else {
      const rows = [row];
      groups.push(rows);
      if (key && !group) events.set(key, rows);
    }
  }
  return groups;
}
