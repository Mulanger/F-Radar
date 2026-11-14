import {
  HISTORY,
  PropertyHistorySchema,
  addHistoryDays,
  frostWeeks,
  historyDates,
  historyGaps,
  historyKpis,
  historyMonths,
  roundHistory,
  type HistoryHourly,
  type HistoryEvent,
  type HistoryEventVersion,
  type HistoryPeriod,
  type HistorySeries,
  type HistoryStation,
} from '../history';
import { DEMO_REFERENCE_TIME, demoPortfolio } from './demo-portfolio';
import { swedishMidnight } from '../format';

const NORMALS = [39, 27, 26, 30, 35, 56, 72, 66, 55, 50, 53, 48];

function seedOf(text: string): number {
  return [...text].reduce((seed, letter) => (seed * 31 + letter.charCodeAt(0)) % 65521, 17);
}

function stationDistance(lat: number, lon: number): number {
  const north = (lat - 59.3417) * 111_320;
  const east = (lon - 18.0549) * 111_320 * Math.cos((lat * Math.PI) / 180);
  return Math.round(Math.hypot(north, east));
}

function demoEvent(
  id: string,
  date: string,
  level: HistoryEventVersion['level'],
  category: HistoryEvent['category'],
  title: string,
  upgrade = false,
  /** Exact validity (UTC ISO) when the default "date 00Z → next day 18Z" does not fit the story. */
  window?: { from: string; to: string },
): HistoryEvent {
  const start = window?.from ?? date + 'T00:00:00.000Z';
  const end = window?.to ?? addHistoryDays(date, 1) + 'T18:00:00.000Z';
  const version: HistoryEventVersion = {
    version: 1,
    changedAt: addHistoryDays(date, -1) + 'T09:00:00.000Z',
    level: upgrade ? 'Yellow' : level,
    title,
    text: 'Syntetisk demotext. Exemplet visar hur källans text presenteras i historiken.',
    eventType: title,
    area: 'Stockholmsområdet (demo)',
    validFrom: start,
    validTo: end,
    publishedAt: addHistoryDays(date, -1) + 'T09:00:00.000Z',
    endedAt: end,
    matchedUntil: null,
    matches: [],
    endType: 'ended',
    matchMethod:
      category === 'Traffic'
        ? 'within_radius'
        : category === 'CountyInfo' || category === 'VMA'
          ? 'municipality'
          : 'polygon_intersection',
    distanceMeters: category === 'Traffic' ? 420 : null,
    sourceUrl: null,
  };
  const sourceId =
    category === 'Traffic'
      ? 'trafikverket'
      : category === 'CountyInfo' || category === 'VMA'
        ? 'krisinformation'
        : 'smhi_warnings';
  return {
    id,
    externalId: id,
    sourceId,
    sourceLabel:
      sourceId === 'smhi_warnings'
        ? 'SMHI (demo)'
        : category === 'Traffic'
          ? 'Trafikverket (demo)'
          : 'Krisinformation.se (demo)',
    category,
    official: !['Traffic', 'CountyInfo'].includes(category),
    attribution: 'Syntetisk demohändelse, ingen verklig myndighetsvarning.',
    versions: upgrade
      ? [
          version,
          {
            ...version,
            version: 2,
            changedAt: date + 'T13:32:00.000Z',
            publishedAt: date + 'T13:32:00.000Z',
            level,
          },
        ]
      : [version],
  };
}

/** Deterministic 0..1 value per day (integer hash, identical in every runtime). */
function dayNoise(day: number, salt: number): number {
  let x = (day * 374_761_393 + salt * 668_265_263) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1_274_126_177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4_294_967_296;
}

/** Storm surges in the demo story: peak day → extra cm, decaying over the following days. */
const DEMO_SURGES: Array<[string, number]> = [
  ['2025-01-08', 16],
  ['2025-10-04', 30],
  ['2025-11-03', 12],
  ['2025-11-11', 18],
];

/**
 * Plausible Baltic sea level around Stockholm in cm RW (0 = the year's mean): highest around
 * midwinter and lowest in early summer, irregular week-scale weather variation, storm surges on
 * the demo's windy days and small day-to-day noise. Daily min/max widen on surge days.
 */
