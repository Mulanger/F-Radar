import { z } from 'zod';
import { isDisplayableValue, type SourceId } from './common';
import type { GeographicEvent, OfficialWarning, PropertySnapshot } from './entities';

/**
 * FastighetsRadar riskindex v1 – see docs/decisions/0003-riskindex.md.
 *
 * Deliberately conservative: the score reflects likely impact on the BUILDING. Only current
 * official warnings can reach the high bands; static data, forecasts without a warning, traffic
 * and outdoor air can never raise a property above "Låg". Missing data is "Ej bedömd", never 0.
 * Texts generated here are descriptive – alarming words only ever come verbatim from the authority.
 */

export const RISK_METHOD = 'fr_risk_index_v1' as const;

export const RiskLevelSchema = z.enum(['low', 'watch', 'elevated', 'high']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const RiskFactorKeySchema = z.enum(['weather', 'water', 'vma', 'access', 'air']);
export type RiskFactorKey = z.infer<typeof RiskFactorKeySchema>;

export const RiskFactorSchema = z.object({
  key: RiskFactorKeySchema,
  label: z.string(),
  assessed: z.boolean(),
  /** 0–100; null when not assessed. */
  points: z.number().min(0).max(100).nullable(),
  /** Highest value this factor can reach under the method (shows how much it can weigh). */
  ceiling: z.number().min(0).max(100),
  /** Short state for compact UI, e.g. "Gul varning", "100-årsflöde", "Ingen påverkan". */
  short: z.string(),
  /** Full explanation with source. */
  reason: z.string(),
});
export type RiskFactor = z.infer<typeof RiskFactorSchema>;

export const RiskIndexSchema = z.object({
  method: z.literal(RISK_METHOD),
  /** 0–100; null = "Ej bedömd" (warning sources not current). */
  score: z.number().int().min(0).max(100).nullable(),
  level: RiskLevelSchema.nullable(),
  /** One sentence: what drives the score (or why it cannot be assessed). */
  summary: z.string(),
  assessedFactors: z.number().int().nonnegative(),
  factors: z.array(RiskFactorSchema),
});
export type RiskIndex = z.infer<typeof RiskIndexSchema>;

export const RISK_LEVEL_SV: Record<RiskLevel, string> = { low: 'Låg', watch: 'Bevaka', elevated: 'Förhöjd', high: 'Hög' };

const BANDS: Array<{ level: RiskLevel; max: number }> = [
  { level: 'low', max: 24 },
  { level: 'watch', max: 49 },
  { level: 'elevated', max: 74 },
  { level: 'high', max: 100 },
];

export function riskLevelOf(score: number): RiskLevel {
  return (BANDS.find((b) => score <= b.max) ?? BANDS[BANDS.length - 1]!).level;
}

const bandCeiling = (points: number) => (BANDS.find((b) => points <= b.max) ?? BANDS[BANDS.length - 1]!).max;

/**
 * Highest factor plus 10 % of the others, never above the band of the highest factor – many small
 * signals can never add up to a higher level than the most serious single one.
 */
export function combineFactorPoints(points: number[]): number {
  if (!points.length) return 0;
  const sorted = [...points].sort((a, b) => b - a);
  const top = sorted[0]!;
  const rest = sorted.slice(1).reduce((a, b) => a + b, 0);
  return Math.round(Math.min(top + 0.1 * rest, bandCeiling(top), 100));
}

/* ------------------------------------------------------------------ */
/* Official warnings                                                   */
/* ------------------------------------------------------------------ */

const LEVEL_STEP: Partial<Record<OfficialWarning['level'], number>> = { Yellow: 1, Orange: 2, Red: 3 };
const STEP_POINTS = (step: number) => (step >= 3 ? 85 : step === 2 ? 60 : step === 1 ? 35 : step === 0 ? 15 : 8);
const LEVEL_SHORT: Partial<Record<OfficialWarning['level'], string>> = { Yellow: 'Gul varning', Orange: 'Orange varning', Red: 'Röd varning' };

export type WarningImpact = 'direct' | 'indirect' | 'none';
export interface WarningClass {
  factor: 'weather' | 'water';
  impact: WarningImpact;
  /** Water warnings whose relevance depends on whether the address lies in a mapped flood area. */
  zoneDependent: boolean;
}

/** Classifies an SMHI warning by its Swedish name or IBWW code (both are seen in stored data). */
export function classifySmhiWarning(type: string): WarningClass {
  const t = type.toLowerCase();
  if (/kalfjäll|till havs|wind_mountains|wind_sea|ice_accretion|lågt vattenstånd|low_sea_level|vattenbrist|water_shortage/.test(t))
    return { factor: 'weather', impact: 'none', zoneDependent: false };
  if (/flöde|high_flow|högt vattenstånd|high_sealevel|översvämning|flooding/.test(t)) return { factor: 'water', impact: 'direct', zoneDependent: true };
  if (/regn|skyfall|\brain\b/.test(t)) return { factor: 'water', impact: 'direct', zoneDependent: false };
  if (/vind|\bwind\b|snö|\bsnow\b|åsk|thunder/.test(t)) return { factor: 'weather', impact: 'direct', zoneDependent: false };
  return { factor: 'weather', impact: 'indirect', zoneDependent: false };
}

interface Contribution {
  points: number;
  short: string;
  reason: string;
}

const best = (cs: Contribution[]): Contribution | null => cs.reduce<Contribution | null>((a, c) => (!a || c.points > a.points ? c : a), null);

function smhiWarningContribution(w: OfficialWarning, cls: WarningClass, inMappedZone: boolean): Contribution | null {
  const base = LEVEL_STEP[w.level];
  if (base === undefined) return null; // Info / VMA handled elsewhere
  const levelText = LEVEL_SHORT[w.level]!;
  if (cls.impact === 'none') {
    return { points: 0, short: 'Ingen påverkan', reason: `${levelText}: ${w.type} (${w.sourceLabel}) – bedöms inte påverka byggnader på land.` };
  }
  let step = base;
  const notes: string[] = [];
  if (cls.impact === 'indirect') {
    step -= 1;
    notes.push('påverkar främst människor och framkomlighet');
  }
  if (cls.zoneDependent && !inMappedZone) {
    step -= 1;
    notes.push('adresspunkten ligger inte i karterat översvämningsområde');
  }
  if (w.geo.match !== 'polygon_intersection') {
    step -= 1;
    notes.push('regional publicering, inte matchad mot fastighetens punkt');
  }
  let points = STEP_POINTS(step);
  if (cls.zoneDependent && inMappedZone) {
    points = Math.min(points + 10, bandCeiling(points));
    notes.push('adresspunkten ligger i karterat översvämningsområde');
  }
  return { points, short: levelText, reason: `${levelText}: ${w.type} (${w.sourceLabel})${notes.length ? ` – ${notes.join('; ')}` : ''}.` };
}

/* ------------------------------------------------------------------ */
/* Factor assessment                                                   */
/* ------------------------------------------------------------------ */

const metric = (s: PropertySnapshot, key: string): number | null => {
  const m = s.metrics.find((x) => x.metricKey === key);
  return isDisplayableValue(m) && typeof m.value === 'number' ? m.value : null;
};

const fmt = (v: number, d = 0) => v.toFixed(d).replace('.', ',');

const factor = (key: RiskFactorKey, label: string, ceiling: number, c: Contribution | null, assessed: boolean, notAssessedReason: string): RiskFactor =>
  assessed && c
    ? { key, label, assessed: true, points: Math.min(c.points, ceiling), ceiling, short: c.short, reason: c.reason }
    : { key, label, assessed: false, points: null, ceiling, short: 'Ej bedömd', reason: notAssessedReason };

function weatherFactor(s: PropertySnapshot, current: boolean): RiskFactor {
  const cs: Contribution[] = [];
  for (const w of s.warnings) {
    if (w.sourceId !== 'smhi_warnings' && w.sourceId !== 'smhi_oceanography') continue;
    const cls = classifySmhiWarning(w.type);
    if (cls.factor !== 'weather') continue;
    const c = smhiWarningContribution(w, cls, false);
    if (c) cs.push(c);
  }
  const gusts = [metric(s, 'weather.wind_gust'), ...(s.forecast?.availability === 'ok' ? (s.forecast.series.find((x) => x.metricKey === 'weather.wind_gust')?.points.map((p) => p.value) ?? []) : [])].filter(
    (v): v is number => typeof v === 'number',
  );
  const gust = gusts.length ? Math.max(...gusts) : null;
  if (gust !== null && gust >= 21) cs.push({ points: 15, short: `Byar ${fmt(gust)} m/s`, reason: `SMHI-prognos: byar upp till ${fmt(gust)} m/s utan utfärdad varning.` });
  const c = best(cs) ?? { points: 0, short: 'Ingen varning', reason: 'Inga SMHI-varningar för väder vid fastighetens läge.' };
  return factor('weather', 'Väder', 85, c, current, 'SMHI:s varningar kunde inte kontrolleras just nu.');
}

function waterFactor(s: PropertySnapshot, warningsCurrent: boolean): RiskFactor {
  const mapped = s.flood.mapped;
  const mappedOk = mapped.availability === 'ok';
  const cls = mapped.exposureClass;
  // Inside the mapped area (live: distance 0; ±50 m tolerates the address-point search box). Merely
  // being NEAR a mapped area does not count.
  const dist = mapped.distanceToZoneMeters;
  const inZone = mappedOk && cls !== 'unknown' && (dist === null || dist <= 50);
  const cs: Contribution[] = [];

  // Static mapping (+ modelled groundwater): never above "Låg".
  let staticPts = 0;
  const staticNotes: string[] = [];
  if (inZone) {
    const [pts, name] = cls === 'High' ? [12, '100-årsflöde'] : cls === 'Medium' ? [8, '200-årsflöde'] : [5, 'högsta beräknade flöde'];
    staticPts += pts;
    staticNotes.push(`adresspunkten ligger i karterat område för ${name} (MCF, statiskt scenario – ingen pågående översvämning)`);
  }
  const gw = s.monitoring?.groundwater?.situationSmall ?? null;
  if (gw !== null && gw >= 90) {
    staticPts += 5;
    staticNotes.push(`grundvattennivån i området är mycket hög för årstiden (SGU-modell, ${fmt(gw)}:e percentilen)`);
  }
  if (staticPts > 0) {
    const short = cls === 'High' ? '100-årsflöde' : cls === 'Medium' ? '200-årsflöde' : cls === 'Low' ? 'Högsta flöde' : 'Högt grundvatten';
    cs.push({ points: Math.min(staticPts, 20), short, reason: `${staticNotes.join('; ')}.`.replace(/^./, (m) => m.toUpperCase()) });
  }

  const rain = metric(s, 'weather.precipitation_24h');
  if (rain !== null && rain >= 30) cs.push({ points: 12, short: `${fmt(rain)} mm/24 h`, reason: `SMHI-prognos: ${fmt(rain)} mm nederbörd kommande 24 h utan utfärdad varning.` });

  if (warningsCurrent) {
    for (const w of s.warnings) {
      if (w.sourceId !== 'smhi_warnings' && w.sourceId !== 'smhi_oceanography') continue;
      const wc = classifySmhiWarning(w.type);
      if (wc.factor !== 'water') continue;
      const c = smhiWarningContribution(w, wc, inZone);
      if (c) cs.push(c);
    }
  }

  const assessed = warningsCurrent || mappedOk;
  const fallback: Contribution = mappedOk
    ? { points: 0, short: 'Ingen påverkan', reason: 'Inga vattenvarningar och adresspunkten ligger inte i karterat översvämningsområde. Karteringen täcker bara utvalda vattendrag.' }
    : { points: 0, short: 'Ingen varning', reason: 'Inga vattenvarningar. Översvämningskarteringen kunde inte kontrolleras.' };
  return factor('water', 'Vatten', 95, best(cs) ?? fallback, assessed, 'Varken SMHI:s varningar eller översvämningskarteringen kunde kontrolleras.');
}

function vmaFactor(s: PropertySnapshot, current: boolean): RiskFactor {
  const cs: Contribution[] = [];
  for (const w of s.warnings) {
    if (w.level !== 'VMA') continue;
    if (w.geo.match === 'county') {
      cs.push({ points: 30, short: 'VMA i länet', reason: `VMA för andra kommuner i länet (${w.sourceLabel}): ${w.type}. Berör sannolikt inte fastigheten – läs meddelandet.` });
    } else {
      cs.push({ points: 75, short: 'VMA', reason: `VMA som gäller fastighetens område (${w.sourceLabel}): ${w.type}.` });
    }
  }
  const regional = s.events.filter((e) => e.sourceId === 'krisinformation').length;
  const fallback: Contribution = {
    points: 0,
    short: 'Inget VMA',
    reason: regional ? `Inget VMA. ${regional} regionala meddelanden från Krisinformation – påverkar inte poängen.` : 'Inget VMA för fastighetens område.',
  };
  return factor('vma', 'VMA', 75, best(cs) ?? fallback, current, 'Krisinformation kunde inte kontrolleras just nu.');
}

function accessFactor(s: PropertySnapshot, current: boolean): RiskFactor {
  const cs: Contribution[] = [];
  const traffic = s.events.filter((e): e is GeographicEvent => e.category === 'Traffic');
  for (const e of traffic) {
    const d = e.geo.distanceMeters ?? null;
    if (d === null) continue;
    const pts = d <= 250 && e.severity === 'warning' ? 20 : d <= 250 && e.severity === 'monitor' ? 10 : d <= 1000 ? 5 : 0;
    if (pts) cs.push({ points: pts, short: `${Math.round(d)} m bort`, reason: `${e.title} (${e.sourceLabel}, ${Math.round(d)} m bort) – påverkar framkomligheten, inte byggnaden.` });
  }
  const c = best(cs) ?? { points: 0, short: 'Inget nära', reason: 'Inga trafikhändelser inom 1 km.' };
  return factor('access', 'Framkomlighet', 20, c, current, 'Trafikverket kunde inte kontrolleras just nu.');
}

function airFactor(s: PropertySnapshot): RiskFactor {
  const no2 = metric(s, 'air_quality.no2');
  const pm25 = metric(s, 'air_quality.pm25');
  const pm10 = metric(s, 'air_quality.pm10');
  const aqi = metric(s, 'air_quality.index');
  const assessed = no2 !== null || pm25 !== null || pm10 !== null || aqi !== null;
  const over = (no2 !== null && no2 > 90) || (pm25 !== null && pm25 > 25) || (pm10 !== null && pm10 > 50) || (no2 === null && pm25 === null && pm10 === null && aqi !== null && aqi > 75);
  const parts = [pm25 !== null ? `PM2,5 ${fmt(pm25)} µg/m³` : null, no2 !== null ? `NO₂ ${fmt(no2)} µg/m³` : null, pm10 !== null ? `PM10 ${fmt(pm10)} µg/m³` : null].filter(Boolean).join(' · ');
  const c: Contribution = over
    ? { points: 10, short: 'Över norm', reason: `Närmaste mätstation ligger över miljökvalitetsnormen${parts ? ` (${parts})` : ''}. Utomhusluft – påverkar inte byggnaden.` }
    : { points: 0, short: 'Inom norm', reason: `Närmaste mätstation ligger inom miljökvalitetsnormerna${parts ? ` (${parts})` : ''}.` };
  return factor('air', 'Luft (utomhus)', 10, c, assessed, 'Ingen luftmätstation inom 25 km med aktuella värden.');
}

/* ------------------------------------------------------------------ */
/* Assessment                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param isCurrent whether a source currently delivers fresh data (API: `ok` + fresh; demo: always).
 */
export function assessPropertyRisk(s: PropertySnapshot, isCurrent: (id: SourceId) => boolean): RiskIndex {
  const warningsCurrent = isCurrent('smhi_warnings');
  const crisisCurrent = isCurrent('krisinformation');
  const factors = [weatherFactor(s, warningsCurrent), waterFactor(s, warningsCurrent), vmaFactor(s, crisisCurrent), accessFactor(s, isCurrent('trafikverket')), airFactor(s)];
  const assessed = factors.filter((f) => f.assessed);

  if (!warningsCurrent || !crisisCurrent) {
    return {
      method: RISK_METHOD,
      score: null,
      level: null,
      summary: 'Ej bedömd – SMHI:s varningar eller Krisinformation kunde inte kontrolleras, så allvarliga händelser kan inte uteslutas.',
      assessedFactors: assessed.length,
      factors,
    };
  }

  const score = combineFactorPoints(assessed.map((f) => f.points!));
  const level = riskLevelOf(score);
  const top = [...assessed].sort((a, b) => b.points! - a.points!)[0];
  const summary =
    level === 'low'
      ? top && top.points! > 0
        ? `Inga aktuella varningar som bedöms påverka byggnaden. Störst bidrag: ${top.label.toLowerCase()} (${top.short.toLowerCase()}).`
        : 'Inga aktuella varningar som bedöms påverka byggnaden.'
      : top!.reason;
  return { method: RISK_METHOD, score, level, summary, assessedFactors: assessed.length, factors };
}

/** Portfolio score: mean of assessed properties, plus the highest one. */
export function portfolioRisk(items: Array<{ name: string; risk: RiskIndex | null | undefined }>): { score: number | null; level: RiskLevel | null; highest: { name: string; score: number } | null; assessed: number } {
  const scored = items.filter((x): x is { name: string; risk: RiskIndex & { score: number } } => typeof x.risk?.score === 'number');
  if (!scored.length) return { score: null, level: null, highest: null, assessed: 0 };
  const score = Math.round(scored.reduce((a, x) => a + x.risk.score, 0) / scored.length);
  const top = scored.reduce((a, x) => (x.risk.score > a.risk.score ? x : a));
  return { score, level: riskLevelOf(score), highest: { name: top.name, score: top.risk.score }, assessed: scored.length };
}
