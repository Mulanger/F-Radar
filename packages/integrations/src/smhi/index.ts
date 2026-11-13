import { z } from 'zod';
import type { EventCategory, Severity, WarningLevel } from '@fastighetsradar/domain';
import { httpJson, iso, num } from '../http';
import type { AdapterContext, AdapterResult, GeoJsonGeometry, NormalizedSourceEvent, StationObservation } from '../types';

/**
 * SMHI open data (verified live 2026-11-13).
 *
 *  - SNOW1gv1 point forecast:  {base}/category/snow1g/version/1/geotype/point/lon/{lon}/lat/{lat}/data.json
 *    81 steps (1 h, then 6 h, then 12 h). Each step = interval [intervalParametersStartTime, time].
 *    Precipitation amounts are interval TOTALS (kg/m² = mm). 9999 = missing value.
 *  - IBWW warnings: warning.json – array of warnings, each with warningAreas carrying GeoJSON polygons.
 *  - IBWW metadata/area.json – 21 county polygons (SWE_COUNTIES, id = official county code).
 *  - MetObs: {base}/version/1.0/parameter/{p}/station-set/all/period/latest-hour/data.json
 *
 * Licence: SMHI open data is CC BY 4.0 ("Källa: SMHI"); IBWW warnings must be shown unaltered.
 */
export const SMHI_ATTRIBUTION = 'Källa: SMHI (CC BY 4.0)';
export const SMHI_WARNING_ATTRIBUTION = 'Källa: SMHI – officiell varning, oförändrad text (CC BY 4.0)';
const MISSING = [9999];

/* ------------------------------------------------------------------ */
/* Point forecast                                                      */
/* ------------------------------------------------------------------ */

