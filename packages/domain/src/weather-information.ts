/** Informational thresholds only; never used by risk index v1 or SMS rules. */
export const WEATHER_WATER = {
  intenseRainMonitorMm: 5, intenseRainWarningMm: 15, thunderPercent: 30,
  snowWaterMm: 5, snowCmPerMm: 1, icePrecipitationMm: 0.2, iceMinC: -2, iceMaxC: 1,
  zeroCrossings: 2, forecastUsableHours: 6,
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
  key: string; label: string; value: string; at: string; tone: 'monitor' | 'warning' | 'cold'; explanation?: string;
}
export function forecastInformation(all: InformationStep[], now: Date): ForecastInformation[] {
  const a = now.getTime(), b = a + 24 * 3_600_000;
  const steps = all.filter(s => Date.parse(s.time) > a && Date.parse(s.time) <= b).sort((x,y) => x.time.localeCompare(y.time));
  const out: ForecastInformation[] = [];
  const rain = steps.filter(s => s.intervalStart && Date.parse(s.time) - Date.parse(s.intervalStart) === 3_600_000 && s.precipitationMean != null)
    .sort((x,y) => y.precipitationMean! - x.precipitationMean!)[0];
  if (rain && rain.precipitationMean! >= WEATHER_WATER.intenseRainMonitorMm) out.push({ key: 'intense-rain', label: 'Intensivt regn (prognos)', value: `ca ${Math.round(rain.precipitationMean!)} mm på en timme`, at: rain.time, tone: rain.precipitationMean! >= WEATHER_WATER.intenseRainWarningMm ? 'warning' : 'monitor' });
  const thunder = steps.filter(s => s.thunderProbability != null).sort((x,y) => y.thunderProbability! - x.thunderProbability!)[0];
  if (thunder && thunder.thunderProbability! >= WEATHER_WATER.thunderPercent) out.push({ key: 'thunder', label: 'Risk för åska (prognos)', value: `${Math.round(thunder.thunderProbability!)} %`, at: thunder.time, tone: 'monitor' });
  let snow = 0, cursor = a;
  for (const s of all.filter(s => Date.parse(s.time) > a).sort((x,y) => x.time.localeCompare(y.time))) {
    const end = Math.min(b, Date.parse(s.time)), start = Math.max(a, Date.parse(s.intervalStart ?? ''));
    if (start >= b) break;
    if (end <= start) continue;
    if (start !== cursor || s.precipitationMean == null || (s.precipitationMean > 0 && s.frozenPartPercent == null)) break;
    snow += s.precipitationMean * (s.frozenPartPercent ?? 0) / 100 * (end - start) / (Date.parse(s.time) - Date.parse(s.intervalStart!));
    cursor = end;
    if (cursor === b) break;
  }
  if (cursor === b && snow >= WEATHER_WATER.snowWaterMm) out.push({ key: 'snow', label: 'Snöfall väntas (prognos)', value: `ca ${Math.round(snow * WEATHER_WATER.snowCmPerMm)} cm`, at: steps[0]?.time ?? now.toISOString(), tone: 'cold' });
  let previous: InformationStep | undefined;
  for (const s of steps) {
    const contiguous = previous && s.intervalStart === previous.time;
    const afterFrost = s.airTemperature != null && s.airTemperature > 0 && contiguous && previous && previous.airTemperature != null && previous.airTemperature < 0 && s.frozenPartPercent != null && s.frozenPartPercent < 100;
    if (s.precipitationMean != null && s.precipitationMean >= WEATHER_WATER.icePrecipitationMm && s.airTemperature != null && ((s.airTemperature >= WEATHER_WATER.iceMinC && s.airTemperature <= WEATHER_WATER.iceMaxC) || afterFrost)) {
      out.push({ key: 'ice', label: 'Risk för halka och isbildning (prognos)', value: 'Nederbörd nära eller efter minusgrader', at: s.time, tone: 'cold' }); break;
    }
    previous = s;
  }
  let sign: number | null = null, crossings = 0, last: string | null = null;
  for (const s of all.filter(s => Date.parse(s.time) > a && Date.parse(s.time) <= a + 48 * 3_600_000).sort((x,y) => x.time.localeCompare(y.time))) {
    if (s.airTemperature == null || (last && s.intervalStart !== last)) sign = null;
    const next = s.airTemperature == null ? null : Math.sign(s.airTemperature);
    if (next && sign && next !== sign) crossings++;
    if (next) sign = next;
    last = s.time;
  }
  if (crossings >= WEATHER_WATER.zeroCrossings) out.push({ key: 'freeze-thaw', label: 'Växlande plus- och minusgrader (prognos)', value: `${crossings} gånger`, explanation: 'kan ge is och istappar på tak', at: steps[0]?.time ?? now.toISOString(), tone: 'cold' });
  return out;
}
