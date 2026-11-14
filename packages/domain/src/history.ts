import { z } from 'zod';
import { swedishDateKey, swedishMidnight } from './format';

/** Collection and presentation policy. See ADR 0005. */
export const HISTORY = {
  eventRetentionMonths: 24,
  dailyRetentionYears: 5,
  rawRetentionDays: 35,
  hourlyDetailMaxDays: 2,
  maxRangeMonths: 24,
  normalFromYear: 1991,
  normalToYear: 2020,
  normalMinimumYears: 24,
  normalRefreshYears: 1,
  flowReferenceRefreshYears: 1,
  rainDistanceM: 25_000,
  weatherDistanceM: 50_000,
  seaDistanceM: 15_000,
  flowDistanceM: 5_000,
  trafficDistanceM: 1_000,
  minimumHistoryDays: 300,
  selectionWindowDays: 365,
  stationsPerRun: 3,
  candidatesPerProperty: 3,
  retryHours: 6,
  catalogRefreshHours: 24,
  collectionIntervalSeconds: 86_400,
  dailyCoverage: 1,
  wetDayMm: 10,
  mobileMaxBars: 60,
  dayMs: 86_400_000,
  hourMs: 3_600_000,
} as const;

export const HistoryDateSchema = z.iso.date();
export const HistoryQuerySchema = z
  .object({
    range: z.enum(['30d', '90d', '12m', 'custom']).default('12m'),
    from: HistoryDateSchema.optional(),
    to: HistoryDateSchema.optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.range === 'custom' && (!q.from || !q.to)) {
      ctx.addIssue({ code: 'custom', message: 'Ange från och till.' });
    }
    if (q.range !== 'custom' && (q.from || q.to)) {
      ctx.addIssue({ code: 'custom', message: 'Datum används med vald period.' });
    }
    if (q.from && q.to && (q.from > q.to || q.from < shiftMonths(q.to, -HISTORY.maxRangeMonths))) {
      ctx.addIssue({ code: 'custom', message: 'Perioden får vara högst 24 månader.' });
    }
  });
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;
export type HistoryPeriod = { from: string; to: string };

/** Clamp month ends (e.g. leap day) instead of Date's rollover into the next month. */
export function shiftMonths(date: string, months: number): string {
  const d = new Date(date + 'T12:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export function historyPeriod(query: HistoryQuery, now = new Date()): HistoryPeriod {
  const to = query.to ?? swedishDateKey(swedishMidnight(now, -1));
  let from = query.from;
  if (!from) {
    from =
      query.range === '12m'
        ? addHistoryDays(shiftMonths(to, -12), 1)
        : addHistoryDays(to, query.range === '90d' ? -89 : -29);
  }
  if (to > swedishDateKey(now)) throw new Error('Perioden kan inte sluta i framtiden.');
  return { from, to };
}

export function addHistoryDays(date: string, days: number): string {
  return new Date(Date.parse(date + 'T12:00:00Z') + days * HISTORY.dayMs).toISOString().slice(0, 10);
}

export function historyDates(period: HistoryPeriod): string[] {
  const dates: string[] = [];
  for (let date = period.from; date <= period.to; date = addHistoryDays(date, 1)) dates.push(date);
  return dates;
}

export const HistoryStationSchema = z.object({
  id: z.string(),
  stationId: z.string(),
  name: z.string(),
  distanceMeters: z.number().nonnegative(),
  sourceId: z.string(),
  parameter: z.string(),
});
export type HistoryStation = z.infer<typeof HistoryStationSchema>;

export const HistoryHourlySchema = z.object({
  station: HistoryStationSchema,
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  stepMinutes: z.literal(60),
  values: z.array(z.number().nullable()),
  coverage: z.array(z.number().min(0).max(1)),
});
export type HistoryHourly = z.infer<typeof HistoryHourlySchema>;

export const HistorySeriesSchema = z.object({
  key: z.string(),
  station: z.string(),
  unit: z.string(),
  dayDefinition: z.string(),
  values: z.array(z.number().nullable()),
  coverage: z.array(z.number().min(0).max(1)),
  min: z.array(z.number().nullable()).optional(),
  max: z.array(z.number().nullable()).optional(),
  origins: z.array(z.enum(['smhi_archive', 'own_aggregate'])),
  /** Per date: s = SMHI file, o = own aggregate, - = no stored row. */
  originCodes: z.string().regex(/^[so-]*$/),
  since: HistoryDateSchema.nullable(),
});
export type HistorySeries = z.infer<typeof HistorySeriesSchema>;

export const HistoryEventVersionSchema = z.object({
  version: z.number().int(),
  changedAt: z.iso.datetime(),
  level: z.enum(['Yellow', 'Orange', 'Red', 'VMA', 'Info']),
  title: z.string(),
  text: z.string().nullable(),
  eventType: z.string(),
  area: z.string().nullable(),
  validFrom: z.iso.datetime().nullable(),
  validTo: z.iso.datetime().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  matchedUntil: z.iso.datetime().nullable(),
  matches: z.array(z.object({ from: z.iso.datetime(), to: z.iso.datetime().nullable() })),
  endType: z.enum(['ended', 'cancelled']).nullable(),
  matchMethod: z.enum(['polygon_intersection', 'municipality', 'county', 'within_radius']),
  distanceMeters: z.number().nullable(),
  sourceUrl: z.string().nullable(),
});
export type HistoryEventVersion = z.infer<typeof HistoryEventVersionSchema>;
export const HistoryEventSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  sourceLabel: z.string(),
  externalId: z.string(),
  category: z.enum(['Weather', 'Water', 'VMA', 'Traffic', 'CountyInfo']),
  official: z.boolean(),
  attribution: z.string(),
  versions: z.array(HistoryEventVersionSchema).min(1),
});
export type HistoryEvent = z.infer<typeof HistoryEventSchema>;

