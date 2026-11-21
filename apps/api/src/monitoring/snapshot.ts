import type {
  DataSourceStatus,
  EnvironmentalMetric,
  FeedItem,
  Freshness,
  GeographicEvent,
  MetricKey,
  NearbyObservation,
  OfficialWarning,
  PropertyMonitoringContext,
  PropertyRecord,
  PropertySnapshot,
  PropertyStatus,
  Provenance,
  SourceId,
  UpcomingCondition,
  WarningLevel,
  WeatherForecast,
} from '@fastighetsradar/domain';
import { assessPropertyRisk, feedNeedsAck, nightWorkLabel, formatWeekdayClock, swedishDayWindows, forecastInformation, WEATHER_WATER, summarizeNowcast, measurementTrend, type TimedReading, classifyFlow, measuredPrecipitation, outageHeadline } from '@fastighetsradar/domain';
import type { OrgContextRow, OrgEventRow, OrgForecastRow, OrgMonitoringData, OrgObservationRow } from '@fastighetsradar/db';
import {
  AIR_PHENOMENA,
  AIR_QUALITY_ATTRIBUTION,
  METOBS_PARAMETERS,
  SMHI_ATTRIBUTION,
  currentStep,
  precipitationTotal,
  windChill,
  stationAirIndex,
  GROUNDWATER_OBS_MAX_AGE_DAYS,
  type ForecastStep,
} from '@fastighetsradar/integrations';
import { propertyToSnapshot } from '../portfolio';
import { groupDuplicates, mergedTrafficTitle, replacedTraffic, SEVERITY_RANK, type DuplicateKey } from './traffic-duplicates';
import { freshnessOf, FRESHNESS_WINDOW_S } from './status';

/**
 * Builds the dashboard contract from STORED monitoring data only (no external calls).
 *
 * Rules (IMPLEMENTATION.md §1, §20 + Phase 3 brief):
 *  - Data classes are kept apart: forecast metrics are labelled forecast, station values are
 *    observations with distance + time, warnings are official, events are public information.
 *  - Property status = highest ACTIVE OFFICIAL warning matched to the property's point
 *    (documented `statusMethod`); a VMA naming other municipalities in the county gives Monitor.
 *  - `riskIndex` follows the documented, conservative method in docs/decisions/0003-riskindex.md.
 *  - Missing/old data is never shown as normal: unavailable values are omitted (UI shows "—").
 */

export const OBS_MAX_DISTANCE_M = WEATHER_WATER.observationDistanceM;
export const AIR_MAX_DISTANCE_M = WEATHER_WATER.airDistanceM;
const FORECAST_USABLE_S = 6 * 3_600;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const n = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

export const SOURCE_LABEL: Partial<Record<SourceId, string>> = {
  smhi_warnings: 'SMHI',
  krisinformation: 'Krisinformation.se',
  trafikverket: 'Trafikverket',
  smhi_forecast: 'SMHI',
  smhi_observations: 'SMHI',
  air_quality: 'SMHI / Naturvårdsverket',
  sl_deviations: 'SL via Trafiklab',
  utility_outages: 'Nätbolag',
};
const AUTHORITY: Partial<Record<SourceId, string>> = {
  smhi_forecast: 'SMHI',
  smhi_observations: 'SMHI',
  air_quality: 'SMHI / Naturvårdsverket',
  sgu_groundwater: 'SGU',
  mcf_flood: 'MCF',
  scb: 'SCB',
};

function provenance(sourceId: SourceId, dataClass: Provenance['dataClass'], sourceTimestamp: string | null, fetchedAt: Date, attribution: string, sourceUrl: string | null, now: Date, freshness?: Freshness): Provenance {
  return {
    sourceId,
    dataClass,
    authority: AUTHORITY[sourceId] ?? SOURCE_LABEL[sourceId] ?? sourceId,
    attribution,
    sourceUrl,
    sourceTimestamp,
    fetchedAt: fetchedAt.toISOString(),
    freshness: freshness ?? freshnessOf(fetchedAt, FRESHNESS_WINDOW_S[sourceId], now),
  };
}

/* ------------------------------------------------------------------ */
/* Forecast                                                            */
/* ------------------------------------------------------------------ */

export function forecastSteps(row: OrgForecastRow | undefined): ForecastStep[] {
  const s = row?.series as { v?: number; steps?: ForecastStep[] } | undefined;
  return Array.isArray(s?.steps) ? s.steps.map(x => ({ ...x, precipitationMin: x.precipitationMin ?? null, precipitationMedian: x.precipitationMedian ?? null, frozenPartPercent: x.frozenPartPercent ?? null, frozenProbability: x.frozenProbability ?? null, precipitationType: x.precipitationType ?? null })) : [];
}

function forecastMetrics(propertyId: string, row: OrgForecastRow | undefined, now: Date): EnvironmentalMetric[] {
  if (!row) return [];
  const age = (now.getTime() - row.fetched_at.getTime()) / 1000;
  if (age > FORECAST_USABLE_S) return [];
  const steps = forecastSteps(row);
  const cur = currentStep(steps, now);
  if (!cur) return [];
  const freshness = freshnessOf(row.fetched_at, FRESHNESS_WINDOW_S.smhi_forecast, now);
  const geo = { match: 'point_grid' as const, distanceMeters: n(row.distance_m), note: 'SMHI:s modellpunkt närmast fastigheten (prognos, ej mätning)' };
  const m = (metricKey: MetricKey, value: number | null, unit: string, note?: string): EnvironmentalMetric => ({
    propertyId,
    metricKey,
    value,
    unit,
    sourceId: 'smhi_forecast',
    kind: 'forecast',
    sourceTimestamp: note === 'aggregate' ? iso(row.reference_time) : cur.time,
    fetchedAt: row.fetched_at.toISOString(),
    freshness,
    availability: value === null ? 'unknown' : freshness === 'fresh' ? 'ok' : 'stale',
    geo,
    origin: 'live',
    qualityFlags: note === 'aggregate' ? ['aggregate_next_24h'] : ['forecast_current_hour'],
  });
  return [
    m('weather.air_temperature', cur.airTemperature, '°C'),
    { ...m('weather.apparent_temperature', windChill(cur.airTemperature, cur.windSpeed), '°C'),
      qualityFlags: ['derived', 'smhi_wind_chill_v1'], geo: { ...geo, note: `${geo.note}. Härledd kyleffekt enligt SMHI, ADR 0006.` } },
    m('weather.wind_speed', cur.windSpeed, 'm/s'),
    m('weather.wind_gust', cur.windGust, 'm/s'),
    m('weather.wind_direction', cur.windDirection, '°'),
    m('weather.relative_humidity', cur.relativeHumidity, '%'),
    m('weather.precipitation_probability', cur.precipitationProbability, '%'),
    m('weather.thunder_probability', cur.thunderProbability, '%'),
    m('weather.precipitation_24h', precipitationTotal(steps, now, 24), 'mm', 'aggregate'),
  ].filter((x) => x.value !== null);
}