const ForecastSchema = z.object({
  createdTime: z.string(),
  referenceTime: z.string(),
  geometry: z.object({ type: z.literal('Point'), coordinates: z.array(z.number()).min(2) }),
  timeSeries: z
    .array(
      z.object({
        time: z.string(),
        intervalParametersStartTime: z.string().optional(),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1),
});

export interface ForecastStep {
  /** End of the interval / valid time (ISO UTC). */
  time: string;
  /** Start of the interval the precipitation totals refer to. */
  intervalStart: string | null;
  airTemperature: number | null;
  windSpeed: number | null;
  windGust: number | null;
  windDirection: number | null;
  relativeHumidity: number | null;
  /** mm over the interval (mean of the ensemble/deterministic mean). */
  precipitationMean: number | null;
  precipitationMin: number | null;
  precipitationMedian: number | null;
  frozenPartPercent: number | null;
  frozenProbability: number | null;
  precipitationType: number | null;
  precipitationMax: number | null;
  precipitationProbability: number | null;
  thunderProbability: number | null;
  symbolCode: number | null;
}

export interface PointForecast {
  referenceTime: string;
  createdTime: string;
  gridPoint: { lat: number; lon: number };
  steps: ForecastStep[];
}

export function smhiForecastUrl(base: string, lat: number, lon: number): string {
  // SMHI accepts max 6 decimals; the grid is ~2.5 km so 4 decimals is plenty.
  return `${base.replace(/\/+$/, '')}/category/snow1g/version/1/geotype/point/lon/${lon.toFixed(4)}/lat/${lat.toFixed(4)}/data.json`;
}

export function parseSmhiForecast(raw: unknown): PointForecast | null {
  const p = ForecastSchema.safeParse(raw);
  if (!p.success) return null;
  const d = p.data;
  const steps: ForecastStep[] = [];
  for (const s of d.timeSeries) {
    const time = iso(s.time);
    if (!time) continue;
    const v = (k: string) => num(s.data[k], MISSING);
    steps.push({
      time,
      intervalStart: iso(s.intervalParametersStartTime),
      airTemperature: v('air_temperature'),
      windSpeed: v('wind_speed'),
      windGust: v('wind_speed_of_gust'),
      windDirection: v('wind_from_direction'),
      relativeHumidity: v('relative_humidity'),
      precipitationMean: v('precipitation_amount_mean'),
      precipitationMin: v('precipitation_amount_min'),
      precipitationMedian: v('precipitation_amount_median'),
      frozenPartPercent: v('precipitation_frozen_part') !== null && v('precipitation_frozen_part')! >= 0 ? v('precipitation_frozen_part') : null,
      frozenProbability: v('probability_of_frozen_precipitation'),
      precipitationType: v('predominant_precipitation_type_at_surface'),
      precipitationMax: v('precipitation_amount_max'),
      precipitationProbability: v('probability_of_precipitation'),
      thunderProbability: v('thunderstorm_probability'),
      symbolCode: v('symbol_code'),
    });
  }
  steps.sort((a, b) => a.time.localeCompare(b.time));
  const [lon, lat] = d.geometry.coordinates as [number, number];
  return { referenceTime: iso(d.referenceTime)!, createdTime: iso(d.createdTime)!, gridPoint: { lat, lon }, steps };
}

export async function fetchSmhiPointForecast(lat: number, lon: number, ctx: AdapterContext): Promise<AdapterResult<PointForecast>> {
  const r = await httpJson(smhiForecastUrl(ctx.env.SMHI_FORECAST_BASE_URL, lat, lon), ctx, { label: 'smhi_forecast', timeoutMs: 15_000 });
  if (!r.ok) return r;
  const parsed = parseSmhiForecast(r.data);
  return parsed ? { ok: true, data: parsed, fetchedAt: r.fetchedAt } : { ok: false, error: 'invalid_payload', detail: 'smhi_forecast: schema mismatch' };
}

/** Duration (h) of a step's interval; defaults to 1 h when the start is missing. */
const stepHours = (s: ForecastStep) => (s.intervalStart ? (Date.parse(s.time) - Date.parse(s.intervalStart)) / 3_600_000 : 1);

/**
 * Sums interval precipitation totals over (from, from+hours]. Intervals partly inside the window
 * are pro-rated. Returns null when any overlapping interval is missing (never a silent 0).
 */
export function precipitationTotal(steps: ForecastStep[], from: Date, hours = 24): number | null {
  const a = from.getTime();
  const b = a + hours * 3_600_000;
  let total = 0;
  let cursor = a;
  for (const s of [...steps].sort((x, y) => x.time.localeCompare(y.time))) {
    const end = Date.parse(s.time);
    const start = end - stepHours(s) * 3_600_000;
    const overlap = Math.min(end, b) - Math.max(start, a);
    if (overlap <= 0) continue;
    if (s.precipitationMean == null || Math.max(start, a) !== cursor) return null;
    total += s.precipitationMean * (overlap / (end - start));
    cursor = Math.min(end, b);
  }
  if (cursor !== b) return null;
  return Math.round(total * 10) / 10;
}

/** The step whose interval contains `now` (or the first future step). */
export function currentStep(steps: ForecastStep[], now: Date): ForecastStep | null {
  const t = now.getTime();
  return steps.find((s) => Date.parse(s.time) >= t && Date.parse(s.time) - stepHours(s) * 3_600_000 <= t) ?? steps.find((s) => Date.parse(s.time) >= t) ?? null;
}

/* ------------------------------------------------------------------ */
/* IBWW warnings                                                       */
/* ------------------------------------------------------------------ */

const I18n = z.object({ sv: z.string().optional(), en: z.string().optional() }).passthrough();
const WarningAreaSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    approximateStart: z.string().nullish(),
    approximateEnd: z.string().nullish(),
    published: z.string().nullish(),
    created: z.string().nullish(),
    areaName: I18n.nullish(),
    warningLevel: z.object({ code: z.string() }).passthrough(),
    eventDescription: I18n.nullish(),
    affectedAreas: z.array(z.object({ id: z.union([z.number(), z.string()]), sv: z.string().optional() }).passthrough()).default([]),
    descriptions: z.array(z.object({ title: z.object({ code: z.string().optional(), sv: z.string().optional() }).passthrough().optional(), text: I18n.optional() }).passthrough()).default([]),
    area: z.object({ type: z.string(), geometry: z.object({ type: z.string(), coordinates: z.unknown() }).nullable() }).passthrough().nullish(),
  })
  .passthrough();
const WarningSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    event: z.object({ sv: z.string().optional(), en: z.string().optional(), code: z.string() }).passthrough(),
    descriptions: z.array(z.unknown()).default([]),
    warningAreas: z.array(z.unknown()).default([]),
  })
  .passthrough();