export const HistoryMonthSchema = z.object({
  month: z.string(),
  value: z.number().nullable(),
  coverage: z.number(),
  complete: z.boolean(),
  normal: z.number().nullable(),
  normalYears: z.number().nullable(),
  percent: z.number().nullable(),
});
export type HistoryMonth = z.infer<typeof HistoryMonthSchema>;

export const PropertyHistorySchema = z
  .object({
    propertyId: z.string(),
    period: z.object({ from: HistoryDateSchema, to: HistoryDateSchema }),
    stations: z.array(HistoryStationSchema),
    daily: z.object({ dates: z.array(HistoryDateSchema), series: z.array(HistorySeriesSchema) }),
    monthly: z.array(HistoryMonthSchema),
    hourly: HistoryHourlySchema.nullable(),
    kpis: z.object({
      rainMm: z.number().nullable(),
      rainComplete: z.boolean(),
      normalPercent: z.number().nullable(),
      wettest: z.object({ date: z.string(), mm: z.number() }).nullable(),
      wetDays: z.number().nullable(),
      warningDays: z.number(),
      warningDaysByLevel: z.object({
        Yellow: z.number(),
        Orange: z.number(),
        Red: z.number(),
        VMA: z.number(),
      }),
      waterMax: z.object({ value: z.number(), date: z.string(), series: z.string() }).nullable(),
    }),
    events: z.array(HistoryEventSchema),
    gaps: z.array(z.object({ series: z.string(), from: z.string(), to: z.string() })),
    frostWeeks: z.array(
      z.object({ from: z.string(), crossings: z.number().nullable(), complete: z.boolean() }),
    ),
    flowReferences: z.array(
      z.object({
        month: z.number(),
        p75: z.number(),
        p95: z.number(),
        years: z.number(),
        samples: z.number(),
      }),
    ),
    since: z.object({ events: z.iso.datetime(), measurements: HistoryDateSchema.nullable() }),
    origin: z.enum(['live', 'demo_fixture']),
    attribution: z.string(),
  })
  .superRefine((h, ctx) => {
    for (const s of h.daily.series) {
      if (
        s.originCodes.length !== h.daily.dates.length ||
        [s.values, s.coverage, s.min, s.max].some((a) => a && a.length !== h.daily.dates.length)
      ) {
        ctx.addIssue({ code: 'custom', message: 'Series length differs from date axis.' });
      }
    }
    if (h.hourly && h.hourly.values.length !== h.hourly.coverage.length) {
      ctx.addIssue({ code: 'custom', message: 'Hourly coverage differs from value axis.' });
    }
  });
export type PropertyHistory = z.infer<typeof PropertyHistorySchema>;

export interface DailyValue {
  date: string;
  value: number | null;
  min?: number | null;
  max?: number | null;
  coverage: number;
  origin: 'smhi_archive' | 'own_aggregate';
}

/** Full monthly totals only. A partial month is never compared to a full-month normal. */
export function historyMonths(
  dates: string[],
  rain: HistorySeries | undefined,
  normals: Array<{ month: number; value: number; years: number }>,
): HistoryMonth[] {
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  return months.map((month) => {
    const indexes = dates.flatMap((d, i) => (d.startsWith(month) ? [i] : []));
    const expected = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
    const valid = indexes.filter(
      (i) => rain?.values[i] != null && rain.coverage[i] === HISTORY.dailyCoverage,
    );
    const complete = valid.length === expected;
    const value =
      valid.length === indexes.length && indexes.length
        ? roundHistory(indexes.reduce((sum, i) => sum + rain!.values[i]!, 0))
        : null;
    const normal = normals.find(
      (n) => n.month === Number(month.slice(5)) && n.years >= HISTORY.normalMinimumYears,
    );
    return {
      month,
      value,
      coverage: valid.length / expected,
      complete,
      normal: complete ? (normal?.value ?? null) : null,
      normalYears: complete ? (normal?.years ?? null) : null,
      percent:
        complete && value !== null && normal && normal.value > 0
          ? Math.round((value / normal.value) * 100)
          : null,
    };
  });
}