export function buildForecast(propertyId: string, row: OrgForecastRow | undefined, now: Date): WeatherForecast | null {
  if (!row) return null;
  const steps = forecastSteps(row);
  const from = now.getTime() - 3_600_000;
  const to = now.getTime() + 24 * 3_600_000;
  const window = steps.filter((s) => Date.parse(s.time) > from && Date.parse(s.time) <= to);
  if (!window.length) return null;
  const age = (now.getTime() - row.fetched_at.getTime()) / 1000;
  const freshness = freshnessOf(row.fetched_at, FRESHNESS_WINDOW_S.smhi_forecast, now);
  const pts = (pick: (s: ForecastStep) => number | null) => window.map((s) => ({ validAt: s.time, value: pick(s) }));
  return {
    propertyId,
    sourceId: 'smhi_forecast',
    issuedAt: iso(row.reference_time),
    fetchedAt: row.fetched_at.toISOString(),
    freshness,
    availability: age > FORECAST_USABLE_S ? 'stale' : 'ok',
    geo: { match: 'point_grid', distanceMeters: n(row.distance_m), note: 'SMHI SNOW1gv1 modellpunkt' },
    origin: 'live',
    // Calendar days in Swedish time ("Idag", "Imorgon", …); the first window is the rest of today.
    days: swedishDayWindows(now, 5).map(({ from: start, to: end }) => {
      const hours = (end.getTime() - start.getTime()) / 3_600_000;
      const day = steps.filter(s => Date.parse(s.time) > start.getTime() && Date.parse(s.intervalStart ?? s.time) < end.getTime());
      const total = (key: 'precipitationMean' | 'precipitationMin' | 'precipitationMax') => precipitationTotal(steps.map(s => ({ ...s, precipitationMean: s[key] })), start, hours);
      const complete = total('precipitationMean') !== null;
      const samples = day.filter(s => Date.parse(s.time) <= end.getTime());
      const extreme = (key: 'airTemperature' | 'windGust', max: boolean) => complete && samples.length && samples.every(s => s[key] != null) ? (max ? Math.max : Math.min)(...samples.map(s => s[key]!)) : null;
      const mean = total('precipitationMean');
      const frozen = precipitationTotal(steps.map(s => ({ ...s, precipitationMean: s.precipitationMean === 0 ? 0 : s.precipitationMean != null && s.frozenPartPercent != null ? s.precipitationMean * s.frozenPartPercent / 100 : null })), start, hours);
      return { from: start.toISOString(), to: end.toISOString(), temperatureMin: extreme('airTemperature', false), temperatureMax: extreme('airTemperature', true), precipitationMean: mean, precipitationMin: total('precipitationMin'), precipitationMax: total('precipitationMax'), windGustMax: extreme('windGust', true), snowPercent: mean != null && mean > 0 && frozen != null ? Math.round(frozen / mean * 100) : null };
    }),
    series: [
      { metricKey: 'weather.air_temperature', unit: '°C', points: pts((s) => s.airTemperature) },
      { metricKey: 'weather.precipitation_1h', unit: 'mm', intervalNote: 'mm per prognosintervall (1 h), medelvärde', points: window.map(s => ({ validAt: s.time, value: s.precipitationMean, min: s.precipitationMin, max: s.precipitationMax })) },
      { metricKey: 'weather.wind_speed', unit: 'm/s', points: pts((s) => s.windSpeed) },
      { metricKey: 'weather.relative_humidity', unit: '%', points: pts((s) => s.relativeHumidity) },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Observations                                                        */
/* ------------------------------------------------------------------ */

const OBS_LABEL: Record<string, string> = Object.fromEntries([...METOBS_PARAMETERS.map((p) => [p.key, p.label]), ...AIR_PHENOMENA.map((p) => [p.key, p.label])]);

function toNearby(o: OrgObservationRow, now: Date): NearbyObservation {
  const sourceId = o.source_id as SourceId;
  const air = sourceId === 'air_quality';
  return {
    parameter: o.parameter,
    label: OBS_LABEL[o.parameter] ?? o.parameter,
    value: o.value,
    unit: o.unit,
    stationId: o.station_id,
    stationName: o.name,
    distanceMeters: Math.round(o.distance_m),
    observedAt: iso(o.observed_at),
    quality: o.quality,
    qualityFlags: air ? ['preliminary', `resolution:${o.extra.resolution ?? 'unknown'}`] : o.quality === 'Y' ? ['suspect_or_aggregated'] : [],
    provenance: provenance(sourceId, 'OBSERVATION', iso(o.observed_at), o.fetched_at, air ? AIR_QUALITY_ATTRIBUTION : SMHI_ATTRIBUTION, null, now),
  };
}

function airMetrics(propertyId: string, rows: OrgObservationRow[], now: Date): EnvironmentalMetric[] {
  const keys: Record<string, MetricKey> = { pm25: 'air_quality.pm25', no2: 'air_quality.no2', pm10: 'air_quality.pm10', o3: 'air_quality.o3' };
  return rows
    .filter((o) => o.source_id === 'air_quality' && keys[o.parameter] && o.distance_m <= AIR_MAX_DISTANCE_M)
    .map((o) => ({
      propertyId,
      metricKey: keys[o.parameter]!,
      value: o.value,
      unit: o.unit,
      sourceId: 'air_quality' as const,
      kind: 'observation' as const,
      sourceTimestamp: iso(o.observed_at),
      fetchedAt: o.fetched_at.toISOString(),
      freshness: freshnessOf(o.observed_at, 3 * 3_600, now),
      availability: 'ok' as const,
      geo: { match: 'nearest_station' as const, distanceMeters: Math.round(o.distance_m), note: `Mätstation: ${o.name}` },
      origin: 'live' as const,
      qualityFlags: ['preliminary'],
    }));
}

/* ------------------------------------------------------------------ */
/* Warnings & events                                                   */
/* ------------------------------------------------------------------ */

const LEVEL_STATUS: Record<WarningLevel, PropertyStatus | null> = { Red: 'critical', VMA: 'critical', Orange: 'warning', Yellow: 'monitor', Info: null };
const STATUS_RANK: Record<PropertyStatus, number> = { critical: 4, warning: 3, monitor: 2, normal: 1, unknown: 0 };
const LEVEL_SV: Record<WarningLevel, string> = { Red: 'Röd varning', Orange: 'Orange varning', Yellow: 'Gul varning', VMA: 'VMA', Info: 'Meddelande' };

function toWarning(e: OrgEventRow): OfficialWarning {
  const level = (e.level ?? 'Info') as WarningLevel;
  return {
    id: e.id,
    sourceId: e.source_id as SourceId,
    sourceLabel: e.source_id === 'krisinformation' ? 'Krisinformation.se (VMA)' : 'SMHI',
    externalId: e.external_id,
    level,
    type: e.event_type,
    summary: e.description ?? e.headline,
    region: e.area_label ?? '',
    validFrom: iso(e.valid_from),
    validTo: iso(e.valid_to),
    issuedAt: iso(e.published_at),
    sourceUrl: e.source_url,
    geo: e.match_method === 'polygon_intersection'
      ? { match: 'polygon_intersection', distanceMeters: 0, note: 'Fastighetens punkt ligger inom varningsområdet' }
      : e.match_method === 'municipality'
        ? { match: 'municipality', note: 'Meddelandet gäller fastighetens kommun eller hela länet' }
        : { match: 'county', note: 'Meddelandet gäller andra kommuner i samma län' },
    origin: 'live',
  };
}

function eventKey(e: OrgEventRow): DuplicateKey {
  const situation = e.extra?.situationId;
  return {
    sourceId: e.source_id,
    situationId: typeof situation === 'string' ? situation : null,
    eventType: e.event_type,
    headline: e.headline,
    validFrom: e.valid_from ? e.valid_from.getTime() : null,
    validTo: e.valid_to ? e.valid_to.getTime() : null,
    point: e.point_lat !== null && e.point_lon !== null ? { lat: e.point_lat, lon: e.point_lon } : null,
  };
}

/**
 * Public events with Trafikverket's duplicates folded into one (see traffic-duplicates.ts): the most
 * serious, nearest message stands for the group, titled with all its kinds, valid over their union.
 */
function mergeTrafficDuplicates(rows: OrgEventRow[]): GeographicEvent[] {
  return groupDuplicates(rows, eventKey).map((g) => {
    if (g.length === 1) return toEvent(g[0]!);
    const dist = (e: OrgEventRow) => n(e.distance_m) ?? Infinity;
    const primary = [...g].sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || dist(a) - dist(b))[0]!;
    const ev = toEvent(primary);
    const froms = g.map((e) => e.valid_from?.getTime() ?? null);
    const tos = g.map((e) => e.valid_to?.getTime() ?? null);
    const nearest = Math.min(...g.map(dist));
    return {
      ...ev,
      title: mergedTrafficTitle(g.map((e) => ({ eventType: e.event_type, headline: e.headline }))),
      memberIds: g.map((e) => e.id),
      validFrom: froms.includes(null) ? ev.validFrom : new Date(Math.min(...(froms as number[]))).toISOString(),
      validTo: tos.includes(null) ? null : new Date(Math.max(...(tos as number[]))).toISOString(),
      geo: ev.geo.match === 'within_radius' && Number.isFinite(nearest) ? { ...ev.geo, distanceMeters: nearest } : ev.geo,
    };
  });
}

function toEvent(e: OrgEventRow): GeographicEvent {
  const traffic = e.source_id === 'trafikverket' || e.source_id === 'sl_deviations';
  return {
    id: e.id,
    sourceId: e.source_id as SourceId,
    sourceLabel: SOURCE_LABEL[e.source_id as SourceId] ?? e.source_id,
    kind: 'source_event',
    category: e.category as GeographicEvent['category'],
    severity: e.severity as GeographicEvent['severity'],
    title: e.headline,
    location: traffic && e.point_lat !== null && e.point_lon !== null ? { lat: e.point_lat, lon: e.point_lon } : null,
    geo: traffic
      ? { match: 'within_radius', distanceMeters: n(e.distance_m), note: 'Avstånd till händelsens närmaste punkt' }
      : { match: e.match_method === 'municipality' ? 'municipality' : 'county', note: 'Regional information – inte en lokal händelse vid fastigheten' },
    validFrom: iso(e.valid_from),
    validTo: iso(e.valid_to),
    timeLabel: null,
    sourceUrl: e.source_url,
    ...(traffic ? { nightWork: nightWorkLabel(e.valid_from, e.valid_to, e.description) } : {}),
    origin: 'live',
  };
}

/* ------------------------------------------------------------------ */
/* Context (flood, groundwater, statistics)                            */
/* ------------------------------------------------------------------ */

const ctxOf = (rows: OrgContextRow[], source: string, key: string) => rows.find((c) => c.source_id === source && c.context_key === key);

function floodFromContext(propertyId: string, c: OrgContextRow | undefined, now: Date): { flood: PropertySnapshot['flood']; context: PropertyMonitoringContext['flood'] } {
  const empty: PropertySnapshot['flood'] = {
    propertyId,
    mapped: { sourceId: 'mcf_flood', exposureClass: 'unknown', scenario: null, distanceToZoneMeters: null, availability: c ? 'unknown' : 'loading', geo: { match: 'not_matched', note: 'Översvämningskartering ej kontrollerad ännu' }, origin: 'live' },
    waterBody: null,
  };
  if (!c || c.status !== 'ok') return { flood: empty, context: null };
  const p = c.payload as { scenarios?: Array<{ scenario: 'q100' | 'q200' | 'bhf'; label: string; inside: boolean; withinMeters: number | null }>; datasetVersion?: string | null; maxRadiusMeters?: number; attribution?: string };
  const scenarios = p.scenarios ?? [];
  const inside = (k: string) => scenarios.find((s) => s.scenario === k)?.inside;
  // Documented mapping (not a risk score): which mapped SCENARIO area contains the point.
  const exposureClass = inside('q100') ? 'High' : inside('q200') ? 'Medium' : inside('bhf') ? 'Low' : 'unknown';
  const nearest = scenarios.filter((s) => s.withinMeters !== null).sort((a, b) => a.withinMeters! - b.withinMeters!)[0];
  const insideScenario = scenarios.find((s) => s.inside);
  const max = p.maxRadiusMeters ?? 1000;
  const note = insideScenario
    ? `Träff i en sökruta omkring adresspunkten (±15 m) för ${insideScenario.label} (MCF). Inte en verifierad byggnadsöverlappning. Statiskt scenario – inte en aktuell vattennivå.`
    : nearest
      ? `Karterat område för ${nearest.label} inom ${nearest.withinMeters} m. Statiskt scenario – inte en aktuell vattennivå.`
      : `Inget karterat översvämningsområde inom ${max} m. Karteringen täcker bara utvalda vattendrag – detta betyder inte att risk saknas.`;
  return {
    flood: {
      propertyId,
      mapped: {
        sourceId: 'mcf_flood',
        exposureClass,
        scenario: insideScenario?.label ?? nearest?.label ?? null,
        distanceToZoneMeters: insideScenario ? 0 : (nearest?.withinMeters ?? null),
        availability: 'ok',
        geo: { match: 'polygon_intersection', distanceMeters: insideScenario ? 0 : (nearest?.withinMeters ?? null), note },
        origin: 'live',
      },
      waterBody: null,
    },
    context: {
      scenarios,
      maxRadiusMeters: max,
      datasetVersion: p.datasetVersion ?? null,
      note,
      provenance: provenance('mcf_flood', 'STATIC_GEODATA', null, c.fetched_at, p.attribution ?? 'Källa: MCF', 'https://www.mcf.se/sv/verktyg--tjanster/oversvamningsportalen/', now),
    },
  };
}

function groundwaterFromContext(c: OrgContextRow | undefined, now: Date): PropertyMonitoringContext['groundwater'] {
  if (!c || c.status !== 'ok') return null;
  const p = c.payload as { areaId: string; date: string; fillSmall: number | null; fillLarge: number | null; situationSmall: number | null; situationLarge: number | null; attribution?: string };
  return {
    areaId: p.areaId,
    date: p.date,
    fillSmall: p.fillSmall,
    fillLarge: p.fillLarge,
    situationSmall: p.situationSmall,
    situationLarge: p.situationLarge,
    note: 'Modellberäknad nivå för ett 4×4 km-område (SGU HYPE), uttryckt som percentil. Inte en mätning vid byggnaden.',
    provenance: provenance('sgu_groundwater', 'MODEL', iso(c.source_timestamp), c.fetched_at, p.attribution ?? 'Källa: SGU', 'https://www.sgu.se/grundvatten/grundvattennivaer/', now),
  };
}

function statsFromContext(c: OrgContextRow | undefined, now: Date): PropertyMonitoringContext['statistics'] {
  if (!c || c.status !== 'ok') return null;
  const p = c.payload as { regionCode: string; regionName: string; tableId: string; period: string; values: Array<{ key: string; label: string; value: number | null; unit: string }>; attribution?: string };
  return {
    regionCode: p.regionCode,
    regionName: p.regionName,
    tableId: p.tableId,
    period: p.period,
    values: p.values,
    note: 'Kommunstatistik som sammanhang – används inte för larm eller bedömning.',
    provenance: provenance('scb', 'REGIONAL_STATISTIC', iso(c.source_timestamp), c.fetched_at, p.attribution ?? 'Källa: SCB', `https://www.statistikdatabasen.scb.se/`, now),
  };
}

/* ------------------------------------------------------------------ */
/* Property snapshot                                                   */
/* ------------------------------------------------------------------ */

const sourceOk = (statuses: DataSourceStatus[], id: SourceId) => {
  const s = statuses.find((x) => x.sourceId === id);
  return !!s && s.status === 'ok' && s.freshness === 'fresh' && !!s.lastSuccessAt;
};

function observedGroundwater(c: OrgContextRow | undefined, now: Date): NearbyObservation | null {
  if (!c || c.status !== 'ok') return null;
  const p = c.payload as { stationId: string; stationName: string; distanceMeters: number; value: number; unit: string; observedAt: string; note: string; sourceUrl: string };
  const t = Date.parse(p.observedAt);
  if (!Number.isFinite(t) || t > now.getTime() || now.getTime() - t > GROUNDWATER_OBS_MAX_AGE_DAYS * 86_400_000 || p.distanceMeters > 10_000 || !Number.isFinite(p.value)) return null;
  return { ...p, parameter: 'groundwater_depth', label: 'Grundvatten vid stationen', quality: null, qualityFlags: [],
    provenance: provenance('sgu_observed_groundwater', 'OBSERVATION', p.observedAt, c.fetched_at, 'Källa: SGU (CC0)', p.sourceUrl, now) };
}

export function buildPropertySnapshot(p: PropertyRecord, clerkOrgId: string, data: OrgMonitoringData, statuses: DataSourceStatus[], now: Date): PropertySnapshot {
  const base = propertyToSnapshot(p, clerkOrgId);
  const forecastRow = data.forecasts.find((f) => f.property_id === p.id);
  const events = data.events.filter((e) => e.property_id === p.id);
  const obs = data.observations.filter((o) => o.property_id === p.id);
  const contexts = data.contexts.filter((c) => c.property_id === p.id);
  const county = data.counties.find((c) => c.property_id === p.id) ?? null;

  const warnings = events.filter((e) => e.data_class === 'OFFICIAL_WARNING').map(toWarning);
  const publicEvents = mergeTrafficDuplicates(events.filter((e) => e.data_class === 'PUBLIC_EVENT'));
  const official = warnings.filter((w) => w.level !== 'Info');

  // Status: highest active official warning; "normal" only when warning sources are healthy.
  let status: PropertyStatus = 'unknown';
  let reason = 'Varningskällor är inte aktuella – status kan inte bedömas';
  for (const w of official) {
    // A VMA that names other municipalities in the county is not a crisis at this property (ADR 0003).
    const otherMunicipality = w.level === 'VMA' && w.geo.match === 'county';
    const st = otherMunicipality ? 'monitor' : LEVEL_STATUS[w.level];
    if (st && STATUS_RANK[st] > STATUS_RANK[status]) {
      status = st;
      reason = otherMunicipality ? `VMA för andra kommuner i länet: ${w.type} (${w.sourceLabel})` : `${LEVEL_SV[w.level]}: ${w.type} (${w.sourceLabel})`;
    }
  }
  if (status === 'unknown' && sourceOk(statuses, 'smhi_warnings') && sourceOk(statuses, 'krisinformation')) {
    status = 'normal';
    reason = 'Inga aktiva officiella varningar för fastighetens läge';
  }

  const history=(source:string,station:string,parameter:string):TimedReading[] => (data.history??[]).filter(x=>x.source_id===source&&x.station_id===station&&x.parameter===parameter).map(x=>({observedAt:x.observed_at.toISOString(),value:x.value}));
  const floodParts = floodFromContext(p.id, ctxOf(contexts, 'mcf_flood', 'flood_scenarios'), now);
  const sea=obs.find(o=>o.source_id==='smhi_oceanography'&&o.parameter==='sea_level'&&o.distance_m<=WEATHER_WATER.seaDistanceM&&o.extra.referenceSystem==='RW');
  if(sea) floodParts.flood.waterBody={name:'Havsvattenstånd · '+sea.name,stationName:sea.name,referenceSystem:'RW',level:{value:sea.value,unit:'cm',sourceId:'smhi_oceanography',kind:'observation',sourceTimestamp:iso(sea.observed_at),fetchedAt:sea.fetched_at.toISOString(),freshness:freshnessOf(sea.observed_at,WEATHER_WATER.stationMeasurementFreshSeconds,now),availability:'ok',geo:{match:'nearest_station',distanceMeters:Math.round(sea.distance_m),note:sea.name},origin:'live',qualityFlags:sea.quality?[sea.quality]:[]},trendLabel:measurementTrend(history('smhi_oceanography',sea.station_id,'sea_level'),now,6,'cm',WEATHER_WATER.seaTrendDeadbandCm)??measurementTrend((sea.extra.points??[]) as TimedReading[],now,1,'cm',WEATHER_WATER.seaTrendDeadbandCm)};
  const flow=obs.find(o=>o.source_id==='smhi_hydrology'&&o.parameter==='water_flow'&&o.distance_m<=WEATHER_WATER.flowDistanceM);
  const reference=flow?data.hydrologyReferences?.find(r=>r.station_id===flow.station_id&&r.month===now.getUTCMonth()+1&&now.getTime()-r.fetched_at.getTime()<=WEATHER_WATER.referenceUsableDays*86_400_000):null;
  if(flow)floodParts.flood.watercourse={stationId:flow.station_id,stationName:flow.name,distanceMeters:Math.round(flow.distance_m),measurement:{value:flow.value,unit:'m³/s',sourceId:'smhi_hydrology',kind:'observation',sourceTimestamp:iso(flow.observed_at),fetchedAt:flow.fetched_at.toISOString(),freshness:freshnessOf(flow.observed_at,WEATHER_WATER.stationMeasurementFreshSeconds,now),availability:'ok',geo:{match:'nearest_station',distanceMeters:Math.round(flow.distance_m),note:flow.name},origin:'live',qualityFlags:flow.quality?[flow.quality]:[]},classification:classifyFlow(flow.value,reference??null),trendLabel:measurementTrend(history('smhi_hydrology',flow.station_id,'water_flow'),now,24,'m³/s'),note:'Närmaste mätstation – kan ligga i ett annat vattendrag än det närmast fastigheten',reference:reference?{p75:reference.p75,p95:reference.p95,samples:reference.samples,years:reference.years,month:reference.month,fetchedAt:reference.fetched_at.toISOString()}:null};
  const nearby = obs.map((o) => toNearby(o, now));
  const airIndex = stationAirIndex((data.airHistory ?? []).filter((x) => x.property_id === p.id).map((o) => ({
    stationId: o.station_id, stationName: o.name, distanceMeters: Math.round(o.distance_m), parameter: o.parameter,
    value: o.value, observedAt: iso(o.observed_at), resolution: o.extra.resolution, classification: o.extra.classification,
  })), now);
  const groundwaterObservation = observedGroundwater(ctxOf(contexts, 'sgu_observed_groundwater', 'groundwater_observation'), now);
  const coverage: PropertyMonitoringContext['coverage'] = [
    { sourceId: 'smhi_forecast', status: forecastRow ? 'ok' : 'loading', note: forecastRow ? null : 'Prognos hämtas' },
    { sourceId: 'smhi_observations', status: nearby.some((x) => x.provenance.sourceId === 'smhi_observations' && x.distanceMeters <= OBS_MAX_DISTANCE_M) ? 'ok' : 'no_coverage', note: `Station inom ${OBS_MAX_DISTANCE_M / 1000} km med värde senaste 3 h` },
    { sourceId: 'air_quality', status: nearby.some((x) => x.provenance.sourceId === 'air_quality' && x.distanceMeters <= AIR_MAX_DISTANCE_M) ? 'ok' : 'no_coverage', note: `Mätstation inom ${AIR_MAX_DISTANCE_M / 1000} km med värde senaste 6 h` },
    { sourceId: 'sgu_observed_groundwater', status: groundwaterObservation ? 'ok' : 'no_coverage', note: 'Grundvattenstation inom 10 km, mätt senaste 31 dagar.' },
    ...(['sgu_groundwater', 'mcf_flood', 'scb'] as const).map((sid) => {
      const c = contexts.find((x) => x.source_id === sid);
      return { sourceId: sid, status: (c ? c.status : 'loading') as PropertyMonitoringContext['coverage'][number]['status'], note: (c?.payload as { note?: string } | undefined)?.note ?? null };
    }),
  ];

  const rainStation=obs.find(o=>o.source_id==='smhi_observations'&&o.parameter==='precipitation_15min'&&o.distance_m<=WEATHER_WATER.observationDistanceM);
  const radar = data.nowcasts?.find(x => x.property_id === p.id);
  const radarAge = radar ? (now.getTime()-radar.fetched_at.getTime())/60_000 : Infinity;
  const snapshot: PropertySnapshot = {
    ...base,
    property: { ...base.property, countyCode: county?.code ?? null, status, statusReason: reason },
    metrics: [...forecastMetrics(p.id, forecastRow, now), ...airMetrics(p.id, obs, now), ...(airIndex ? [{
      propertyId: p.id, metricKey: 'air_quality.index' as const, value: airIndex.band, unit: 'EEA nivå 1–6', sourceId: 'air_quality' as const,
      kind: 'observation' as const, sourceTimestamp: airIndex.observedAt,
      fetchedAt: (data.airHistory ?? []).filter((o) => o.property_id === p.id && o.station_id === airIndex.stationId && iso(o.observed_at) === airIndex.observedAt).sort((a, b) => b.fetched_at.getTime() - a.fetched_at.getTime())[0]?.fetched_at.toISOString() ?? null,
      freshness: 'fresh' as const, availability: 'ok' as const,
      origin: 'live' as const, qualityFlags: ['derived', 'preliminary', airIndex.method],
      geo: { match: 'nearest_station' as const, distanceMeters: airIndex.distanceMeters, note: `Mätstation: ${airIndex.stationName}; härlett EEA-baserat stationsindex, inte byggnadens luft.` },
    }] : [])],
    forecast: buildForecast(p.id, forecastRow, now),
    measuredRain:rainStation?{sourceId:'smhi_observations',stationName:rainStation.name,distanceMeters:Math.round(rainStation.distance_m),observedAt:iso(rainStation.observed_at),fetchedAt:rainStation.fetched_at.toISOString(),qualityNote:'Stationsmätningar; senaste värden kan vara preliminära eller grovt kontrollerade',totals:[1,24,72].map(h=>measuredPrecipitation(history('smhi_observations',rainStation.station_id,'precipitation_15min'),now,h))}:null,
    nowcast: radar ? { sourceId:'met_nowcast', coverage:radar.radar_coverage, updatedAt:iso(radar.source_updated_at), fetchedAt:radar.fetched_at.toISOString(), freshness:radarAge<=WEATHER_WATER.nowcastFreshMinutes?'fresh':radarAge<=WEATHER_WATER.nowcastUsableMinutes?'stale':'expired', points:radar.series.points, summary:summarizeNowcast(radar.series.points,now,radar.series.temperature,{coverage:radar.radar_coverage,fetchedAt:radar.fetched_at.toISOString()}), attribution:'Data från MET Norway · bearbetad av FastighetsRadar (CC BY 4.0)', origin:'live' } : null,
    warnings,
    events: publicEvents,
    flood: floodParts.flood,
    activeAlertCount: official.length,
    demoRisk: null,
    monitoring: {
      county: county ? { code: county.code, name: county.name } : null,
      observations: nearby.filter((x) => x.provenance.sourceId === 'smhi_observations' && x.distanceMeters <= OBS_MAX_DISTANCE_M),
      airQuality: nearby.filter((x) => x.provenance.sourceId === 'air_quality' && x.distanceMeters <= AIR_MAX_DISTANCE_M),
      groundwater: groundwaterFromContext(ctxOf(contexts, 'sgu_groundwater', 'groundwater'), now),
      observedGroundwater: groundwaterObservation,
      airIndex,
      flood: floodParts.context,
      statistics: statsFromContext(ctxOf(contexts, 'scb', 'municipality_stats'), now),
      statusMethod: 'highest_official_warning',
      coverage,
    },
  };
  // Riskindex v1 (docs/decisions/0003-riskindex.md) – same source-currency rule as the status.
  return { ...snapshot, riskIndex: assessPropertyRisk(snapshot, (id) => sourceOk(statuses, id)) };
}

/* ------------------------------------------------------------------ */
/* Portfolio-level feed / upcoming                                     */
/* ------------------------------------------------------------------ */

const SEV_STATUS: Record<string, PropertyStatus> = { critical: 'critical', warning: 'warning', monitor: 'monitor', info: 'normal', unknown: 'unknown' };
const CHANGE_SV: Record<string, string> = { new: 'Ny', updated: 'Uppdaterad', ended: 'Avslutad', cancelled: 'Återkallad' };

type FeedChange = {
  id: string; property_id: string; event_id?: string | null; event_ended_on_map?: boolean; outage_on_map?: boolean; event_active?: boolean; superseded?: boolean;
  acknowledged_at?: Date | null; source_id: string; change_type: string; severity: string; headline: string; created_at: Date;
  dedup_key?: string | null;
  event_type?: string | null; situation_id?: string | null; event_valid_from?: Date | null; event_valid_to?: Date | null; event_description?: string | null;
  update_read?: boolean;
  revision?: { id: string; at: Date; eventId: string | null | undefined; read: boolean };
};
const SAME_BATCH_MS = 5 * 60_000;

/**
 * A night closure that ends as planned (05:00 after a 22:00 start) says nothing new – tonight's closure
 * comes as its own "Ny". Only an end within an hour of the planned end is hidden: a night closure
 * cancelled early is still shown as "Avslutad".
 */
function plannedNightEnd(c: FeedChange): boolean {
  if (c.source_id !== 'trafikverket' || (c.change_type !== 'ended' && c.change_type !== 'cancelled')) return false;
  if (!c.event_valid_to || !nightWorkLabel(c.event_valid_from, c.event_valid_to, c.event_description)) return false;
  return c.created_at.getTime() >= c.event_valid_to.getTime() - 60 * 60_000;
}

const significantTraffic = (row: FeedChange) => row.severity === 'warning' || row.severity === 'critical';

/** A traffic event keeps its first visible headline and timestamp for this property. */
function collapseTrafficChanges(rows: FeedChange[], replacements: ReadonlySet<string>): FeedChange[] {
  const byEvent = new Map<string, FeedChange[]>();
  const otherRows: FeedChange[] = [];
  for (const row of rows) {
    if (row.source_id !== 'trafikverket' || !row.event_id) {
      if (row.source_id !== 'trafikverket' || significantTraffic(row)) otherRows.push(row);
      continue;
    }
    const key = `${row.property_id}:${row.event_id}`;
    const versions = byEvent.get(key) ?? [];
    versions.push(row);
    byEvent.set(key, versions);
  }
  for (const versions of byEvent.values()) {
    const latest = versions[0]!;
    const firstIndex = versions.findLastIndex(significantTraffic);
    if (firstIndex < 0) continue;
    const first = versions[firstIndex]!;
    const revision = versions.find((row, i) => row.change_type === 'updated' && (i < firstIndex || replacements.has(row.id)));
    const ended = latest.change_type === 'ended' || latest.change_type === 'cancelled';
    otherRows.push({
      ...latest,
      created_at: first.created_at,
      headline: first.headline,
      change_type: ended || replacements.has(first.id) ? latest.change_type : 'new',
      revision: revision && { id: revision.id, at: revision.created_at, eventId: revision.event_id, read: revision.update_read === true },
    });
  }
  return otherRows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
}

export function buildFeed(changes: FeedChange[], propertyIds: Set<string>): FeedItem[] {
  const ordered = changes
    .filter((c) => propertyIds.has(c.property_id))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  // A situation Trafikverket replaced by a new one for the same closure is not "Avslutad" + "Ny".
  const replaced = replacedTraffic(ordered.filter((c) => c.source_id === 'trafikverket' && significantTraffic(c)));
  const rows = ordered
    .filter((c) => !replaced.hidden.has(c.id) && !plannedNightEnd(c))
    .map((c) => (replaced.updated.has(c.id) ? { ...c, change_type: 'updated' } : c));
  // Trafikverket's duplicates of one closure (both directions, cause and effect) arrive together: one row.
  const groups = groupDuplicates(
    collapseTrafficChanges(rows, replaced.updated),
    (c): DuplicateKey => ({ sourceId: c.source_id, situationId: c.situation_id ?? null, eventType: c.event_type ?? null, headline: c.headline, validFrom: c.event_valid_from?.getTime() ?? null, validTo: c.event_valid_to?.getTime() ?? null }),
    (a, b) => a.property_id === b.property_id && a.change_type === b.change_type && Math.abs(a.created_at.getTime() - b.created_at.getTime()) <= SAME_BATCH_MS,
  );
  return groups
    .slice(0, 30)
    .map((g) => {
      const c = g[0]!;
      const severity = g.map((x) => x.severity).sort((a, b) => (SEVERITY_RANK[b] ?? 0) - (SEVERITY_RANK[a] ?? 0))[0]!;
      const headline = g.length > 1 ? mergedTrafficTitle(g.map((x) => ({ eventType: x.event_type ?? null, headline: x.headline }))) : c.headline;
      const revision = g.reduce<FeedChange['revision']>((latest, row) =>
        row.revision && (!latest || row.revision.at > latest.at) ? row.revision : latest, undefined);
      return { ...c, severity, headline, revision };
    })
    .map(toFeedItem);
}

function toFeedItem(c: FeedChange): FeedItem {
  const ack = { sourceId: c.source_id, changeType: c.change_type, severity: c.severity };
  const acknowledgementUpdate = c.change_type === 'updated' && feedNeedsAck({ ...ack, eventActive: true });
  // Monitoring deduplication keys store the source revision after the event UUID.
  const revision = c.dedup_key?.match(/:v(\d+)(?::|$)/)?.[1] ?? (c.revision?.at ?? c.created_at).toISOString();
  return {
      id: c.id.startsWith('alarm-') ? c.id : `chg-${c.id}`,
      publishedAt: c.created_at.toISOString(),
      ...(c.revision ? { updatedAt: c.revision.at.toISOString() } : {}),
      ...(c.revision && !c.revision.read ? { unreadUpdateId: `chg-${c.revision.id}` } : {}),
      ...(acknowledgementUpdate ? { acknowledgementUpdate: true } : {}),
      ...(c.revision?.eventId && c.revision.eventId !== c.event_id ? { updatedEventId: c.revision.eventId } : {}),
      // Outage rows already carry a complete, state-specific title ("Strömmen är tillbaka …").
      title: c.source_id === 'utility_outages' || c.change_type === 'active' ? c.headline : `${CHANGE_SV[c.change_type] ?? c.change_type}: ${c.headline}`,
      sourceLabel: SOURCE_LABEL[c.source_id as SourceId] ?? c.source_id,
      sourceId: c.source_id as SourceId,
      severity: c.change_type === 'ended' || c.change_type === 'cancelled' ? 'normal' : c.source_id === 'utility_outages' && c.severity === 'info' ? 'monitor' : (SEV_STATUS[c.severity] ?? 'unknown'),
      propertyId: c.property_id,
      ...(c.event_id ? { eventId: c.event_id } : {}),
      ...(c.event_id ? { eventGroupId: JSON.stringify([c.source_id, c.event_id, c.change_type, revision, c.revision?.eventId ?? null]) } : {}),
      ...(c.event_id && c.event_ended_on_map ? { eventEndedOnMap: true } : {}),
      ...(c.event_id && c.outage_on_map ? { outageOnMap: true } : {}),
      ...(c.source_id === 'trafikverket' && nightWorkLabel(c.event_valid_from, c.event_valid_to, c.event_description) ? { nightWork: nightWorkLabel(c.event_valid_from, c.event_valid_to, c.event_description) } : {}),
      ...(feedNeedsAck({ ...ack, eventActive: c.event_active === true, superseded: c.superseded === true })
        ? { ackRequired: true, acknowledgedAt: c.acknowledged_at ? c.acknowledged_at.toISOString() : null }
        : {}),
      origin: 'live',
  };
}

/** Use the same active alarms and source settings as the property snapshots. */
export function buildActiveAlarmFeed(changes: Array<FeedChange & { unread_alarm_id: string | null }>, snapshots: PropertySnapshot[]): FeedItem[] {
  const active = new Set<string>();
  for (const snapshot of snapshots) {
    for (const warning of snapshot.warnings) {
      if (warning.level !== 'Info') active.add(`${snapshot.property.id}:${warning.id}`);
    }
    for (const section of snapshot.utilityOutages ?? []) {
      for (const outage of section.current) {
        if (outage.severity === 'warning' || outage.severity === 'critical') active.add(`${snapshot.property.id}:${outage.id}`);
      }
    }
  }
  return changes.filter((c) => active.has(`${c.property_id}:${c.event_id}`)).map((c) => ({
    ...toFeedItem(c),
    ...(c.unread_alarm_id ? { unreadAlarmId: `chg-${c.unread_alarm_id}` } : {}),
  }));
}

/**
 * Forecast-derived upcoming conditions (next 24 h). Plain thresholds on the SMHI point forecast,
 * shown as forecast facts – not alerts and not a risk assessment.
 */
export function buildUpcoming(snapshots: PropertySnapshot[], forecasts: OrgForecastRow[], now: Date, outagesEnabled = false): UpcomingCondition[] {
  const out: UpcomingCondition[] = [];
  for (const s of snapshots) {
    if (outagesEnabled) for (const section of s.utilityOutages ?? []) for (const o of section.upcoming) {
      if (o.kind !== 'planned' || o.state !== 'upcoming' || o.noticeKind && o.noticeKind !== 'outage' || !['water', 'district_heating', 'district_cooling'].includes(o.utility) || !['high', 'medium'].includes(o.precisionLevel)) continue;
      const start = Date.parse(o.plannedStart ?? ''), end = Date.parse(o.plannedEnd ?? '');
      const seen = Date.parse(o.lastSeenAt ?? '');
      if (!Number.isFinite(seen) || seen > now.getTime() || now.getTime() - seen > 20 * 60000) continue;
      // Unknown ends are omitted: the timeline must not invent a one-hour shutdown.
      if (!Number.isFinite(start) || !Number.isFinite(end) || start <= now.getTime() || start > now.getTime() + 48 * 3600000 || end <= start) continue;
      out.push({ id: `outage-${s.property.id}-${o.id}`, kind: 'outage', label: outageHeadline({ utility: o.utility, kind: 'planned', state: 'upcoming', plannedStart: o.plannedStart, plannedEnd: o.plannedEnd }, o.operatorName),
        where: s.property.name, propertyId: s.property.id, when: formatWeekdayClock(o.plannedStart!), validAt: o.plannedStart!, validTo: o.plannedEnd!,
        sourceId: 'utility_outages', sourceName: o.operatorName, ...(o.sourceUrl ? { sourceUrl: o.sourceUrl } : {}),
        ...(o.operatorText ? { explanation: o.operatorText } : {}), value: 'Planerad avstängning', tone: 'monitor', origin: 'live', official: false });
    }
    for (const w of s.warnings) if(w.validFrom && Date.parse(w.validFrom)>now.getTime() && Date.parse(w.validFrom)<=now.getTime()+48*3600000) out.push({id:'official-'+s.property.id+'-'+w.id,label:w.type,where:s.property.name,propertyId:s.property.id,when:formatWeekdayClock(w.validFrom),validAt:w.validFrom,...(w.validTo?{validTo:w.validTo}:{}),sourceId:w.sourceId,sourceUpdatedAt:w.issuedAt,official:true,value:LEVEL_SV[w.level],tone:w.level==='Red'||w.level==='VMA'?'critical':w.level==='Orange'?'warning':'monitor',origin:w.origin});
    const row = forecasts.find(f => f.property_id === s.property.id);
    if (!row || now.getTime() - row.fetched_at.getTime() > WEATHER_WATER.forecastUsableHours * 3_600_000) continue;
    for (const info of forecastInformation(forecastSteps(row), now)) out.push({ id: info.key + '-' + s.property.id, label: info.label, where: s.property.name, propertyId: s.property.id, when: formatWeekdayClock(info.at), validAt: info.at, validTo: info.until, sourceId: 'smhi_forecast', sourceUpdatedAt:iso(row.reference_time), value: info.value, explanation: info.explanation, tone: info.tone, origin: 'live' });
    const steps = forecastSteps(forecasts.find((f) => f.property_id === s.property.id)).filter((x) => Date.parse(x.time) > now.getTime() && Date.parse(x.time) <= now.getTime() + 24 * 3_600_000);
    if (!steps.length) continue;
    const gust = steps.reduce<ForecastStep | null>((a, b) => ((b.windGust ?? -1) > (a?.windGust ?? -1) ? b : a), null);
    if (gust?.windGust !== null && gust && gust.windGust >= 15) {
      // The bar: from the first to the last hour with gusts of 15 m/s or more.
      const hard = steps.filter((x) => (x.windGust ?? -1) >= 15);
      const from = hard[0]!.intervalStart ?? hard[0]!.time;
      out.push({ id: `gust-${s.property.id}`, label: 'Hårda vindbyar (prognos)', where: s.property.name, propertyId: s.property.id, when: formatWeekdayClock(from), validAt: from, validTo: hard.at(-1)!.time, sourceId:'smhi_forecast',sourceUpdatedAt:iso(row.reference_time), value: `${gust.windGust.toFixed(0)} m/s`, tone: gust.windGust >= 21 ? 'warning' : 'monitor', origin: 'live' });
    }
    const rain = precipitationTotal(forecastSteps(forecasts.find((f) => f.property_id === s.property.id)), now, 24);
    if (rain !== null && rain >= 15) {
      out.push({ id: `rain-${s.property.id}`, label: 'Kraftig nederbörd (prognos, 24 h)', where: s.property.name, propertyId: s.property.id, when: 'Närmaste 24 h', validAt:now.toISOString(), validTo: new Date(now.getTime() + 24 * 3_600_000).toISOString(),sourceId:'smhi_forecast',sourceUpdatedAt:iso(row.reference_time), value: `${rain.toFixed(0)} mm`, tone: rain >= 30 ? 'warning' : 'monitor', origin: 'live' });
    }
    const cold = steps.find((x) => x.airTemperature !== null && x.airTemperature < 0);
    if (cold && cold.airTemperature !== null) {
      // The cold spell: consecutive hours below 0° from the first one (up to 48 h ahead); the value is its lowest temperature.
      const all48 = forecastSteps(row).filter((x) => Date.parse(x.time) > now.getTime() && Date.parse(x.time) <= now.getTime() + 48 * 3_600_000).sort((x, y) => x.time.localeCompare(y.time));
      // forecastSteps() returns fresh objects on every call: find the first cold hour by its time.
      const first = all48.findIndex((x) => x.time === cold.time);
      const spell: ForecastStep[] = [cold];
      for (const x of first < 0 ? [] : all48.slice(first + 1)) {
        if (x.airTemperature === null || x.airTemperature >= 0 || x.intervalStart !== spell.at(-1)!.time) break;
        spell.push(x);
      }
      const lowest = Math.min(...spell.map((x) => x.airTemperature!));
      const from = cold.intervalStart ?? cold.time;
      out.push({ id: `frost-${s.property.id}`, label: 'Minusgrader (prognos)', where: s.property.name, propertyId: s.property.id, when: formatWeekdayClock(from), validAt: from, validTo: spell.at(-1)!.time, sourceId:'smhi_forecast',sourceUpdatedAt:iso(row.reference_time), value: `${lowest.toFixed(0)}°`, tone: 'cold', origin: 'live' });
    }
  }
  const rank = { critical: 0, warning: 1, monitor: 2, cold: 3 };
  return out.sort((a,b) => Number(!!b.official)-Number(!!a.official) || rank[a.tone] - rank[b.tone] || (a.validAt ?? '').localeCompare(b.validAt ?? '')).slice(0, 8);
}