const LEVELS: Record<string, { level: WarningLevel; severity: Severity }> = {
  RED: { level: 'Red', severity: 'critical' },
  ORANGE: { level: 'Orange', severity: 'warning' },
  YELLOW: { level: 'Yellow', severity: 'monitor' },
  MESSAGE: { level: 'Info', severity: 'info' },
};

export function smhiWarningCategory(code: string): EventCategory {
  return /WATER|FLOW|FLOOD|SEA_LEVEL|SHORTAGE/i.test(code) ? 'Water' : /FIRE/i.test(code) ? 'Crisis' : 'Weather';
}

const GEOM_TYPES = new Set(['Polygon', 'MultiPolygon']);

/** Maps IBWW warning.json → one normalised event per warning area. Invalid areas are skipped. */
export function parseSmhiWarnings(raw: unknown): { events: NormalizedSourceEvent[]; skipped: number } {
  const list = z.array(z.unknown()).safeParse(raw);
  if (!list.success) return { events: [], skipped: -1 };
  const events: NormalizedSourceEvent[] = [];
  let skipped = 0;
  for (const w of list.data) {
    const wp = WarningSchema.safeParse(w);
    if (!wp.success) {
      skipped++;
      continue;
    }
    for (const a of wp.data.warningAreas) {
      const ap = WarningAreaSchema.safeParse(a);
      if (!ap.success) {
        skipped++;
        continue;
      }
      const area = ap.data;
      const lv = LEVELS[area.warningLevel.code.toUpperCase()];
      const geom = area.area?.geometry;
      if (!lv || !geom || !GEOM_TYPES.has(geom.type)) {
        skipped++;
        continue;
      }
      const eventSv = wp.data.event.sv ?? wp.data.event.code;
      const text = area.descriptions.map((d) => d.text?.sv).filter(Boolean).join('\n\n') || area.eventDescription?.sv || null;
      events.push({
        sourceId: 'smhi_warnings',
        externalId: `${wp.data.id}:${area.id}`,
        dataClass: 'OFFICIAL_WARNING',
        category: smhiWarningCategory(wp.data.event.code),
        level: lv.level,
        severity: lv.severity,
        eventType: eventSv,
        headline: area.eventDescription?.sv ? `${area.eventDescription.sv}` : eventSv,
        description: text,
        areaLabel: area.areaName?.sv ?? (area.affectedAreas.map((x) => x.sv).filter(Boolean).join(', ') || null),
        countyNames: [],
        geometry: { type: geom.type as GeoJsonGeometry['type'], coordinates: geom.coordinates },
        publishedAt: iso(area.published),
        sourceUpdatedAt: iso(area.published ?? area.created),
        validFrom: iso(area.approximateStart),
        validTo: iso(area.approximateEnd),
        status: 'active',
        sourceUrl: 'https://www.smhi.se/vader/varningar-och-brandrisk/varningar-och-meddelanden/varningar',
        attribution: SMHI_WARNING_ATTRIBUTION,
        extra: { eventCode: wp.data.event.code, warningLevel: area.warningLevel.code, warningId: String(wp.data.id), areaId: String(area.id) },
      });
    }
  }
  return { events, skipped };
}

export async function fetchSmhiWarnings(ctx: AdapterContext): Promise<AdapterResult<{ events: NormalizedSourceEvent[]; skipped: number }>> {
  const r = await httpJson(ctx.env.SMHI_WARNINGS_URL, ctx, { label: 'smhi_warnings', timeoutMs: 20_000 });
  if (!r.ok) return r;
  const parsed = parseSmhiWarnings(r.data);
  if (parsed.skipped < 0) return { ok: false, error: 'invalid_payload', detail: 'smhi_warnings: expected an array' };
  return { ok: true, data: parsed, fetchedAt: r.fetchedAt };
}

/* ------------------------------------------------------------------ */
/* County polygons (IBWW metadata/area.json)                           */
/* ------------------------------------------------------------------ */

export interface CountyArea {
  code: string;
  name: string;
  sourceRef: string;
  geometry: GeoJsonGeometry;
}

