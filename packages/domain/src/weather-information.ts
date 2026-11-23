/** Informational thresholds only; never used by risk index v1 or SMS rules. */
export const WEATHER_WATER = {
  intenseRainMonitorMm: 5, intenseRainWarningMm: 15, thunderPercent: 30,
  snowWaterMm: 5, snowCmPerMm: 1, icePrecipitationMm: 0.2, iceMinC: -2, iceMaxC: 1,
  zeroCrossings: 2, forecastUsableHours: 6, upcomingHours: 48,
  heavyPrecipitationMonitorMm: 15, heavyPrecipitationWarningMm: 30,
  nowcastNoiseMmH: 0.2, moderateMmH: 2.5, heavyMmH: 10, cloudburstMmH: 50,
  snowMaxC: 0.5, mixedMaxC: 2, nowcastFreshMinutes: 15, nowcastUsableMinutes: 30,
  seaDistanceM: 15_000, flowDistanceM: 5_000, observationDistanceM: 50_000, airDistanceM: 25_000,
  trendCoverage: 0.75, referenceMinYears: 3, referenceMinDays: 30, referenceRefreshDays: 7, referenceUsableDays: 14,
  seaSourceFreshSeconds: 1800, flowSourceFreshSeconds: 2700, stationMeasurementFreshSeconds: 3600,
  seaTrendDeadbandCm: 2, historyCoverage: 0.9, flowNormalPercentile: 0.75, flowHighPercentile: 0.95,
  /**
   * History backfill for the nearest 15-min rain station of each active property: when fewer than
   * `backfillCoverage` of the last `backfillHours` quarter-hours are stored, the station's recent
   * series (SMHI latest-months) is fetched once; a station is retried at most every `backfillRetryHours`.
   * `backfillStationMaxAgeHours` matches the snapshot's nearest-station rule.
   */
  backfillHours: 72, backfillCoverage: 0.97, backfillRetryHours: 6, backfillStationsPerRun: 3, backfillStationMaxAgeHours: 3,
} as const;

