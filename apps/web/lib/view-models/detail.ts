import { nowcastVM } from './nowcast';
import { forecastDaysVM, precipitationIntervalsVM } from './weather-information';
import type { Portfolio, PropertySnapshot, PropertyStatus } from '@fastighetsradar/domain';
import { formatClock, formatDistance, formatNumber, formatWeekdayClock } from '@fastighetsradar/domain';
import { riskLevelOf, type GeographicEvent } from '@fastighetsradar/domain';
import { CATEGORY_SV, EXPOSURE_SV, SEV, WL, exposureStyle, riskStyle, type SeverityStyle } from '../design/tokens';
import type { ChartMetric } from '../state/dashboard-state';
import { chartOf } from './chart';
import { eventCounts, rulesFor, type RuleView } from './rules';
import { availability, forecastValues, mappedExposure, metricValue, show, sourceLine } from './snapshot';

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
  temp: { label: 'Temperatur', u: '°', c: '#E08A2E', dec: 1, key: 'weather.air_temperature' },
  rain: { label: 'Nederbörd', u: ' mm', c: '#4A86C5', dec: 1, key: 'weather.precipitation_1h' },
  wind: { label: 'Vind', u: ' m/s', c: '#3E8E9E', dec: 1, key: 'weather.wind_speed' },
  hum: { label: 'Luftfuktighet', u: '%', c: '#7468C9', dec: 0, key: 'weather.relative_humidity' },
};

/** Maps a water level (cm vs mean) to a 0–1 fill used by the decorative wave canvas. */
export const levelToFill = (l: number) => 0.18 + ((l + 20) / 120) * 0.62;

const DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SV', 'V', 'NV'];

const svDate = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' });
/** "Since 14:32" within 24 h, otherwise a date – an old start must never look like today. */
export function sinceLabel(validFrom: string, nowIso: string, sv: boolean): string {
  const recent = Date.parse(nowIso) - Date.parse(validFrom) < 20 * 3_600_000;
  void sv;
  return recent ? `Sedan ${formatClock(validFrom)}` : `Sedan ${svDate.format(new Date(validFrom))}`;
}

/**
 * DEMO-ONLY timeline. The prototype assembled this list with hardcoded clock times.
 * Live mode must render the API's short activity log instead (IMPLEMENTATION.md §2.2).
 */