function demoSeaLevel(date: string, day: number, seed: number): { mean: number; min: number; max: number } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dayOfYear = (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / HISTORY.dayMs;
  const seasonal = 12 * Math.cos((2 * Math.PI * (dayOfYear - 354)) / 365);
  const weather = 9 * Math.sin((2 * Math.PI * day) / 23.7 + (seed % 7)) + 5 * Math.sin((2 * Math.PI * day) / 9.3 + 1.7);
  let surge = 0;
  for (const [peak, cm] of DEMO_SURGES) {
    const after = (Date.parse(date) - Date.parse(peak)) / HISTORY.dayMs;
    if (after >= 0 && after < 4) surge += cm * Math.exp(-after * 0.9);
  }
  const mean = seasonal + weather + surge + (dayNoise(day, 11) - 0.5) * 6;
  const range = 5 + dayNoise(day, 29) * 7 + surge * 0.4;
  return { mean, min: mean - range * 0.45, max: mean + range * 0.55 };
}

/** Demo story days: date → [rain mm, extra gust m/s, temperature anomaly °C]. */
const DEMO_WEATHER_DAYS: Record<string, [number, number, number]> = {
  '2025-01-08': [6, 6, -2], // snowfall (yellow)
  '2025-02-19': [3, 2, 2], // rain on frozen ground (yellow ice)
  '2025-07-18': [26, 4, 2], // summer downpour (yellow heavy rain)
  '2025-10-04': [12, 12, 0], // autumn storm (yellow → orange wind)
  '2025-11-03': [17, 3, 1], // heavy rain (yellow)
  '2025-11-11': [4, 8, 0], // windy day (yellow wind, closed after 18 h)
};

/**
 * Plausible Stockholm daily weather without a visible pattern: smooth seasonal curve by day of
 * year (no month steps), irregular multi-day weather swings, ~45 % wet days with a skewed amount
 * distribution scaled to the monthly normal, and the demo story's warning days on top.
 */
function demoWeather(date: string, day: number, seed: number, normalPerDay: number, autumn: boolean) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dayOfYear = (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / HISTORY.dayMs;
  const summer = Math.cos((2 * Math.PI * (dayOfYear - 200)) / 365); // +1 mid-July, −1 mid-January
  const story = DEMO_WEATHER_DAYS[date];
  const swing = 2.6 * Math.sin((2 * Math.PI * day) / 11.3 + (seed % 5)) + 1.8 * Math.sin((2 * Math.PI * day) / 5.1 + 0.8);
  const mean = 7 + 10.5 * summer + swing + (dayNoise(day, 3) - 0.5) * 3 + (story?.[2] ?? 0);
  const range = 4 + 3 * Math.max(0, summer) + dayNoise(day, 5) * 3;
  const wet = dayNoise(day + seed, 7) < 0.45;
  const scale = (normalPerDay / 0.45) * (autumn ? 1.4 : 1);
  const rain = story ? story[0] : wet ? -Math.log(1 - dayNoise(day + seed, 13) * 0.97) * scale : 0;
  const gustSwing = 2 * Math.sin((2 * Math.PI * day) / 6.7 + (seed % 3)) + 1.5 * Math.sin((2 * Math.PI * day) / 2.9 + 0.4);
  const gust = Math.max(3, 8.5 + 2.5 * -summer + gustSwing + (dayNoise(day, 17) - 0.5) * 7 + (story?.[1] ?? 0));
  return {
    rain: roundHistory(rain),
    mean: roundHistory(mean),
    min: roundHistory(mean - range / 2),
    max: roundHistory(mean + range / 2),
    gust: roundHistory(gust),
  };
}

