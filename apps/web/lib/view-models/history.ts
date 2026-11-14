import {
  HISTORY,
  addHistoryDays,
  formatDistance,
  formatNumber,
  formatShortDate,
  swedishMidnight,
  type HistoryEvent,
  type HistorySeries,
  type PropertyHistory,
  type WarningLevel,
} from '@fastighetsradar/domain';

export const HISTORY_CATEGORIES = [
  { id: 'Weather', label: 'Väder' },
  { id: 'Water', label: 'Vatten' },
  { id: 'VMA', label: 'VMA' },
  { id: 'Traffic', label: 'Trafik' },
  { id: 'CountyInfo', label: 'Länsinfo' },
] as const;

export const HISTORY_DEFINITIONS: Record<string, string> = {
  smhi_06_utc: 'SMHI-dygn kl 06–06 UTC (kl 07 vintertid, kl 08 sommartid). Datum avser dygnets början.',
  smhi_18_utc: 'SMHI-dygn kl 18–18 UTC. Datum är SMHI:s representativa dygn.',
  smhi_00_utc: 'SMHI-dygn kl 00–00 UTC.',
  swedish_calendar: 'Svenska kalenderdygn, kl 00–24.',
  smhi_hydro_cest: 'SMHI:s dygn, datum enligt källans svenska sommartid (UTC+2).',
};

export function historyStationLabel(history: PropertyHistory, series: HistorySeries | undefined): string {
  const station = history.stations.find((s) => s.id === series?.station);
  return station
    ? `vid ${station.name} (${formatDistance(station.distanceMeters)})`
    : 'Ingen station med tillräcklig historik inom avståndsgränsen.';
}

export interface RainBar {
  from: string;
  to: string;
  label: string;
  value: number | null;
  normal: number | null;
  complete: boolean;
  warnings: Array<{ title: string; level: WarningLevel }>;
  bands: Array<{ left: number; width: number; level: WarningLevel }>;
}

/** Version-aware overlap, shared by chart bands and touch/mouse tooltips. */
function warningOverlaps(events: HistoryEvent[], from: string, to: string, definition = 'swedish_calendar') {
  const a =
    definition === 'smhi_06_utc'
      ? Date.parse(from + 'T06:00:00Z')
      : +swedishMidnight(new Date(from + 'T12:00:00Z'));
  const b =
    definition === 'smhi_06_utc'
      ? Date.parse(addHistoryDays(to, 1) + 'T06:00:00Z')
      : +swedishMidnight(new Date(to + 'T12:00:00Z'), 1);
  const found: Array<{ id: string; title: string; level: WarningLevel; left: number; width: number }> = [];
  for (const event of events.filter((e) => e.official)) {
    event.versions.forEach((v, i) => {
      if (v.level === 'VMA' && v.matchMethod === 'county') return;
      const start = Math.max(
        Date.parse(v.validFrom ?? v.publishedAt ?? v.changedAt),
        i || v.version > 1 ? Date.parse(v.changedAt) : -Infinity,
      );
      const end = Math.min(
        Date.parse(v.validTo ?? v.endedAt ?? '9999-01-01T00:00:00Z'),
        v.endedAt ? Date.parse(v.endedAt) : Infinity,
        v.matchedUntil ? Date.parse(v.matchedUntil) : Infinity,
        event.versions[i + 1] ? Date.parse(event.versions[i + 1].changedAt) : Infinity,
      );
      if (v.level === 'Info') return;
      const intervals = v.matches.length ? v.matches : [{ from: '0001-01-01T00:00:00.000Z', to: null }];
      for (const match of intervals) {
        const left = Math.max(start, a, Date.parse(match.from));
        const right = Math.min(end, b, match.to ? Date.parse(match.to) : Infinity);
        if (right <= left) continue;
        found.push({
          id: event.id + v.level,
          title: v.title,
          level: v.level,
          left: (left - a) / (b - a),
          width: (right - left) / (b - a),
        });
      }
    });
  }
  return found;
}

export function historyWarnings(
  events: HistoryEvent[],
  from: string,
  to: string,
  definition = 'swedish_calendar',
): RainBar['warnings'] {
  const unique = new Map(
    warningOverlaps(events, from, to, definition).map((w) => [w.id, { title: w.title, level: w.level }]),
  );
  return [...unique.values()];
}