export function parseSmhiCountyAreas(raw: unknown): CountyArea[] {
  const list = z
    .array(
      z
        .object({
          id: z.union([z.number(), z.string()]),
          sv: z.string(),
          code: z.string(),
          area: z.object({ geometry: z.object({ type: z.string(), coordinates: z.unknown() }) }).passthrough(),
        })
        .passthrough(),
    )
    .safeParse(raw);
  if (!list.success) return [];
  return list.data
    .filter((a) => a.code === 'SWE_COUNTIES' && GEOM_TYPES.has(a.area.geometry.type) && /^\d{1,2}$/.test(String(a.id)))
    .map((a) => ({
      code: String(a.id).padStart(2, '0'),
      name: a.sv,
      sourceRef: String(a.id),
      geometry: { type: a.area.geometry.type as GeoJsonGeometry['type'], coordinates: a.area.geometry.coordinates },
    }));
}

export async function fetchSmhiCountyAreas(ctx: AdapterContext): Promise<AdapterResult<CountyArea[]>> {
  const url = ctx.env.SMHI_WARNINGS_URL.replace(/warning\.json$/, 'metadata/area.json');
  const r = await httpJson(url, ctx, { label: 'smhi_areas', timeoutMs: 30_000 });
  if (!r.ok) return r;
  const areas = parseSmhiCountyAreas(r.data);
  return areas.length >= 20 ? { ok: true, data: areas, fetchedAt: r.fetchedAt } : { ok: false, error: 'invalid_payload', detail: `smhi_areas: ${areas.length} counties` };
}

/* ------------------------------------------------------------------ */
/* MetObs latest-hour (all stations)                                   */
/* ------------------------------------------------------------------ */

/** MetObs parameters collected (id → key, Swedish label, unit). */
export const METOBS_PARAMETERS = [
  { id: 1, key: 'air_temperature', label: 'Lufttemperatur', unit: '°C' },
  { id: 4, key: 'wind_speed', label: 'Vindhastighet', unit: 'm/s' },
  { id: 21, key: 'wind_gust', label: 'Byvind', unit: 'm/s' },
  { id: 3, key: 'wind_direction', label: 'Vindriktning', unit: '°' },
  { id: 6, key: 'relative_humidity', label: 'Relativ luftfuktighet', unit: '%' },
  { id: 7, key: 'precipitation_1h', label: 'Nederbörd senaste timmen', unit: 'mm' },
  { id: 14, key: 'precipitation_15min', label: 'Nederbörd senaste 15 min', unit: 'mm' },
] as const;

const MetObsSchema = z
  .object({
    station: z
      .array(
        z
          .object({
            key: z.union([z.string(), z.number()]),
            name: z.string(),
            latitude: z.number(),
            longitude: z.number(),
            value: z.array(z.object({ date: z.number(), value: z.union([z.string(), z.number()]).nullable(), quality: z.string().optional() }).passthrough()).nullable().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export function parseMetObs(raw: unknown, parameter: (typeof METOBS_PARAMETERS)[number]): StationObservation[] | null {
  const p = MetObsSchema.safeParse(raw);
  if (!p.success) return null;
  const out: StationObservation[] = [];
  for (const s of p.data.station) {
    for (const last of s.value ?? []) {
    const value = num(last.value, [9999]);
    if (value === null) continue;
    out.push({
      sourceId: 'smhi_observations',
      stationId: String(s.key),
      parameter: parameter.key,
      name: s.name,
      lat: s.latitude,
      lon: s.longitude,
      value,
      unit: parameter.unit,
      observedAt: iso(last.date),
      quality: last.quality ?? null,
      extra: {},
    });
    }
  }
  return out.sort((a,b)=>(a.observedAt??'').localeCompare(b.observedAt??''));
}

export async function fetchMetObsLatest(parameter: (typeof METOBS_PARAMETERS)[number], ctx: AdapterContext): Promise<AdapterResult<StationObservation[]>> {
  const url = `${ctx.env.SMHI_OBSERVATIONS_BASE_URL.replace(/\/+$/, '')}/version/1.0/parameter/${parameter.id}/station-set/all/period/latest-hour/data.json`;
  const r = await httpJson(url, ctx, { label: `smhi_metobs_${parameter.id}`, timeoutMs: 30_000 });
  if (!r.ok) return r;
  const parsed = parseMetObs(r.data, parameter);
  return parsed ? { ok: true, data: parsed, fetchedAt: r.fetchedAt } : { ok: false, error: 'invalid_payload', detail: `smhi_metobs_${parameter.id}: schema mismatch` };
}