/** Fixed seasonal model, stable across runtimes. No live data or random state enters the demo. */
export function buildDemoHistory(
  propertyId: string,
  period: HistoryPeriod,
  scenario: 'complete' | 'gaps' | 'empty' = 'complete',
) {
  const property = demoPortfolio.properties.find((p) => p.property.id === propertyId)?.property;
  if (!property) throw new Error('Unknown demo property');
  const seed = seedOf(propertyId);
  const dates = historyDates(period);
  const distanceMeters = stationDistance(property.location.lat, property.location.lon);
  const parameters = [
    'precipitation',
    'temperature_min',
    'temperature_max',
    'temperature_mean',
    'temperature_crossings',
    'wind_gust',
    'sea_level',
    ...(propertyId === 'demo-ulvsunda-lager' ? ['water_flow'] : []),
  ];
  const stations: HistoryStation[] = parameters.map((parameter) => {
    let station = {
      sourceId: 'smhi_observations',
      stationId: '98230',
      name: 'Stockholm-Observatoriekullen A (demo)',
      distanceMeters,
    };
    if (parameter === 'sea_level')
      station = {
        sourceId: 'smhi_oceanography',
        stationId: '33097',
        name: 'Stockholm (demo)',
        distanceMeters: 3400 + (seed % 2200),
      };
    if (parameter === 'wind_gust')
      station = { ...station, stationId: 'demo-wind', name: 'Stockholm, vindstation (demo)' };
    if (parameter === 'water_flow')
      station = {
        sourceId: 'smhi_hydrology',
        stationId: 'demo-flow',
        name: 'Bällstaån, flödesstation (demo)',
        distanceMeters: 800,
      };
    return { ...station, id: `${station.sourceId}:${station.stationId}:${parameter}`, parameter };
  });
  const rows = dates.map((date) => {
    const d = new Date(date + 'T12:00:00Z');
    const day = Math.floor(+d / HISTORY.dayMs);
    const autumn = [8, 9, 10].includes(d.getUTCMonth());
    const daysInMonth = new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getDate();
    const sea = demoSeaLevel(date, day, seed);
    const weather = demoWeather(date, day, seed, NORMALS[d.getUTCMonth()]! / daysInMonth, autumn);
    return {
      rain: weather.rain,
      min: weather.min,
      max: weather.max,
      mean: weather.mean,
      wind: weather.gust,
      sea: roundHistory(sea.mean),
      seaMin: roundHistory(sea.min),
      seaMax: roundHistory(sea.max),
      flow: roundHistory(2 + Math.sin(day * 0.04) * 1.2 + (autumn ? 1.5 : 0)),
    };
  });
  const series: HistorySeries[] = parameters.map((key) => {
    const station = stations.find((s) => s.parameter === key)!;
    const values = rows.map((r, i) => {
      if (scenario === 'empty' || dates[i] < '2024-11-12' || dates[i] > '2025-11-11') return null;
      if (scenario === 'gaps' && dates[i] >= '2025-11-03' && dates[i] <= '2025-11-05') return null;
      return {
        precipitation: r.rain,
        temperature_min: r.min,
        temperature_max: r.max,
        temperature_mean: r.mean,
        temperature_crossings: r.min < 0 && r.max > 0 ? 2 : 0,
        wind_gust: r.wind,
        sea_level: r.sea,
        water_flow: r.flow,
      }[key]!;
    });
    return {
      key,
      station: station.id,
      unit:
        key === 'precipitation'
          ? 'mm'
          : key === 'wind_gust'
            ? 'm/s'
            : key === 'sea_level'
              ? 'cm RW'
              : key === 'water_flow'
                ? 'm³/s'
                : key === 'temperature_crossings'
                  ? 'passager'
                  : '°C',
      dayDefinition:
        key === 'precipitation'
          ? 'smhi_06_utc'
          : ['temperature_min', 'temperature_max'].includes(key)
            ? 'smhi_18_utc'
            : key === 'temperature_mean'
              ? 'smhi_00_utc'
              : key === 'water_flow'
                ? 'smhi_hydro_cest'
                : 'swedish_calendar',
      values,
      coverage: values.map((v) => (v === null ? 0 : 1)),
      origins: ['smhi_archive'],
      originCodes: values.map((value) => (value === null ? '-' : 's')).join(''),
      since: '2024-11-12',
      ...(key === 'sea_level'
        ? {
            min: values.map((v, i) => (v === null ? null : rows[i]!.seaMin)),
            max: values.map((v, i) => (v === null ? null : rows[i]!.seaMax)),
          }
        : {}),
    };
  });
  const allEvents = [
    demoEvent('demo-snow', '2025-01-08', 'Yellow', 'Weather', 'Snöfall'),
    demoEvent('demo-ice', '2025-02-19', 'Yellow', 'Weather', 'Plötslig ishalka'),
    demoEvent('demo-flow', '2025-04-09', 'Yellow', 'Water', 'Höga flöden'),
    demoEvent('demo-shower', '2025-07-18', 'Yellow', 'Weather', 'Kraftigt regn'),
    demoEvent('demo-vma', '2025-08-14', 'VMA', 'VMA', 'Viktigt meddelande till allmänheten'),
    // The autumn storm shows how an upgrade (yellow → orange) is kept inside one timeline row.
    demoEvent('demo-autumn', '2025-10-04', 'Orange', 'Weather', 'Vind', true),
    demoEvent('demo-rain', '2025-11-03', 'Yellow', 'Weather', 'Regn'),
    demoEvent('demo-traffic', '2025-11-07', 'Info', 'Traffic', 'Vägen avstängd'),
    demoEvent(
      'demo-county',
      '2025-11-08',
      'Info',
      'CountyInfo',
      'Information om störningar i kollektivtrafiken',
    ),
    // Matches the "Nu" demo: yesterday's yellow wind warning, closed after 18 h (00–18 Swedish time).
    // Today's orange wind and yellow rain warnings are current, not history.
    demoEvent('demo-wind', '2025-11-11', 'Yellow', 'Weather', 'Vind i Nacka', false, {
      from: '2025-11-10T23:00:00.000Z',
      to: '2025-11-11T17:00:00.000Z',
    }),
  ];
  const localEvents = allEvents.filter((e) => {
    if (e.category === 'VMA') return propertyId === 'demo-ulvsunda-lager';
    if (e.id === 'demo-wind') return propertyId === 'demo-augustendal-brygga';
    return true;
  });
  const events =
    scenario === 'empty'
      ? []
      : localEvents.filter(
          (e) =>
            e.versions[0].validFrom!.slice(0, 10) <= period.to &&
            e.versions[0].validTo!.slice(0, 10) >= period.from,
        );
  const normals = NORMALS.map((value, i) => ({ month: i + 1, value, years: 30 }));
  const monthly = historyMonths(dates, series[0], normals);
  let hourly: HistoryHourly | null = null;
  if (dates.length <= HISTORY.hourlyDetailMaxDays && period.from >= '2025-10-08') {
    const from = swedishMidnight(new Date(period.from + 'T12:00:00Z'));
    const to = swedishMidnight(new Date(period.to + 'T12:00:00Z'), 1);
    const length = (+to - +from) / HISTORY.hourMs;
    const values = Array.from({ length }, (_, hour) =>
      +from + (hour + 1) * HISTORY.hourMs > Date.parse(DEMO_REFERENCE_TIME) ||
      scenario === 'empty' ||
      (scenario === 'gaps' && period.from === '2025-11-03')
        ? null
        : roundHistory(Math.max(0, Math.sin((hour + (seed % 7)) * 0.7)) * (1 + (seed % 3))),
    );
    hourly = {
      station: {
        ...stations[0],
        id: 'smhi_observations:demo-quarter:precipitation_15min',
        stationId: 'demo-quarter',
        parameter: 'precipitation_15min',
        name: 'Stockholm, kvartsmätning (demo)',
      },
      from: from.toISOString(),
      to: to.toISOString(),
      stepMinutes: 60,
      values,
      coverage: values.map((v) => (v === null ? 0 : 1)),
    };
  }
  return PropertyHistorySchema.parse({
    propertyId,
    period,
    stations,
    daily: { dates, series },
    monthly,
    hourly,
    events,
    kpis: historyKpis(dates, series, monthly, events),
    gaps: historyGaps(dates, series),
    frostWeeks: frostWeeks(dates, series),
    flowReferences:
      propertyId === 'demo-ulvsunda-lager'
        ? Array.from({ length: 12 }, (_, i) => ({ month: i + 1, p75: 2.8, p95: 4.2, years: 5, samples: 150 }))
        : [],
    origin: 'demo_fixture',
    since: {
      events: swedishMidnight(new Date('2024-11-12T12:00:00Z')).toISOString(),
      measurements: '2024-11-12',
    },
    attribution:
      'Demo: syntetiska mätvärden, normaler och händelser. Illustrerar Stockholmsklimat. Inga verkliga myndighetsuppgifter.',
  });
}
