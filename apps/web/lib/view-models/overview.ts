import { nowcastVM } from './nowcast';
import type { Portfolio, PropertySnapshot, PropertyStatus } from '@fastighetsradar/domain';
import { formatClock, formatLongDate, formatNumber, portfolioRisk, type RiskFactorKey } from '@fastighetsradar/domain';
import { C, EXPOSURE_SV, SEV, STATUS_ORDER, WL, riskStyle } from '../design/tokens';
import { smooth } from './chart';
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
/** Properties where a risk factor reaches "Bevaka" or higher (ADR 0003) – static data alone never counts. */
const factorAtLeastWatch = (s: PropertySnapshot, key: RiskFactorKey) => (s.riskIndex?.factors.find((f) => f.key === key)?.points ?? 0) >= 25;

export function filterByGroup(p: Portfolio, group: string) {
  return group === 'all' ? p.properties : p.properties.filter((s) => s.property.segment === group);
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

  // Official warnings (unique level+type, excluding informational)
  const warnSet: Record<string, keyof typeof WL> = {};
  let warnAff = 0;
  list.forEach((s) => {
    const ws = s.warnings.filter((w) => isOfficialLevel(w.level));
    if (ws.length) warnAff++;
    ws.forEach((w) => (warnSet[w.level + w.type] = w.level));
  });
  const wl = Object.values(warnSet);
  const wc: Partial<Record<keyof typeof WL, number>> = {};
  wl.forEach((l) => (wc[l] = (wc[l] || 0) + 1));

  const rain = (s: PropertySnapshot) => metricValue(s, 'weather.precipitation_24h');
  const gust = (s: PropertySnapshot) => metricValue(s, 'weather.wind_gust');
  const feels = (s: PropertySnapshot) => metricValue(s, 'weather.apparent_temperature');
  const temp = (s: PropertySnapshot) => metricValue(s, 'weather.air_temperature');
  const aqi = (s: PropertySnapshot) => metricValue(s, 'air_quality.index');

  const wxR = list.filter((s) => n0(rain(s)) >= 15).length;
  const wxW = list.filter((s) => n0(gust(s)) >= 15).length;
  const wxF = list.filter((s) => feels(s) !== null && feels(s)! < 0).length;

  const smsProps = list.filter(ui.isSmsOn);
  const smsN = smsProps.reduce((a, s) => a + rulesFor(s, ui.isRuleOn).filter((r) => r.on).length, 0);
  const smsMax = list.reduce((a, s) => a + s.alertRules.length, 0);
  const totalAlerts = list.reduce((a, s) => a + s.activeAlertCount, 0);

  const weights = portfolio.demoTrends?.alertsSparkWeights ?? [];
  const sp = weights.map((v) => (v * totalAlerts) / 14);
  const spMax = Math.max(...sp, 1);
  const spark = sp.length ? smooth(sp.map((v, i) => [(i / (sp.length - 1)) * 100, 28 - (v / spMax) * 24])) : '';

  const pr = portfolioRisk(list.map((s) => ({ name: s.property.name, risk: s.riskIndex })));
  const avgRisk = pr.score;
  const maxRainP = [...list].sort((a, b) => n0(rain(b)) - n0(rain(a)))[0];
  const gustP = [...list].sort((a, b) => n0(gust(b)) - n0(gust(a)))[0];
  const temps = list.map(temp).filter((v): v is number => v !== null);

  const C30 = 2 * Math.PI * 28;
  const DC = 2 * Math.PI * 54;
  let cum = 0;
  const donut = STATUS_ORDER.map((k) => {
    const len = ready ? (counts[k] / n) * DC : 0;
    const o = { key: k, c: SEV[k].c, dash: `${Math.max(0, len - 3)} ${DC}`, off: `${-cum}` };
    cum += len;
    return o;
  });

  // Per risk factor: properties at "Bevaka" or higher. Regional news, static flood mapping, traffic and
  // outdoor air can never reach that alone, so they do not inflate these bars (ADR 0003).
  const catsRaw = [
    { label: 'Väder', n: list.filter((s) => factorAtLeastWatch(s, 'weather')).length, c: 'oklch(0.6 0.1 240)' },
    { label: 'Vatten', n: list.filter((s) => factorAtLeastWatch(s, 'water')).length, c: 'oklch(0.62 0.08 215)' },
    { label: 'VMA', n: list.filter((s) => factorAtLeastWatch(s, 'vma')).length, c: 'oklch(0.6 0.17 28)' },
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
      nowcast: nowcastVM(s, portfolio.generatedAt),
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
    .map((f) => ({
      id: f.id,
      t: formatClock(f.publishedAt),
      title: f.title,
      src: f.sourceLabel,
      c: sev(f.severity).c,
      bg: sev(f.severity).bg,
      prop: byId.get(f.propertyId)?.property.name ?? '—',
      propertyId: f.propertyId,
    }));

  const groups = [
    { id: 'all', label: 'Alla fastigheter' },
    ...portfolio.segments.map((g) => ({ id: g.id, label: g.label })),
  ].map((g) => ({
    ...g,
    count: g.id === 'all' ? portfolio.properties.length : portfolio.properties.filter((s) => s.property.segment === g.id).length,
    active: ui.group === g.id,
  }));

  const riskSt = riskStyle(pr.level);
  const upcomingTone = { monitor: SEV.monitor.c, critical: SEV.critical.c, warning: SEV.warning.c, cold: 'oklch(0.6 0.1 265)' };

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
      risk: show(avgRisk),
      riskC: riskSt.c,
      riskLabel: pr.level ? `${riskSt.label} · högst ${pr.highest!.name} (${pr.highest!.score})` : 'Ej bedömd',
      riskDelta: portfolio.demoTrends?.riskDeltaLabel ?? null,
      riskDash: `${ready && avgRisk !== null ? (avgRisk / 100) * C30 : 0} ${C30}`,
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
      atRisk: counts.warning + counts.critical,
      dots: sorted.map((q) => ({
        id: q.property.id,
        c: q.property.status === 'warning' || q.property.status === 'critical' ? SEV[q.property.status].c : C.trackOff,
      })),
      warnings: wl.length,
      warnAffected: warnAff,
      warnChips: (Object.keys(wc) as Array<keyof typeof WL>).map((k) => ({ key: k, label: WL[k].label + ' ×' + wc[k], bg: WL[k].bg, fg: WL[k].fg })),
      wx: wxR + wxW + wxF,
      wxSplit: [
        { label: 'Regn', n: wxR },
        { label: 'Vind', n: wxW },
        { label: 'Frost', n: wxF },
      ],
      sms: smsN,
      smsW: ready ? (smsN / Math.max(1, smsMax)) * 100 + '%' : '0%',
      smsSub: `${smsProps.length} av ${list.length} fastigheter med SMS aktiverat`,
    },
    legend: [
      ...STATUS_ORDER.map((k) => ({ key: k as string, label: SEV[k].label, c: SEV[k].c, n: counts[k] })),
      ...(notAssessed ? [{ key: 'unknown', label: SEV.unknown.label, c: SEV.unknown.c, n: notAssessed }] : []),
    ],
    feed,
    rows,
    donut,
    /** Null when no property has an assessed status (never 0 % or 100 % by default). */
    healthPct: assessed ? Math.round((counts.normal / assessed) * 100) : null,
    health: STATUS_ORDER.map((k) => ({ key: k, label: SEV[k].label, c: SEV[k].c, n: counts[k], pct: Math.round((counts[k] / n) * 100) + '%' })),
    cats: catsRaw.map((c) => ({ ...c, w: ready ? (c.n / catMax) * 100 + '%' : '0%' })),
    upcoming: portfolio.upcoming.map((u) => ({ ...u, source:u.sourceId ? (u.sourceId==='krisinformation'?'Krisinformation':'SMHI')+' · uppdaterad '+formatClock(u.sourceUpdatedAt) : null, c: upcomingTone[u.tone] })),
  };
}

export type OverviewVM = ReturnType<typeof buildOverviewVM>;
