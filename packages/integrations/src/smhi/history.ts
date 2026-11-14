import { z } from 'zod';
import {
  HISTORY,
  aggregateHistoryDay,
  aggregateTemperatureCrossings,
  precipitationNormals,
  shiftMonths,
  swedishDateKey,
  type DailyValue,
} from '@fastighetsradar/domain';
import { httpJson, httpRequest, num } from '../http';
import type { AdapterContext, AdapterResult } from '../types';

export interface HistoryParameter {
  sourceId: 'smhi_observations' | 'smhi_oceanography' | 'smhi_hydrology';
  id: number;
  key: string;
  unit: string;
  csvName: string;
  csvUnit: string;
  definition: string;
  distanceM: number;
  hourly?: boolean;
}

export const HISTORY_PARAMETERS: HistoryParameter[] = [
  {
    sourceId: 'smhi_observations',
    id: 1,
    key: 'temperature_crossings',
    unit: 'passager',
    csvName: 'Lufttemperatur',
    csvUnit: 'celsius',
    definition: 'swedish_calendar',
    distanceM: HISTORY.weatherDistanceM,
    hourly: true,
  },
  {
    sourceId: 'smhi_observations',
    id: 5,
    key: 'precipitation',
    unit: 'mm',
    csvName: 'Nederbördsmängd',
    csvUnit: 'millimeter',
    definition: 'smhi_06_utc',
    distanceM: HISTORY.rainDistanceM,
  },
  {
    sourceId: 'smhi_observations',
    id: 19,
    key: 'temperature_min',
    unit: '°C',
    csvName: 'Lufttemperatur',
    csvUnit: 'celsius',
    definition: 'smhi_18_utc',
    distanceM: HISTORY.weatherDistanceM,
  },
  {
    sourceId: 'smhi_observations',
    id: 20,
    key: 'temperature_max',
    unit: '°C',
    csvName: 'Lufttemperatur',
    csvUnit: 'celsius',
    definition: 'smhi_18_utc',
    distanceM: HISTORY.weatherDistanceM,
  },
  {
    sourceId: 'smhi_observations',
    id: 2,
    key: 'temperature_mean',
    unit: '°C',
    csvName: 'Lufttemperatur',
    csvUnit: 'celsius',
    definition: 'smhi_00_utc',
    distanceM: HISTORY.weatherDistanceM,
  },
  {
    sourceId: 'smhi_observations',
    id: 21,
    key: 'wind_gust',
    unit: 'm/s',
    csvName: 'Byvind',
    csvUnit: 'meter per sekund',
    definition: 'swedish_calendar',
    distanceM: HISTORY.weatherDistanceM,
    hourly: true,
  },
  {
    sourceId: 'smhi_oceanography',
    id: 12,
    key: 'sea_level',
    unit: 'cm RW',
    csvName: 'Havsvattenstånd, RW timvärde',
    csvUnit: 'cm',
    definition: 'swedish_calendar',
    distanceM: HISTORY.seaDistanceM,
    hourly: true,
  },
  {
    sourceId: 'smhi_hydrology',
    id: 1,
    key: 'water_flow',
    unit: 'm³/s',
    csvName: 'Vattenföring (Dygn)',
    csvUnit: 'm³/s',
    definition: 'smhi_hydro_cest',
    distanceM: HISTORY.flowDistanceM,
  },
];

export interface HistoryCatalogStation {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  from: string | null;
  to: string | null;
}

const CatalogSchema = z.object({
  key: z.string(),
  station: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      latitude: z.number(),
      longitude: z.number(),
      active: z.boolean(),
      from: z.number().optional(),
      to: z.number().optional(),
    }),
  ),
});

function historyBase(parameter: Pick<HistoryParameter, 'sourceId'>, ctx: AdapterContext): string {
  const bases = {
    smhi_observations: ctx.env.SMHI_OBSERVATIONS_BASE_URL,
    smhi_oceanography: ctx.env.SMHI_OCEANOGRAPHY_BASE_URL,
    smhi_hydrology: ctx.env.SMHI_HYDROLOGY_BASE_URL,
  };
  return bases[parameter.sourceId].replace(/\/+$/, '') + '/version/latest';
}

export async function fetchHistoryCatalog(
  parameter: HistoryParameter,
  ctx: AdapterContext,
): Promise<AdapterResult<HistoryCatalogStation[]>> {
  const r = await httpJson(`${historyBase(parameter, ctx)}/parameter/${parameter.id}.json`, ctx, {
    label: 'history_catalog',
    attempts: 1,
  });
  if (!r.ok) return r;
  const parsed = CatalogSchema.safeParse(r.data);
  if (!parsed.success || parsed.data.key !== String(parameter.id)) {
    return { ok: false, error: 'invalid_payload', detail: 'history_catalog: unknown parameter resource' };
  }
  const data = parsed.data.station
    .filter((s) => s.active)
    .map((s) => ({
      stationId: String(s.id),
      name: s.name,
      lat: s.latitude,
      lon: s.longitude,
      from: s.from == null ? null : new Date(s.from).toISOString(),
      to: s.to == null ? null : new Date(s.to).toISOString(),
    }));
  return { ok: true, data, fetchedAt: r.fetchedAt };
}

