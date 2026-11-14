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
): HistoryEvent {
  const start = date + 'T00:00:00.000Z';
  const end = addHistoryDays(date, 1) + 'T18:00:00.000Z';
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
    const season = Math.cos(((d.getUTCMonth() - 6) / 12) * Math.PI * 2);
    const pulse = (day * 17 + seed) % 23;
    const rain = pulse < 10 ? 0 : pulse === 22 ? 20 + (seed % 7) : (pulse - 9) * 0.65;
    const mean = 7 + 10 * season + Math.sin(day * 0.7) * 3;
    const autumn = [8, 9, 10].includes(d.getUTCMonth());
    const daysInMonth = new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getDate();
    return {
      rain: roundHistory(((rain * NORMALS[d.getUTCMonth()]) / daysInMonth / 3.3) * (autumn ? 1.55 : 1)),
      min: roundHistory(mean - 3.5),
      max: roundHistory(mean + 4),
      mean: roundHistory(mean),
      wind: roundHistory(5 + Math.abs(Math.sin(day * 0.3)) * 9 + (date === '2025-11-11' ? 9 : 0)),
      sea: roundHistory(10 + Math.sin(day * 0.15) * 25 + (autumn ? 13 : 0)),
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
            min: values.map((v) => (v === null ? null : roundHistory(v - 7))),
            max: values.map((v) => (v === null ? null : roundHistory(v + 8))),
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
    demoEvent('demo-autumn', '2025-10-04', 'Orange', 'Weather', 'Vind'),
    demoEvent('demo-rain', '2025-11-03', 'Yellow', 'Weather', 'Regn'),
    demoEvent('demo-traffic', '2025-11-07', 'Info', 'Traffic', 'Vägen avstängd'),
    demoEvent(
      'demo-county',
      '2025-11-08',
      'Info',
      'CountyInfo',
      'Information om störningar i kollektivtrafiken',
    ),
    demoEvent('demo-wind', '2025-11-11', 'Orange', 'Weather', 'Vind i Nacka', true),
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
    since: { events: '2024-11-12T00:00:00.000Z', measurements: '2024-11-12' },
    attribution:
      'Demo: syntetiska mätvärden, normaler och händelser. Illustrerar Stockholmsklimat. Inga verkliga myndighetsuppgifter.',
  });
}
