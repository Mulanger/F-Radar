import type { Portfolio, PropertySnapshot, PropertyStatus } from '@fastighetsradar/domain';
import { formatClock, formatDistance, formatWeekdayClock } from '@fastighetsradar/domain';
import { SEV, WL, type SeverityStyle } from '../design/tokens';
import type { ChartMetric } from '../state/dashboard-state';
import { chartOf } from './chart';
import { eventCounts, rulesFor, type RuleView } from './rules';
import { availability, forecastValues, metricValue, riskSeverity, show } from './snapshot';

/**
 * Property Detail view-model – port of the prototype's `renderVals()` detail section.
 */

export interface DetailUi {
  ready: boolean;
  metric: ChartMetric;
  smsOn: boolean;
  isRuleOn: (id: string, fallback: boolean) => boolean;
}

const sev = (st: PropertyStatus | 'info'): SeverityStyle => (st === 'info' ? SEV.normal : SEV[st] ?? SEV.unknown);

export const CHART_METAS: Record<ChartMetric, { label: string; u: string; c: string; dec: number; key: Parameters<typeof forecastValues>[1] }> = {
  temp: { label: 'Temperature', u: '°', c: '#E08A2E', dec: 1, key: 'weather.air_temperature' },
  rain: { label: 'Precipitation', u: ' mm', c: '#4A86C5', dec: 1, key: 'weather.precipitation_24h' },
  wind: { label: 'Wind', u: ' m/s', c: '#3E8E9E', dec: 1, key: 'weather.wind_speed' },
  hum: { label: 'Humidity', u: '%', c: '#7468C9', dec: 0, key: 'weather.relative_humidity' },
};

/** Maps a water level (cm vs mean) to a 0–1 fill used by the decorative wave canvas. */
export const levelToFill = (l: number) => 0.18 + ((l + 20) / 120) * 0.62;

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * DEMO-ONLY timeline. The prototype assembled this list with hardcoded clock times.
 * Live mode must render the API's short activity log instead (IMPLEMENTATION.md §2.2).
 */
export function buildDemoTimeline(s: PropertySnapshot, rules: RuleView[], smsOn: boolean) {
  const tl: Array<{ time: string; title: string; detail: string; c: string }> = [];
  s.warnings.forEach((w, i) =>
    tl.push({
      time: i ? '12:00' : '14:32',
      title: `${w.level} ${w.level === 'VMA' ? '' : 'warning '}issued — ${w.type}`,
      detail: w.sourceLabel + ' · ' + w.region,
      c: WL[w.level].fg,
    }),
  );
  if (smsOn && s.activeAlertCount)
    tl.push({
      time: '14:34',
      title: 'SMS alert sent',
      detail: `${s.sms.recipientCount} recipients · ` + (rules.find((r) => r.hit && r.on) || rules[0])?.name,
      c: 'oklch(0.55 0.12 155)',
    });
  s.events.slice(0, 2).forEach((e, i) =>
    tl.push({ time: ['13:48', '11:20'][i]!, title: e.title, detail: e.sourceLabel + ' · ' + formatDistance(e.geo.distanceMeters), c: sev(e.severity === 'unknown' ? 'unknown' : e.severity).c }),
  );
  tl.push({ time: '09:00', title: 'Daily risk assessment', detail: `Risk score updated to ${show(s.demoRisk?.score)}`, c: '#9AA1A8' });
  tl.push({ time: 'Yesterday', title: 'Resolved — Yellow warning, wind', detail: 'SMHI · auto-closed after 18 h', c: 'oklch(0.55 0.12 155)' });
  tl.sort((a, b) => (b.time === 'Yesterday' ? -1 : 0) - (a.time === 'Yesterday' ? -1 : 0) || b.time.localeCompare(a.time));
  return tl;
}

