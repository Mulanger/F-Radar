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
import { assessPropertyRisk, formatWeekdayClock, swedishDayWindows, forecastInformation, WEATHER_WATER, summarizeNowcast, measurementTrend, type TimedReading, classifyFlow, measuredPrecipitation } from '@fastighetsradar/domain';
import type { OrgContextRow, OrgEventRow, OrgForecastRow, OrgMonitoringData, OrgObservationRow } from '@fastighetsradar/db';
import {
  AIR_PHENOMENA,
  AIR_QUALITY_ATTRIBUTION,
  METOBS_PARAMETERS,
  SMHI_ATTRIBUTION,
  currentStep,
  precipitationTotal,
  type ForecastStep,
} from '@fastighetsradar/integrations';
import { propertyToSnapshot } from '../portfolio';
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

const SOURCE_LABEL: Partial<Record<SourceId, string>> = {
  smhi_warnings: 'SMHI',
  krisinformation: 'Krisinformation.se',
  trafikverket: 'Trafikverket',
  smhi_forecast: 'SMHI',
  smhi_observations: 'SMHI',
  air_quality: 'SMHI / Naturvårdsverket',
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
    qualityFlags: air ? ['preliminary'] : o.quality === 'Y' ? ['suspect_or_aggregated'] : [],
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
    summary: (e.description ?? e.headline).slice(0, 600),
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

function toEvent(e: OrgEventRow): GeographicEvent {
  const traffic = e.source_id === 'trafikverket';
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
    ? `Inom karterat område för ${insideScenario.label} (MCF). Statiskt scenario – inte en aktuell vattennivå.`
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
    provenance: provenance('sgu_groundwater', 'OBSERVATION', iso(c.source_timestamp), c.fetched_at, p.attribution ?? 'Källa: SGU', 'https://www.sgu.se/grundvatten/grundvattennivaer/', now),
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
  return s ? s.status === 'ok' || s.status === 'degraded' ? !!s.lastSuccessAt : false : false;
};

export function buildPropertySnapshot(p: PropertyRecord, clerkOrgId: string, data: OrgMonitoringData, statuses: DataSourceStatus[], now: Date): PropertySnapshot {
  const base = propertyToSnapshot(p, clerkOrgId);
  const forecastRow = data.forecasts.find((f) => f.property_id === p.id);
  const events = data.events.filter((e) => e.property_id === p.id);
  const obs = data.observations.filter((o) => o.property_id === p.id);
  const contexts = data.contexts.filter((c) => c.property_id === p.id);
  const county = data.counties.find((c) => c.property_id === p.id) ?? null;

  const warnings = events.filter((e) => e.data_class === 'OFFICIAL_WARNING').map(toWarning);
  const publicEvents = events.filter((e) => e.data_class === 'PUBLIC_EVENT').map(toEvent);
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
  if (status === 'unknown' && sourceOk(statuses, 'smhi_warnings')) {
    status = 'normal';
    reason = sourceOk(statuses, 'krisinformation') ? 'Inga aktiva officiella varningar för fastighetens läge' : 'Inga aktiva SMHI-varningar för fastighetens läge (Krisinformation ej aktuell)';
  }

  const history=(source:string,station:string,parameter:string):TimedReading[] => (data.history??[]).filter(x=>x.source_id===source&&x.station_id===station&&x.parameter===parameter).map(x=>({observedAt:x.observed_at.toISOString(),value:x.value}));
  const floodParts = floodFromContext(p.id, ctxOf(contexts, 'mcf_flood', 'flood_scenarios'), now);
  const sea=obs.find(o=>o.source_id==='smhi_oceanography'&&o.parameter==='sea_level'&&o.distance_m<=WEATHER_WATER.seaDistanceM&&o.extra.referenceSystem==='RW');
  if(sea) floodParts.flood.waterBody={name:'Havsvattenstånd · '+sea.name,stationName:sea.name,referenceSystem:'RW',level:{value:sea.value,unit:'cm',sourceId:'smhi_oceanography',kind:'observation',sourceTimestamp:iso(sea.observed_at),fetchedAt:sea.fetched_at.toISOString(),freshness:freshnessOf(sea.observed_at,WEATHER_WATER.stationMeasurementFreshSeconds,now),availability:'ok',geo:{match:'nearest_station',distanceMeters:Math.round(sea.distance_m),note:sea.name},origin:'live',qualityFlags:sea.quality?[sea.quality]:[]},trendLabel:measurementTrend(history('smhi_oceanography',sea.station_id,'sea_level'),now,6,'cm',WEATHER_WATER.seaTrendDeadbandCm)??measurementTrend((sea.extra.points??[]) as TimedReading[],now,1,'cm',WEATHER_WATER.seaTrendDeadbandCm)};
  const flow=obs.find(o=>o.source_id==='smhi_hydrology'&&o.parameter==='water_flow'&&o.distance_m<=WEATHER_WATER.flowDistanceM);
  const reference=flow?data.hydrologyReferences?.find(r=>r.station_id===flow.station_id&&r.month===now.getUTCMonth()+1&&now.getTime()-r.fetched_at.getTime()<=WEATHER_WATER.referenceUsableDays*86_400_000):null;
  if(flow)floodParts.flood.watercourse={stationId:flow.station_id,stationName:flow.name,distanceMeters:Math.round(flow.distance_m),measurement:{value:flow.value,unit:'m³/s',sourceId:'smhi_hydrology',kind:'observation',sourceTimestamp:iso(flow.observed_at),fetchedAt:flow.fetched_at.toISOString(),freshness:freshnessOf(flow.observed_at,WEATHER_WATER.stationMeasurementFreshSeconds,now),availability:'ok',geo:{match:'nearest_station',distanceMeters:Math.round(flow.distance_m),note:flow.name},origin:'live',qualityFlags:flow.quality?[flow.quality]:[]},classification:classifyFlow(flow.value,reference??null),trendLabel:measurementTrend(history('smhi_hydrology',flow.station_id,'water_flow'),now,24,'m³/s'),note:'Närmaste mätstation – kan ligga i ett annat vattendrag än det närmast fastigheten',reference:reference?{p75:reference.p75,p95:reference.p95,samples:reference.samples,years:reference.years,month:reference.month,fetchedAt:reference.fetched_at.toISOString()}:null};
  const nearby = obs.map((o) => toNearby(o, now));
  const coverage: PropertyMonitoringContext['coverage'] = [
    { sourceId: 'smhi_forecast', status: forecastRow ? 'ok' : 'loading', note: forecastRow ? null : 'Prognos hämtas' },
    { sourceId: 'smhi_observations', status: nearby.some((x) => x.provenance.sourceId === 'smhi_observations' && x.distanceMeters <= OBS_MAX_DISTANCE_M) ? 'ok' : 'no_coverage', note: `Station inom ${OBS_MAX_DISTANCE_M / 1000} km med värde senaste 3 h` },
    { sourceId: 'air_quality', status: nearby.some((x) => x.provenance.sourceId === 'air_quality' && x.distanceMeters <= AIR_MAX_DISTANCE_M) ? 'ok' : 'no_coverage', note: `Mätstation inom ${AIR_MAX_DISTANCE_M / 1000} km med värde senaste 6 h` },
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
    metrics: [...forecastMetrics(p.id, forecastRow, now), ...airMetrics(p.id, obs, now)],
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

export function buildFeed(changes: Array<{ id: string; property_id: string; source_id: string; change_type: string; severity: string; headline: string; created_at: Date }>, propertyIds: Set<string>): FeedItem[] {
  return changes
    .filter((c) => propertyIds.has(c.property_id))
    // Keep the feed meaningful: minor traffic notices (info/monitor) stay in the property's event list only.
    .filter((c) => c.source_id !== 'trafikverket' || c.severity === 'warning' || c.severity === 'critical')
    .slice(0, 30)
    .map((c) => ({
      id: `chg-${c.id}`,
      publishedAt: c.created_at.toISOString(),
      title: `${CHANGE_SV[c.change_type] ?? c.change_type}: ${c.headline}`,
      sourceLabel: SOURCE_LABEL[c.source_id as SourceId] ?? c.source_id,
      sourceId: c.source_id as SourceId,
      severity: c.change_type === 'ended' || c.change_type === 'cancelled' ? 'normal' : (SEV_STATUS[c.severity] ?? 'unknown'),
      propertyId: c.property_id,
      origin: 'live',
    }));
}

/**
 * Forecast-derived upcoming conditions (next 24 h). Plain thresholds on the SMHI point forecast,
 * shown as forecast facts – not alerts and not a risk assessment.
 */
export function buildUpcoming(snapshots: PropertySnapshot[], forecasts: OrgForecastRow[], now: Date): UpcomingCondition[] {
  const out: UpcomingCondition[] = [];
  for (const s of snapshots) {
    for (const w of s.warnings) if(w.validFrom && Date.parse(w.validFrom)>now.getTime() && Date.parse(w.validFrom)<=now.getTime()+48*3600000) out.push({id:'official-'+s.property.id+'-'+w.id,label:w.type,where:s.property.name,when:formatWeekdayClock(w.validFrom),validAt:w.validFrom,sourceId:w.sourceId,sourceUpdatedAt:w.issuedAt,official:true,value:LEVEL_SV[w.level],tone:w.level==='Red'||w.level==='VMA'?'critical':w.level==='Orange'?'warning':'monitor',origin:w.origin});
    const row = forecasts.find(f => f.property_id === s.property.id);
    if (!row || now.getTime() - row.fetched_at.getTime() > WEATHER_WATER.forecastUsableHours * 3_600_000) continue;
    for (const info of forecastInformation(forecastSteps(row), now)) out.push({ id: info.key + '-' + s.property.id, label: info.label, where: s.property.name, when: formatWeekdayClock(info.at), validAt: info.at, sourceId: 'smhi_forecast', sourceUpdatedAt:iso(row.reference_time), value: info.value, explanation: info.explanation, tone: info.tone, origin: 'live' });
    const steps = forecastSteps(forecasts.find((f) => f.property_id === s.property.id)).filter((x) => Date.parse(x.time) > now.getTime() && Date.parse(x.time) <= now.getTime() + 24 * 3_600_000);
    if (!steps.length) continue;
    const gust = steps.reduce<ForecastStep | null>((a, b) => ((b.windGust ?? -1) > (a?.windGust ?? -1) ? b : a), null);
    if (gust?.windGust !== null && gust && gust.windGust >= 15) {
      out.push({ id: `gust-${s.property.id}`, label: 'Hårda vindbyar (prognos)', where: s.property.name, when: formatWeekdayClock(gust.time), validAt:gust.time,sourceId:'smhi_forecast',sourceUpdatedAt:iso(row.reference_time), value: `${gust.windGust.toFixed(0)} m/s`, tone: gust.windGust >= 21 ? 'warning' : 'monitor', origin: 'live' });
    }
    const rain = precipitationTotal(forecastSteps(forecasts.find((f) => f.property_id === s.property.id)), now, 24);
    if (rain !== null && rain >= 15) {
      out.push({ id: `rain-${s.property.id}`, label: 'Kraftig nederbörd (prognos, 24 h)', where: s.property.name, when: 'Närmaste 24 h', validAt:now.toISOString(),sourceId:'smhi_forecast',sourceUpdatedAt:iso(row.reference_time), value: `${rain.toFixed(0)} mm`, tone: rain >= 30 ? 'warning' : 'monitor', origin: 'live' });
    }
    const cold = steps.find((x) => x.airTemperature !== null && x.airTemperature < 0);
    if (cold && cold.airTemperature !== null) {
      out.push({ id: `frost-${s.property.id}`, label: 'Minusgrader (prognos)', where: s.property.name, when: formatWeekdayClock(cold.time), validAt:cold.time,sourceId:'smhi_forecast',sourceUpdatedAt:iso(row.reference_time), value: `${cold.airTemperature.toFixed(0)}°`, tone: 'cold', origin: 'live' });
    }
  }
  const rank = { critical: 0, warning: 1, monitor: 2, cold: 3 };
  return out.sort((a,b) => Number(!!b.official)-Number(!!a.official) || rank[a.tone] - rank[b.tone] || (a.validAt ?? '').localeCompare(b.validAt ?? '')).slice(0, 8);
}