export const roundHistory = (value: number): number => Math.round(value * 10) / 10;

/** Each monthly archive row already represents a complete SMHI month; duplicates count once. */
export function precipitationNormals(rows: Array<{ month: string; value: number | null }>) {
  const unique = new Map(rows.map((r) => [r.month, r.value]));
  return Array.from({ length: 12 }, (_, i) => {
    const values: number[] = [];
    for (let year = HISTORY.normalFromYear; year <= HISTORY.normalToYear; year++) {
      const value = unique.get(`${year}-${String(i + 1).padStart(2, '0')}`);
      if (value != null && value >= 0) values.push(value);
    }
    return values.length >= HISTORY.normalMinimumYears
      ? {
          month: i + 1,
          value: roundHistory(values.reduce((a, b) => a + b, 0) / values.length),
          years: values.length,
        }
      : null;
  }).filter((n): n is NonNullable<typeof n> => n !== null);
}

export function historyGaps(dates: string[], series: HistorySeries[]) {
  const gaps: PropertyHistory['gaps'] = [];
  for (const s of series) {
    for (let i = 0; i < dates.length; i++) {
      if (s.values[i] != null && s.coverage[i] === HISTORY.dailyCoverage) continue;
      const from = dates[i]!;
      while (i + 1 < dates.length && (s.values[i + 1] == null || s.coverage[i + 1] !== HISTORY.dailyCoverage))
        i++;
      gaps.push({ series: s.key, from, to: dates[i]! });
    }
  }
  return gaps;
}

/** Version validity is clipped at the next change; a later upgrade cannot recolour earlier days. */
export function warningDays(dates: string[], events: HistoryEvent[]) {
  const levels = { Yellow: 0, Orange: 0, Red: 0, VMA: 0 };
  let count = 0;
  for (const date of dates) {
    const from = +swedishMidnight(new Date(date + 'T12:00:00Z'));
    const to = +swedishMidnight(new Date(date + 'T12:00:00Z'), 1);
    const active = new Set<string>();
    for (const e of events.filter((e) => e.official)) {
      e.versions.forEach((v, i) => {
        if (v.level === 'VMA' && v.matchMethod === 'county') return;
        const start = Math.max(
          Date.parse(v.validFrom ?? v.publishedAt ?? v.changedAt),
          i || v.version > 1 ? Date.parse(v.changedAt) : -Infinity,
        );
        const end = Math.min(
          Date.parse(v.validTo ?? v.endedAt ?? '9999-01-01T00:00:00Z'),
          v.endedAt ? Date.parse(v.endedAt) : Infinity,
          v.matchedUntil ? Date.parse(v.matchedUntil) : Infinity,
          e.versions[i + 1] ? Date.parse(e.versions[i + 1]!.changedAt) : Infinity,
        );
        const intervals = v.matches.length ? v.matches : [{ from: '0001-01-01T00:00:00.000Z', to: null }];
        if (
          v.level !== 'Info' &&
          intervals.some((match) => {
            const a = Math.max(start, Date.parse(match.from), from);
            const b = Math.min(end, match.to ? Date.parse(match.to) : Infinity, to);
            return b > a;
          })
        )
          active.add(v.level);
      });
    }
    if (active.size) count++;
    for (const level of Object.keys(levels) as Array<keyof typeof levels>)
      if (active.has(level)) levels[level]++;
  }
  return { count, levels };
}