export function historyWarningBands(
  events: HistoryEvent[],
  from: string,
  to: string,
  definition = 'swedish_calendar',
): RainBar['bands'] {
  return warningOverlaps(events, from, to, definition).map(({ left, width, level }) => ({
    left,
    width,
    level,
  }));
}

export function rainBars(history: PropertyHistory, monthly: boolean, mobile: boolean): RainBar[] {
  const rain = history.daily.series.find((s) => s.key === 'precipitation');
  if (monthly)
    return history.monthly.map((m) => {
      const dates = history.daily.dates.filter((d) => d.startsWith(m.month));
      return {
        from: dates[0],
        to: dates.at(-1)!,
        label: new Intl.DateTimeFormat('sv-SE', { month: 'short', year: '2-digit' }).format(
          new Date(m.month + '-15T12:00:00Z'),
        ),
        value: m.value,
        normal: m.normal,
        complete: m.complete,
        warnings: historyWarnings(history.events, dates[0], dates.at(-1)!, rain?.dayDefinition),
        bands: historyWarningBands(history.events, dates[0], dates.at(-1)!, rain?.dayDefinition),
      };
    });
  const step = mobile && history.daily.dates.length > HISTORY.mobileMaxBars ? 7 : 1;
  const bars: RainBar[] = [];
  for (let i = 0; i < history.daily.dates.length; i += step) {
    const dates = history.daily.dates.slice(i, i + step);
    const values = dates.map((_, j) => rain?.values[i + j] ?? null);
    const complete = values.every((v, j) => v !== null && rain?.coverage[i + j] === 1);
    bars.push({
      from: dates[0],
      to: dates.at(-1)!,
      label: formatShortDate(dates[0] + 'T12:00:00Z'),
      value: complete ? Math.round(values.reduce<number>((sum, v) => sum + v!, 0) * 10) / 10 : null,
      normal: null,
      complete,
      warnings: historyWarnings(history.events, dates[0], dates.at(-1)!, rain?.dayDefinition),
      bands: historyWarningBands(history.events, dates[0], dates.at(-1)!, rain?.dayDefinition),
    });
  }
  return bars;
}

export function groupHistoryEvents(events: HistoryEvent[], category: string | null) {
  const groups = new Map<string, HistoryEvent[]>();
  for (const event of events.filter((e) => !category || e.category === category)) {
    const v = event.versions.at(-1)!;
    const month = (v.validFrom ?? v.publishedAt ?? v.changedAt).slice(0, 7);
    groups.set(month, [...(groups.get(month) ?? []), event]);
  }
  return [...groups]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, events]) => ({
      month,
      label: new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric' }).format(
        new Date(month + '-15T12:00:00Z'),
      ),
      events: events.sort((a, b) => {
        const lastA = a.versions.at(-1)!;
        const lastB = b.versions.at(-1)!;
        return (lastB.validFrom ?? lastB.changedAt).localeCompare(lastA.validFrom ?? lastA.changedAt);
      }),
    }));
}

export function historyMatchLabel(method: string, distanceMeters: number | null): string {
  if (method === 'polygon_intersection') return 'inom varningsområdet';
  if (method === 'municipality') return 'i kommunen';
  if (method === 'county') return 'i länet';
  return `${formatDistance(distanceMeters)} från adresspunkten`;
}