/** Shared with the hydrology reference reader: archives are streamed, never buffered in full. */
export async function readSmhiCsv(response: Response, line: (line: string) => void): Promise<void> {
  if (!response.body) throw new Error('Empty archive');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const text of lines) line(text.replace(/\r$/, ''));
    }
    line(pending + decoder.decode());
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Parser accepts only the documented CSV headers and units, including explicit missing rows. */
export function historyCsvAccumulator(
  parameter: HistoryParameter,
  from: string,
  to: string,
  monthly = false,
) {
  let product = false;
  let header: string[] | null = null;
  const daily = new Map<string, DailyValue>();
  const hours = new Map<string, Array<{ at: string; value: number }>>();
  const months: Array<{ month: string; value: number | null }> = [];

  function line(text: string) {
    const columns = text.replace(/^\uFEFF/, '').split(';');
    if (columns[0] === parameter.csvName && columns.includes(parameter.csvUnit)) product = true;
    if (
      /^(Från Datum Tid \(UTC\)|Datum;Tid \(UTC\)|Datum Tid \(UTC\)|Datum \(svensk sommartid\));/.test(text)
    ) {
      header = columns;
      return;
    }
    if (!header || !/^\d{4}-\d{2}-\d{2}/.test(text)) return;
    const valueIndex = header.indexOf(parameter.csvName);
    const qualityIndex = header.indexOf('Kvalitet');
    if (valueIndex < 0 || qualityIndex < 0) return;
    const quality = columns[qualityIndex];
    const parsed = num(columns[valueIndex]?.replace(',', '.'), [9999, -999]);
    const value =
      ['G', 'Y', ...(parameter.sourceId === 'smhi_oceanography' ? ['O'] : [])].includes(quality) &&
      (parameter.csvName === 'Lufttemperatur' ||
        parameter.key === 'sea_level' ||
        (parsed !== null && parsed >= 0))
        ? parsed
        : null;

    if (monthly) {
      const month = columns[header.indexOf('Representativ månad')];
      if (/^\d{4}-\d{2}$/.test(month ?? '')) months.push({ month, value });
      return;
    }
    if (parameter.hourly) {
      const stamp = header[0] === 'Datum' ? `${columns[0]} ${columns[1]}` : columns[0];
      const at = stamp.replace(' ', 'T') + 'Z';
      if (!Number.isFinite(Date.parse(at))) return;
      const date = swedishDateKey(new Date(Date.parse(at) - 1));
      const dates =
        parameter.key === 'temperature_crossings' ? new Set([date, swedishDateKey(at)]) : new Set([date]);
      if (value === null) return;
      for (const day of dates) {
        if (day < from || day > to) continue;
        const points = hours.get(day) ?? [];
        points.push({ at, value });
        hours.set(day, points);
      }
      return;
    }
    const representative = header.indexOf('Representativt dygn');
    const date = representative >= 0 ? columns[representative] : columns[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to) return;
    daily.set(date, { date, value, coverage: value === null ? 0 : 1, origin: 'smhi_archive' });
  }

  function finish() {
    if (!product || !header) return null;
    for (const [date, points] of hours) {
      const row =
        parameter.key === 'temperature_crossings'
          ? aggregateTemperatureCrossings(points, date)
          : aggregateHistoryDay(points, date, 60, parameter.key === 'wind_gust' ? 'max' : 'mean');
      daily.set(date, { ...row, origin: 'smhi_archive' });
    }
    return {
      days: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
      normals: monthly ? precipitationNormals(months) : [],
    };
  }
  return { line, finish };
}

/** Accepts SMHI's CSV in the media type it actually uses (text/plain) as well as text/csv. */
export const HISTORY_CSV_ACCEPT = 'text/csv, text/plain;q=0.9, */*;q=0.5';

export async function fetchHistorySeries(
  parameter: HistoryParameter,
  stationId: string,
  period: 'corrected-archive' | 'latest-months' | 'latest-day',
  ctx: AdapterContext,
  normal = false,
): Promise<AdapterResult<NonNullable<ReturnType<ReturnType<typeof historyCsvAccumulator>['finish']>>>> {
  if (!/^\d+$/.test(stationId))
    return { ok: false, error: 'invalid_payload', detail: 'history: invalid station id' };
  const id = normal ? 23 : parameter.id;
  const url = `${historyBase(parameter, ctx)}/parameter/${id}/station/${stationId}/period/${period}/data.csv`;
  const r = await httpRequest(url, ctx, {
    label: 'history_archive',
    attempts: 1,
    timeoutMs: 180_000,
    // SMHI serves these CSV files as text/plain; a strict `text/csv` makes latest-months and the
    // water APIs' latest-day answer 406 (verified 2026-11-14), which silently left recent months empty.
    headers: { Accept: HISTORY_CSV_ACCEPT },
  });
  // Some daily stations do not publish parameter 23. Record that absence once a year as well.
  if (normal && !r.ok && r.error === 'upstream_error' && r.detail?.endsWith('HTTP 404')) {
    return { ok: true, data: { days: [], normals: [] }, fetchedAt: ctx.now().toISOString() };
  }
  if (!r.ok) return r;
  const to = swedishDateKey(ctx.now());
  const accumulator = historyCsvAccumulator(
    parameter,
    shiftMonths(to, -HISTORY.dailyRetentionYears * 12),
    to,
    normal,
  );
  try {
    await readSmhiCsv(r.data, accumulator.line);
    const data = accumulator.finish();
    return data
      ? { ok: true, data, fetchedAt: r.fetchedAt }
      : { ok: false, error: 'invalid_payload', detail: 'history: unknown CSV product or header' };
  } catch {
    return { ok: false, error: 'upstream_error', detail: 'history: archive read failed' };
  }
}