export function buildDemoTimeline(s: PropertySnapshot, rules: RuleView[], smsOn: boolean) {
  const tl: Array<{ time: string; title: string; detail: string; c: string }> = [];
  s.warnings.forEach((w, i) =>
    tl.push({
      time: i ? '12:00' : '14:32',
      title: `${w.level === 'VMA' ? 'VMA' : `${WL[w.level].label} varning`} utfärdad — ${w.type}`,
      detail: w.sourceLabel + ' · ' + w.region,
      c: WL[w.level].fg,
    }),
  );
  if (smsOn && s.activeAlertCount)
    tl.push({
      time: '14:34',
      title: 'SMS-larm skickat',
      detail: `${s.sms.recipientCount} mottagare · ` + (rules.find((r) => r.hit && r.on) || rules[0])?.name,
      c: 'oklch(0.55 0.12 155)',
    });
  s.events.slice(0, 2).forEach((e, i) =>
    tl.push({ time: ['13:48', '11:20'][i]!, title: e.title, detail: e.sourceLabel + ' · ' + formatDistance(e.geo.distanceMeters), c: sev(e.severity === 'unknown' ? 'unknown' : e.severity).c }),
  );
  tl.push({ time: '09:00', title: 'Daglig riskbedömning', detail: `Riskpoäng uppdaterad till ${show(s.riskIndex?.score)}`, c: '#9AA1A8' });
  tl.push({ time: 'Igår', title: 'Avslutad — gul varning, vind', detail: 'SMHI · stängdes automatiskt efter 18 h', c: 'oklch(0.55 0.12 155)' });
  tl.sort((a, b) => (b.time === 'Igår' ? -1 : 0) - (a.time === 'Igår' ? -1 : 0) || b.time.localeCompare(a.time));
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
  const ri = s.riskIndex ?? null;
  const risk = ri?.score ?? null;

  // Forecast chart
  const mt = CHART_METAS[ui.metric];
  const vals = forecastValues(s, mt.key);
  const tempSer = forecastValues(s, 'weather.air_temperature');
  const rainSer = forecastValues(s, 'weather.precipitation_1h');
  const forecastPts = s.forecast?.series.find((x) => x.metricKey === mt.key)?.points ?? [];
  const hr = (i: number) => (forecastPts[i] ? formatClock(forecastPts[i]!.validAt) : '—');
  const ch = chartOf(vals, 640, 196, 0.12, ui.metric === 'rain');
  const pi = vals.length ? vals.indexOf(Math.max(...vals)) : 0;
  const fmt = (v: number) => formatNumber(+v, mt.dec) + mt.u;
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const tS = chartOf(tempSer, 100, 36, 0.1);
  const rMax = rainSer.length ? Math.max(...rainSer) : 0;
  const rPi = rainSer.indexOf(rMax);
  const rainPts = s.forecast?.series.find((x) => x.metricKey === 'weather.precipitation_1h')?.points ?? [];

  const GC = 2 * Math.PI * 66;
  const arc = GC * 0.75;
  const gst = riskStyle(ri?.level);
  const HC = 2 * Math.PI * 26;

  const rules = rulesFor(s, ui.isRuleOn);
  const on = ui.smsOn;
  const flood = mappedExposure(s);
  // Static mapped scenario – shown in neutral colours, never as a red/orange warning (ADR 0003).
  const fS = exposureStyle(flood);
  const lvlM = s.flood.waterBody?.level;
  const lvl = lvlM && lvlM.availability === 'ok' && typeof lvlM.value === 'number' ? lvlM.value : null;
  const fdist = s.flood.mapped.distanceToZoneMeters;
  const ev = eventCounts(s);
  // Regional Krisinformation news is neutral information; traffic is coloured by Trafikverket's own impact grade.
  const evKind = { Crisis: SEV.unknown, Traffic: SEV.unknown, Water: SEV.monitor, Air: SEV.normal, Weather: SEV.monitor, Info: SEV.normal };
  const evStyle = (e: GeographicEvent) => (e.category === 'Traffic' ? (e.severity === 'warning' ? SEV.warning : e.severity === 'monitor' ? SEV.monitor : SEV.unknown) : evKind[e.category]);
  const FACTOR_LABELS = ['Väder', 'Vatten', 'VMA', 'Framkomlighet', 'Luft (utomhus)'];

  const avail = availability(portfolio);
  const live = p.origin === 'live';
  const mon = s.monitoring ?? null;
  const pmM = s.metrics.find((m) => m.metricKey === 'air_quality.pm25' || m.metricKey === 'air_quality.no2');
  const fmtDist = (m: number | null | undefined) => (m === null || m === undefined ? '—' : m >= 1000 ? `${formatNumber(m / 1000, 1)} km` : `${Math.round(m)} m`);
  // Building facts are customer-provided; absent in Phase 2. The 3D scene then uses a neutral default.
  const b = p.building;
  const buildingLine = b ? `${b.type} · ${b.floors} våningar · ${b.unitsLabel}` : 'Byggnadsuppgifter saknas';

  return {
    id: p.id,
    avail,
    origin: p.origin,
    buildingLine,
    lat: p.location.lat,
    lon: p.location.lon,
    positionNote: p.geocode.provider === 'manual_pin' ? 'Manuell nål' : p.geocode.precision === 'building' ? 'Adresspunkt (Geoapify)' : 'Ungefärlig adresspunkt',
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
    nowcast: nowcastVM(s, portfolio.generatedAt),
    forecastDays: forecastDaysVM(s), precipitationIntervals: precipitationIntervalsVM(s),
    forecastSource: s.forecast ? 'SMHI · modellkörning ' + formatWeekdayClock(s.forecast.issuedAt ?? s.forecast.fetchedAt) + (p.origin === 'demo_fixture' ? ' · demo' : '') : 'SMHI · ej tillgänglig',
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
    tempRange: tempSer.length ? `${formatNumber(Math.min(...tempSer))}° – ${formatNumber(Math.max(...tempSer))}° kommande 24 h` : 'Prognos otillgänglig',
    rainBars: rainSer.map((v, i) => ({ key: i, h: ready && rMax > 0 ? Math.max(6, (v / rMax) * 100) + '%' : '6%', c: v > rMax * 0.6 ? '#4A86C5' : '#C9DAEB' })),
    rainPeak: rainSer.length ? `Max ${formatNumber(rMax, 1)} mm/h kl. ${rainPts[rPi] ? formatClock(rainPts[rPi]!.validAt) : '—'}` : 'Prognos otillgänglig',
    humDash: `${ready && hum !== null ? (hum / 100) * HC : 0} ${HC}`,
    // Approximate dew point (simple Lawrence approximation, as in the prototype). Derived – not a source value.
    dew: temp !== null && hum !== null ? formatNumber(temp - (100 - hum) / 5, 1) : '—',
    condens: hum === null ? '—' : hum > 85 ? 'hög' : 'låg',
    aqi: show(aqi),
    aq: aqi === null ? '' : aqi > 75 ? 'Dålig' : aqi > 50 ? 'Måttlig' : 'Bra',
    aqC: aqi === null ? SEV.unknown.c : aqi > 75 ? SEV.critical.c : aqi > 50 ? SEV.warning.c : SEV.normal.c,
    aqLeft: aqi === null ? '0%' : Math.min(97, (aqi / 150) * 100) + '%',
    pm: show(pm),
    no2: show(no2),
    gauge: {
      track: `${arc} ${GC}`,
      val: `${ready && risk !== null ? (risk / 100) * arc : 0} ${GC}`,
      c: gst.c,
      bg: gst.bg,
      label: ri?.level ? gst.label : 'Ej bedömd',
    },
    riskSummary: ri?.summary ?? 'Ingen riskbedömning finns för fastigheten ännu.',
    riskMeta: ri ? (ri.score === null ? `Ej bedömd · ${ri.assessedFactors} av ${ri.factors.length} faktorer kontrollerade` : `Riskindex v1 · ${ri.assessedFactors} av ${ri.factors.length} faktorer bedömda`) : 'Ej bedömd',
    factors: ri
      ? ri.factors.map((f) => ({
          label: f.label,
          v: f.short,
          title: f.reason,
          w: ready && f.points !== null ? Math.max(f.points, f.points > 0 ? 3 : 0) + '%' : '0%',
          c: f.points === null ? SEV.unknown.c : riskStyle(riskLevelOf(f.points)).c,
        }))
      : FACTOR_LABELS.map((label) => ({ label, v: '—', title: 'Ej bedömd', w: '0%', c: SEV.unknown.c })),
    warnings: s.warnings.map((w) => ({
      id: w.id,
      level: w.level,
      levelLabel: WL[w.level].label,
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
          pLabel: `Topp ${fmt(vals[pi]!)} · ${hr(pi)}`,
          stats: [
            { label: 'Nu', value: fmt(vals[0]!) },
            { label: 'Min', value: fmt(Math.min(...vals)) },
            { label: 'Max', value: fmt(Math.max(...vals)) },
            { label: ui.metric === 'rain' ? 'Totalt' : 'Medel', value: ui.metric === 'rain' ? (rain24 === null ? '—' : fmt(rain24)) : fmt(avg) },
          ],
          xLabels: [
            'Nu',
            ...[6, 12, 18, 24].map((h) =>
              forecastPts[0] ? formatClock(new Date(Date.parse(forecastPts[0].validAt) + h * 3_600_000).toISOString()) : '—',
            ),
          ],
        }
      : null,
    water: {
      watercourse:s.flood.watercourse ? {
        text:'Vattendrag: '+s.flood.watercourse.stationName+' ('+formatDistance(s.flood.watercourse.distanceMeters)+')',
        value:typeof s.flood.watercourse.measurement.value==='number'?formatNumber(s.flood.watercourse.measurement.value,1)+' m³/s':'Ej tillgänglig',
        classification:s.flood.watercourse.classification??'Referens för årstiden ej tillgänglig',
        trend:s.flood.watercourse.trendLabel??'Trend ej tillgänglig',note:s.flood.watercourse.note,
        source:'SMHI · mätning '+formatWeekdayClock(s.flood.watercourse.measurement.sourceTimestamp)+(s.flood.watercourse.measurement.freshness!=='fresh'?' · inaktuell':''),
      } : null,
      flood: EXPOSURE_SV[flood] ?? flood,
      fc: fS.c,
      fbg: fS.bg,
      body: s.flood.waterBody?.name ?? 'Havsvattenstånd ej tillgängligt inom 15 km',
      reference: s.flood.waterBody?.referenceSystem==='RH2000'?'i RH 2000':'relativt medelvattenstånd (RW)',
      source: s.flood.waterBody ? 'SMHI · ' + (s.flood.waterBody.stationName ?? s.flood.waterBody.name) + ' · ' + formatDistance(s.flood.waterBody.level.geo.distanceMeters) + ' · mätning ' + formatWeekdayClock(s.flood.waterBody.level.sourceTimestamp) + (s.flood.waterBody.level.freshness!=='fresh'?' · inaktuell':'') : 'SMHI · mätning ej tillgänglig',
      level: lvl === null ? '—' : (lvl >= 0 ? '+' : '') + lvl + ' cm',
      levelFill: lvl === null ? 0.3 : levelToFill(lvl),
      trend: s.flood.waterBody?.trendLabel ?? '—',
      scenario: s.flood.mapped.scenario,
      dist: live ? (s.flood.mapped.availability !== 'ok' ? 'Ej kontrollerad' : fdist === null ? 'Inget inom 1 km' : fdist === 0 ? 'Inom karterat område' : `Inom ${fdist} m`) : fdist === null ? '—' : fdist < 100 ? fdist + ' m · inom buffert' : fdist >= 1000 ? formatNumber(fdist / 1000, 1) + ' km bort' : fdist + ' m bort',
      hasLevel: lvl !== null,
      // Derived demo labels from the prototype. Live mode needs a documented method before showing these.
      surface: live ? 'Ej bedömt' : rain24 === null ? '—' : rain24 > 15 ? 'Troligt' : rain24 > 10 ? 'Möjligt' : 'Osannolikt',
      basement: live ? 'Ej bedömt' : flood === 'High' ? 'Förhöjd' : flood === 'Medium' ? 'Måttlig' : flood === 'Low' ? 'Låg' : '—',
      note: live ? (s.flood.mapped.geo.note ?? null) : null,
    },
    events: s.events.map((e) => ({
      id: e.id,
      kind: CATEGORY_SV[e.category] ?? e.category,
      title: e.title,
      src: e.sourceLabel,
      dist: formatDistance(e.geo.distanceMeters),
      time: e.timeLabel ?? (e.validFrom ? sinceLabel(e.validFrom, portfolio.generatedAt, live) : '—'),
      c: evStyle(e).c,
      bg: evStyle(e).bg,
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
      label: on ? 'Aktiverat' : 'Avaktiverat',
      op: on ? 1 : 0.45,
      sub: `${rules.filter((r) => r.on).length} av ${rules.length} regler aktiva · ${s.sms.recipientsLabel}`,
      rules: rules.map((r) => ({
        ...r,
        state: !r.on ? 'Av' : r.hit ? 'Utlöst idag' : 'Aktiv',
        stateC: !r.on ? '#9AA1A8' : r.hit ? SEV.warning.c : SEV.normal.c,
      })),
    },
    location: p.location,
    floodExposure: flood,
    live: live
      ? {
          warningsLine: [sourceLine(portfolio, 'smhi_warnings', 'SMHI', formatClock), sourceLine(portfolio, 'krisinformation', 'Krisinformation', formatClock)].join(' · '),
          eventsLine: [sourceLine(portfolio, 'trafikverket', 'Trafikverket', formatClock), sourceLine(portfolio, 'krisinformation', 'Krisinformation', formatClock)].join(' · '),
          forecastLine: s.forecast
            ? `SMHI-prognos, modellkörning ${formatClock(s.forecast.issuedAt ?? s.forecast.fetchedAt ?? portfolio.generatedAt)}, modellpunkt ${fmtDist(s.forecast.geo.distanceMeters)} bort`
            : 'Prognos har inte hämtats ännu',
          airLine: pmM ? `${pmM.geo.note ?? 'Mätstation'} · ${fmtDist(pmM.geo.distanceMeters)} · preliminära värden` : 'Ingen luftmätstation inom 25 km med aktuella värden',
          statusReason: p.statusReason ?? null,
          monitoring: mon,
          fmtDist,
        }
      : null,
  };
}

export type DetailVM = ReturnType<typeof buildDetailVM>;