export function historyValue(value: number | null | undefined, unit = ''): string {
  return value == null ? '—' : `${formatNumber(value, 1)}${unit ? ' ' + unit : ''}`;
}

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  let text = String(value);
  // Spreadsheet applications must treat source text as text, even when it starts with a formula.
  if (typeof value === 'string' && /^[\s]*[=+\-@\t\r]/.test(value)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

/** A single rectangular UTF-8 CSV with typed rows; null remains empty. */
export function historyCsv(history: PropertyHistory): string {
  const headers = [
    'typ',
    'datum',
    'parameter',
    'värde',
    'min',
    'max',
    'enhet',
    'täckning',
    'ursprung',
    'dygn',
    'station',
    'stationsid',
    'avstånd_m',
    'källa',
    'externt_id',
    'version',
    'nivå',
    'rubrik',
    'officiell_text',
    'område',
    'giltig_från',
    'giltig_till',
    'publicerad',
    'avslutad',
    'avslutstyp',
    'matchning',
    'matchning_till',
    'matchningsperioder',
    'källänk',
    'licens',
    'normal_mm',
    'normalperiod',
    'fullständig',
    'ändrad',
    'fastighet_id',
  ];
  type Cell = string | number | null | undefined;
  const rows: Cell[][] = [headers];
  const row = (values: Record<string, Cell>) =>
    rows.push(headers.map((h) => (h === 'fastighet_id' ? history.propertyId : values[h])));
  row({
    typ: 'period',
    datum: `${history.period.from}/${history.period.to}`,
    ursprung: history.origin,
    licens: history.attribution,
  });
  for (const series of history.daily.series) {
    const station = history.stations.find((s) => s.id === series.station)!;
    history.daily.dates.forEach((date, i) =>
      row({
        typ: 'dygn',
        datum: date,
        parameter: series.key,
        värde: series.values[i],
        min: series.min?.[i],
        max: series.max?.[i],
        enhet: series.unit,
        täckning: series.coverage[i],
        ursprung:
          history.origin === 'demo_fixture'
            ? 'demo_fixture'
            : series.originCodes[i] === 's'
              ? 'smhi_archive'
              : series.originCodes[i] === 'o'
                ? 'own_aggregate'
                : null,
        fullständig: series.values[i] !== null && series.coverage[i] === 1 ? 'ja' : 'nej',
        dygn: HISTORY_DEFINITIONS[series.dayDefinition],
        station: station.name,
        stationsid: station.stationId,
        avstånd_m: Math.round(station.distanceMeters),
        källa: station.sourceId,
        licens: history.origin === 'demo_fixture' ? history.attribution : 'SMHI, CC BY 4.0',
      }),
    );
  }
  const rain = history.stations.find((s) => s.parameter === 'precipitation');
  for (const month of history.monthly)
    row({
      typ: 'månad',
      datum: month.month,
      parameter: 'precipitation',
      värde: month.value,
      enhet: 'mm',
      täckning: month.coverage,
      station: rain?.name,
      stationsid: rain?.stationId,
      avstånd_m: rain ? Math.round(rain.distanceMeters) : null,
      källa: rain?.sourceId,
      normal_mm: month.normal,
      normalperiod: month.normal === null ? null : `${HISTORY.normalFromYear}–${HISTORY.normalToYear}`,
      fullständig: month.complete ? 'ja' : 'nej',
      licens: history.attribution,
    });
  if (history.hourly) {
    const hourly = history.hourly;
    hourly.values.forEach((value, index) =>
      row({
        typ: 'timme',
        datum: new Date(Date.parse(hourly.from) + (index + 1) * HISTORY.hourMs).toISOString(),
        parameter: 'precipitation_15min',
        värde: value,
        enhet: 'mm',
        täckning: hourly.coverage[index],
        fullständig: value !== null && hourly.coverage[index] === 1 ? 'ja' : 'nej',
        ursprung: history.origin === 'demo_fixture' ? 'demo_fixture' : 'own_aggregate',
        dygn: 'Svensk tid. Datum och tid anger timmens slut; summerat kvartsregn.',
        station: hourly.station.name,
        stationsid: hourly.station.stationId,
        avstånd_m: Math.round(hourly.station.distanceMeters),
        källa: hourly.station.sourceId,
        licens: history.attribution,
      }),
    );
  }
  for (const event of history.events)
    for (const v of event.versions)
      row({
        typ: 'händelse',
        källa: event.sourceLabel,
        externt_id: event.externalId,
        version: v.version,
        ändrad: v.changedAt,
        nivå: v.level,
        rubrik: v.title,
        officiell_text: v.text,
        område: v.area,
        giltig_från: v.validFrom,
        giltig_till: v.validTo,
        publicerad: v.publishedAt,
        avslutad: v.endedAt,
        avslutstyp: v.endType,
        matchning: v.matchMethod,
        matchning_till: v.matchedUntil,
        matchningsperioder: JSON.stringify(v.matches),
        avstånd_m: v.distanceMeters,
        källänk: v.sourceUrl,
        licens: event.attribution,
      });
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

/** Missing values split paths: the renderer never draws a line across unobserved days. */
export function contiguousHistory(
  values: Array<number | null>,
): Array<Array<{ index: number; value: number }>> {
  const segments: Array<Array<{ index: number; value: number }>> = [];
  let current: Array<{ index: number; value: number }> = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push({ index, value });
  });
  if (current.length) segments.push(current);
  return segments;
}