export interface InformationStep {
  time: string; intervalStart: string | null; airTemperature: number | null;
  precipitationMean: number | null; frozenPartPercent: number | null; thunderProbability: number | null;
}
export interface ForecastInformation {
  key: string; label: string; value: string;
  /** Start of the condition; `until` its end (both ISO) – drawn as a bar on the 48 h timeline. */
  at: string; until: string;
  tone: 'monitor' | 'warning' | 'cold'; explanation?: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function strongestDay(
  intervals: { start: number; end: number; step: InformationStep }[],
  from: number,
  to: number,
  amount: (step: InformationStep) => number | null,
) {
  // The running total is linear between interval boundaries of either end of the window.
  const starts = new Set([from, to - DAY]);
  for (const { start, end } of intervals) {
    for (const t of [start, end, start - DAY, end - DAY]) {
      if (t > from && t < to - DAY) starts.add(t);
    }
  }
  let best: { start: number; total: number } | undefined;
  for (const start of starts) {
    const end = start + DAY;
    let cursor = start;
    let total = 0;
    for (const interval of intervals) {
      const left = Math.max(start, interval.start);
      const right = Math.min(end, interval.end);
      if (left >= right) continue;
      const value = amount(interval.step);
      if (left !== cursor || value === null) break;
      total += value * (right - left) / (interval.end - interval.start);
      cursor = right;
      if (cursor === end) break;
    }
    if (cursor !== end) continue;
    if (!best || total > best.total + 1e-9 || (Math.abs(total - best.total) < 1e-9 && start < best.start)) best = { start, total };
  }
  return best && { total: best.total, at: new Date(best.start).toISOString(), until: new Date(best.start + DAY).toISOString() };
}

export function forecastInformation(all: InformationStep[], now: Date): ForecastInformation[] {
  const a = now.getTime(), b = a + WEATHER_WATER.upcomingHours * HOUR;
  const intervals = all.map((step) => {
    const end = Date.parse(step.time);
    return { step, end, start: step.intervalStart ? Date.parse(step.intervalStart) : end - HOUR };
  }).filter(({ start, end }) => end > a && start < b && start < end).sort((x, y) => x.end - y.end);
  const steps = intervals.filter(({ end }) => end <= b).map(({ step }) => step);
  const out: ForecastInformation[] = [];
  const rain = steps.filter(s => s.intervalStart && Date.parse(s.time) - Date.parse(s.intervalStart) === HOUR && s.precipitationMean != null)
    .sort((x,y) => y.precipitationMean! - x.precipitationMean!)[0];
  if (rain && rain.precipitationMean! >= WEATHER_WATER.intenseRainMonitorMm) out.push({ key: 'intense-rain', label: 'Intensivt regn (prognos)', value: `ca ${Math.round(rain.precipitationMean!)} mm på en timme`, at: rain.intervalStart!, until: rain.time, tone: rain.precipitationMean! >= WEATHER_WATER.intenseRainWarningMm ? 'warning' : 'monitor' });
  const thunder = steps.filter(s => s.thunderProbability != null).sort((x,y) => y.thunderProbability! - x.thunderProbability!)[0];
  if (thunder && thunder.thunderProbability! >= WEATHER_WATER.thunderPercent) out.push({ key: 'thunder', label: 'Risk för åska (prognos)', value: `${Math.round(thunder.thunderProbability!)} %`, at: thunder.intervalStart ?? thunder.time, until: thunder.time, tone: 'monitor' });
  const wettest = strongestDay(intervals, a, b, (s) => s.precipitationMean);
  const rainTotal = Math.round((wettest?.total ?? 0) * 10) / 10;
  if (wettest && rainTotal >= WEATHER_WATER.heavyPrecipitationMonitorMm) {
    out.push({ key: 'rain', label: 'Kraftig nederbörd (24 h)', value: `${rainTotal.toFixed(0)} mm`, at: wettest.at, until: wettest.until, tone: rainTotal >= WEATHER_WATER.heavyPrecipitationWarningMm ? 'warning' : 'monitor' });
  }
  const snowiest = strongestDay(intervals, a, b, (s) => {
    if (s.precipitationMean === 0) return 0;
    return s.precipitationMean != null && s.frozenPartPercent != null ? s.precipitationMean * s.frozenPartPercent / 100 : null;
  });
  if (snowiest && snowiest.total >= WEATHER_WATER.snowWaterMm) {
    out.push({ key: 'snow', label: 'Snöfall väntas (prognos)', value: `ca ${Math.round(snowiest.total * WEATHER_WATER.snowCmPerMm)} cm`, at: snowiest.at, until: snowiest.until, tone: 'cold' });
  }
  // Ice: from the first to the last step that gives a risk within the forecast window.
  let previous: InformationStep | undefined, iceFrom: InformationStep | undefined, iceTo: InformationStep | undefined;
  for (const s of steps) {
    const contiguous = previous && s.intervalStart === previous.time;
    const afterFrost = s.airTemperature != null && s.airTemperature > 0 && contiguous && previous && previous.airTemperature != null && previous.airTemperature < 0 && s.frozenPartPercent != null && s.frozenPartPercent < 100;
    if (s.precipitationMean != null && s.precipitationMean >= WEATHER_WATER.icePrecipitationMm && s.airTemperature != null && ((s.airTemperature >= WEATHER_WATER.iceMinC && s.airTemperature <= WEATHER_WATER.iceMaxC) || afterFrost)) {
      iceFrom ??= s;
      iceTo = s;
    }
    previous = s;
  }
  if (iceFrom && iceTo) out.push({ key: 'ice', label: 'Risk för halka och isbildning (prognos)', value: 'Nederbörd nära eller efter minusgrader', at: iceFrom.intervalStart ?? iceFrom.time, until: iceTo.time, tone: 'cold' });
  // Freeze–thaw: from the first to the last crossing of 0° within 48 h.
  let sign: number | null = null, crossings = 0, last: string | null = null, crossFrom: string | null = null, crossTo: string | null = null;
  for (const s of steps) {
    if (s.airTemperature == null || (last && s.intervalStart !== last)) sign = null;
    const next = s.airTemperature == null ? null : Math.sign(s.airTemperature);
    if (next && sign && next !== sign) {
      crossings++;
      crossFrom ??= s.intervalStart ?? s.time;
      crossTo = s.time;
    }
    if (next) sign = next;
    last = s.time;
  }
  if (crossings >= WEATHER_WATER.zeroCrossings) out.push({ key: 'freeze-thaw', label: 'Växlande plus- och minusgrader (prognos)', value: `${crossings} gånger`, explanation: 'kan ge is och istappar på tak', at: crossFrom!, until: crossTo!, tone: 'cold' });
  return out;
}