export function historyKpis(
  dates: string[],
  series: HistorySeries[],
  monthly: HistoryMonth[],
  events: HistoryEvent[],
): PropertyHistory['kpis'] {
  const rain = series.find((s) => s.key === 'precipitation');
  const valid =
    rain?.values.flatMap((v, i) =>
      v !== null && rain.coverage[i] === 1 ? [{ date: dates[i]!, mm: v }] : [],
    ) ?? [];
  const rainComplete = valid.length === dates.length && dates.length > 0;
  const normalComplete =
    monthly.length > 0 && monthly.every((m) => m.complete && m.normal !== null && m.value !== null);
  const normalTotal = monthly.reduce((sum, m) => sum + (m.normal ?? 0), 0);
  const hasCompleteWater = (s: HistorySeries) =>
    s.values.some((value, index) => value !== null && s.coverage[index] === 1);
  const water =
    series.find((s) => s.key === 'sea_level' && hasCompleteWater(s)) ??
    series.find((s) => s.key === 'water_flow' && hasCompleteWater(s));
  const waterValues = water
    ? (water.max ?? water.values).flatMap((v, i) =>
        v !== null && water.coverage[i] === 1 ? [{ value: v, date: dates[i]!, series: water.key }] : [],
      )
    : [];
  const warnings = warningDays(dates, events);
  return {
    rainMm: rainComplete ? roundHistory(valid.reduce((sum, v) => sum + v.mm, 0)) : null,
    rainComplete,
    normalPercent:
      rainComplete && normalComplete && normalTotal > 0
        ? Math.round((valid.reduce((sum, v) => sum + v.mm, 0) / normalTotal) * 100)
        : null,
    wettest: valid.length ? valid.reduce((a, b) => (b.mm > a.mm ? b : a)) : null,
    wetDays: valid.length ? valid.filter((v) => v.mm >= HISTORY.wetDayMm).length : null,
    warningDays: warnings.count,
    warningDaysByLevel: warnings.levels,
    waterMax: waterValues.length ? waterValues.reduce((a, b) => (b.value > a.value ? b : a)) : null,
  };
}

/** Only observed hourly sign changes are counted; daily extrema cannot establish their number. */
export function frostWeeks(dates: string[], series: HistorySeries[]): PropertyHistory['frostWeeks'] {
  const crossings = series.find((s) => s.key === 'temperature_crossings');
  const byWeek = new Map<string, number[]>();
  dates.forEach((date, index) => {
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    const monday = addHistoryDays(date, -((weekday + 6) % 7));
    byWeek.set(monday, [...(byWeek.get(monday) ?? []), index]);
  });
  const weeks: PropertyHistory['frostWeeks'] = [];
  for (const [monday, indexes] of byWeek) {
    const complete =
      indexes.length === 7 &&
      indexes.every((i) => crossings?.values[i] != null && crossings.coverage[i] === 1);
    weeks.push({
      from: monday,
      complete,
      crossings: complete ? indexes.reduce((sum, i) => sum + crossings!.values[i]!, 0) : null,
    });
  }
  return weeks;
}

/** Includes the midnight baseline; missing hours never become zero crossings. */
export function aggregateTemperatureCrossings(
  points: Array<{ at: string; value: number }>,
  date: string,
): DailyValue {
  const from = +swedishMidnight(new Date(date + 'T12:00:00Z'));
  const to = +swedishMidnight(new Date(date + 'T12:00:00Z'), 1);
  const unique = new Map(
    points
      .filter((p) => {
        const at = Date.parse(p.at);
        return at >= from && at <= to && (at - from) % HISTORY.hourMs === 0;
      })
      .map((p) => [Date.parse(p.at), p.value]),
  );
  const values = [...unique].sort(([a], [b]) => a - b);
  const expected = (to - from) / HISTORY.hourMs + 1;
  let previous = 0;
  let crossings = 0;
  for (const [, value] of values) {
    const sign = Math.sign(value);
    if (sign && previous && sign !== previous) crossings++;
    if (sign) previous = sign;
  }
  const coverage = values.length / expected;
  return { date, value: coverage === 1 ? crossings : null, coverage, origin: 'own_aggregate' };
}

export function selectHistoryStation<
  T extends { distanceMeters: number; historyDays: number; normalMonths: number },
>(candidates: T[], distanceM: number): T | null {
  const suitable = candidates.filter(
    (s) => s.distanceMeters <= distanceM && s.historyDays >= HISTORY.minimumHistoryDays,
  );
  suitable.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return suitable.find((s) => s.normalMonths === 12) ?? suitable[0] ?? null;
}

/** Strict aggregate of timestamped interval-end readings over Swedish days, including 23/25 h. */
export function aggregateHistoryDay(
  points: Array<{ at: string; value: number }>,
  date: string,
  intervalMinutes: number,
  operation: 'sum' | 'mean' | 'max',
): DailyValue {
  const from = +swedishMidnight(new Date(date + 'T12:00:00Z'));
  const to = +swedishMidnight(new Date(date + 'T12:00:00Z'), 1);
  const step = intervalMinutes * 60_000;
  const unique = new Map(
    points
      .filter(
        (p) => Date.parse(p.at) > from && Date.parse(p.at) <= to && (Date.parse(p.at) - from) % step === 0,
      )
      .map((p) => [p.at, p.value]),
  );
  const values = [...unique.values()];
  const coverage = values.length / ((to - from) / step);
  const value =
    coverage === 1
      ? operation === 'sum'
        ? values.reduce((a, b) => a + b, 0)
        : operation === 'max'
          ? Math.max(...values)
          : values.reduce((a, b) => a + b, 0) / values.length
      : null;
  return {
    date,
    value: value === null ? null : roundHistory(value),
    coverage,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    origin: 'own_aggregate',
  };
}