export function buildDetailVM(portfolio: Portfolio, s: PropertySnapshot, ui: DetailUi) {
  const { ready } = ui;
  const p = s.property;
  const st = sev(p.status);
  const all = portfolio.properties;
  const idx = all.findIndex((x) => x.property.id === p.id);

  const temp = metricValue(s, 'weather.air_temperature');
  const feels = metricValue(s, 'weather.apparent_temperature');
  const rain24 = metricValue(s, 'weather.precipitation_24h');
  const wind = metricValue(s, 'weather.wind_speed');
  const gust = metricValue(s, 'weather.wind_gust');
  const dir = metricValue(s, 'weather.wind_direction');
  const hum = metricValue(s, 'weather.relative_humidity');
  const aqi = metricValue(s, 'air_quality.index');
  const pm = metricValue(s, 'air_quality.pm25');
  const no2 = metricValue(s, 'air_quality.no2');
  const risk = s.demoRisk?.score ?? null;

  // Forecast chart
  const mt = CHART_METAS[ui.metric];
  const vals = forecastValues(s, mt.key);
  const tempSer = forecastValues(s, 'weather.air_temperature');
  const rainSer = forecastValues(s, 'weather.precipitation_24h');
  const forecastPts = s.forecast?.series.find((x) => x.metricKey === mt.key)?.points ?? [];
  const hr = (i: number) => (forecastPts[i] ? formatClock(forecastPts[i]!.validAt) : '—');
  const ch = chartOf(vals, 640, 196, 0.12, ui.metric === 'rain');
  const pi = vals.length ? vals.indexOf(Math.max(...vals)) : 0;
  const fmt = (v: number) => (+v).toFixed(mt.dec) + mt.u;
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const tS = chartOf(tempSer, 100, 36, 0.1);
  const rMax = rainSer.length ? Math.max(...rainSer) : 0;
  const rPi = rainSer.indexOf(rMax);
  const rainPts = s.forecast?.series.find((x) => x.metricKey === 'weather.precipitation_24h')?.points ?? [];

  const GC = 2 * Math.PI * 66;
  const arc = GC * 0.75;
  const gs = risk === null ? null : riskSeverity(risk);
  const HC = 2 * Math.PI * 26;

  const rules = rulesFor(s, ui.isRuleOn);
  const on = ui.smsOn;
  const flood = s.flood.mapped.exposureClass;
  const fS = flood === 'High' ? SEV.critical : flood === 'Medium' ? SEV.warning : flood === 'Low' ? SEV.normal : SEV.unknown;
  const lvlM = s.flood.waterBody?.level;
  const lvl = lvlM && lvlM.availability === 'ok' && typeof lvlM.value === 'number' ? lvlM.value : null;
  const fdist = s.flood.mapped.distanceToZoneMeters;
  const ev = eventCounts(s);
  const evKind = { Crisis: SEV.critical, Traffic: SEV.warning, Water: SEV.monitor, Air: SEV.normal, Weather: SEV.monitor, Info: SEV.normal };
  const factorLabels = ['Weather', 'Water', 'Crisis', 'Traffic', 'Air'] as const;
  const fac = s.demoRisk ? [s.demoRisk.factors.weather, s.demoRisk.factors.water, s.demoRisk.factors.crisis, s.demoRisk.factors.traffic, s.demoRisk.factors.air] : null;

  const avail = availability(portfolio);
  // Building facts are customer-provided; absent in Phase 2. The 3D scene then uses a neutral default.
  const b = p.building;
  const buildingLine = b ? `${b.type} · ${b.floors} floors · ${b.unitsLabel}` : 'Building details not provided';

  return {
    id: p.id,
    avail,
    origin: p.origin,
    buildingLine,
    lat: p.location.lat,
    lon: p.location.lon,
    positionNote: p.geocode.provider === 'manual_pin' ? 'Manual pin' : p.geocode.precision === 'building' ? 'Address point (Geoapify)' : 'Approximate address point',
    name: p.name,
    address: p.address,
    area: p.area,
    type: b?.type ?? '',
    floors: b?.floors ?? 6,
    units: b?.unitsLabel ?? '',
    status: st.label,
    c: st.c,
    bg: st.bg,
    hex: st.hex,
    pos: `${idx + 1}/${all.length}`,
    prevId: all[(idx - 1 + all.length) % all.length]!.property.id,
    nextId: all[(idx + 1) % all.length]!.property.id,
    updatedAt: formatClock(portfolio.generatedAt),
    temp: show(temp),
    feels: show(feels),
    rain: show(rain24),
    wind: show(wind),
    gust: show(gust),
    hum: show(hum),
    risk: show(risk),
    windDir: dir === null ? '—' : DIRS[Math.round(dir / 45) % 8],
    windRot: (ready && dir !== null ? dir + 180 : 0) + 'deg',
    windW: gust === null ? '0%' : Math.min(100, (gust / 30) * 100) + '%',
    tempSpark: tS.line,
    tempRange: tempSer.length ? `${Math.min(...tempSer)}° – ${Math.max(...tempSer)}° next 24 h` : 'Forecast unavailable',
    rainBars: rainSer.map((v, i) => ({ key: i, h: ready && rMax > 0 ? Math.max(6, (v / rMax) * 100) + '%' : '6%', c: v > rMax * 0.6 ? '#4A86C5' : '#C9DAEB' })),
    rainPeak: rainSer.length ? `Peak ${rMax.toFixed(1)} mm/h at ${rainPts[rPi] ? formatClock(rainPts[rPi]!.validAt) : '—'}` : 'Forecast unavailable',
    humDash: `${ready && hum !== null ? (hum / 100) * HC : 0} ${HC}`,
    // Approximate dew point (simple Lawrence approximation, as in the prototype). Derived – not a source value.
    dew: temp !== null && hum !== null ? (temp - (100 - hum) / 5).toFixed(1) : '—',
    condens: hum === null ? '—' : hum > 85 ? 'high' : 'low',
    aqi: show(aqi),
    aq: aqi === null ? '' : aqi > 75 ? 'Poor' : aqi > 50 ? 'Moderate' : 'Good',
    aqC: aqi === null ? SEV.unknown.c : aqi > 75 ? SEV.critical.c : aqi > 50 ? SEV.warning.c : SEV.normal.c,
    aqLeft: aqi === null ? '0%' : Math.min(97, (aqi / 150) * 100) + '%',
    pm: show(pm),
    no2: show(no2),
    gauge: {
      track: `${arc} ${GC}`,
      val: `${ready && risk !== null ? (risk / 100) * arc : 0} ${GC}`,
      c: gs ? SEV[gs].c : SEV.unknown.c,
      bg: gs ? SEV[gs].bg : SEV.unknown.bg,
      label: gs ? SEV[gs].label : 'Not assessed',
    },
    factors: factorLabels.map((label, i) => ({
      label,
      v: fac ? String(fac[i]) : '—',
      w: ready && fac ? fac[i] + '%' : '0%',
      c: fac ? SEV[riskSeverity(fac[i]!)].c : SEV.unknown.c,
    })),
    warnings: s.warnings.map((w) => ({
      id: w.id,
      level: w.level,
      type: w.type,
      summary: w.summary,
      start: formatWeekdayClock(w.validFrom, '—'),
      end: formatWeekdayClock(w.validTo),
      src: w.sourceLabel,
      region: w.region,
      bg: WL[w.level].bg,
      fg: WL[w.level].fg,
    })),
    warnN: s.warnings.length,
    noWarnings: !s.warnings.length,
    tabs: (Object.keys(CHART_METAS) as ChartMetric[]).map((k) => ({ key: k, label: CHART_METAS[k].label, active: k === ui.metric })),
    chart: vals.length
      ? {
          line: ch.line,
          area: ch.area,
          c: mt.c,
          yMax: fmt(ch.mx),
          yMid: fmt((ch.mx + ch.mn) / 2),
          yMin: fmt(ch.mn),
          pL: (pi / Math.max(1, vals.length - 1)) * 100 + '%',
          pT: (ch.pts[pi]![1] / 196) * 100 + '%',
          pLabel: `Peak ${fmt(vals[pi]!)} · ${hr(pi)}`,
          stats: [
            { label: 'Now', value: fmt(vals[0]!) },
            { label: 'Min', value: fmt(Math.min(...vals)) },
            { label: 'Max', value: fmt(Math.max(...vals)) },
            { label: ui.metric === 'rain' ? 'Total' : 'Average', value: ui.metric === 'rain' ? (rain24 === null ? '—' : fmt(rain24)) : fmt(avg) },
          ],
          xLabels: [
            'Now',
            ...[6, 12, 18, 24].map((h) =>
              forecastPts[0] ? formatClock(new Date(Date.parse(forecastPts[0].validAt) + h * 3_600_000).toISOString()) : '—',
            ),
          ],
        }
      : null,
    water: {
      flood: flood === 'unknown' ? 'Unknown' : flood,
      fc: fS.c,
      fbg: fS.bg,
      body: s.flood.waterBody?.name ?? 'No water body matched',
      level: lvl === null ? '—' : (lvl >= 0 ? '+' : '') + lvl + ' cm',
      levelFill: lvl === null ? 0.3 : levelToFill(lvl),
      trend: s.flood.waterBody?.trendLabel ?? '—',
      dist: fdist === null ? '—' : fdist < 100 ? fdist + ' m · inside buffer' : fdist >= 1000 ? (fdist / 1000).toFixed(1) + ' km away' : fdist + ' m away',
      thTop: (1 - levelToFill(60)) * 100 + '%',
      hasLevel: lvl !== null,
      // Derived demo labels from the prototype. Live mode needs a documented method before showing these.
      surface: rain24 === null ? '—' : rain24 > 15 ? 'Likely' : rain24 > 10 ? 'Possible' : 'Unlikely',
      basement: flood === 'High' ? 'Elevated' : flood === 'Medium' ? 'Moderate' : flood === 'Low' ? 'Low' : '—',
    },
    events: s.events.map((e) => ({
      id: e.id,
      kind: e.category,
      title: e.title,
      src: e.sourceLabel,
      dist: formatDistance(e.geo.distanceMeters),
      time: e.timeLabel ?? (e.validFrom ? `Since ${formatClock(e.validFrom)}` : '—'),
      c: evKind[e.category].c,
      bg: evKind[e.category].bg,
      hx: sev(e.severity === 'unknown' ? 'unknown' : e.severity).hx,
      location: e.location,
    })),
    noEvents: !s.events.length,
    eventsN: s.events.length,
    crisisN: ev.crisis,
    trafficN: ev.traffic,
    otherN: ev.other,
    timeline: portfolio.origin === 'demo_fixture' ? buildDemoTimeline(s, rules, on) : [],
    sms: {
      on,
      label: on ? 'Enabled' : 'Disabled',
      op: on ? 1 : 0.45,
      sub: `${rules.filter((r) => r.on).length} of ${rules.length} triggers active · ${s.sms.recipientsLabel}`,
      rules: rules.map((r) => ({
        ...r,
        state: !r.on ? 'Off' : r.hit ? 'Triggered today' : 'Armed',
        stateC: !r.on ? '#9AA1A8' : r.hit ? SEV.warning.c : SEV.normal.c,
      })),
    },
    location: p.location,
    floodExposure: flood,
  };
}

export type DetailVM = ReturnType<typeof buildDetailVM>;
