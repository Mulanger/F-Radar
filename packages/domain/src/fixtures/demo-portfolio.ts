import { measuredPrecipitation } from '../water-information';
import { summarizeNowcast } from '../nowcast';
import { swedishDayWindows } from '../format';
/**
 * DEMO FIXTURES — NOT REAL DATA.
 *
 * Every property, measurement, warning, event and score below was copied from the
 * approved design prototype (FastighetsRadar.dc.html) so the demo dashboard looks
 * exactly like the design. None of it was fetched from SMHI, Krisinformation,
 * Trafikverket or any other authority, and none of it may be presented as live data.
 *
 * All objects are tagged `origin: 'demo_fixture'`. The reference clock is
 * Wednesday 12 November 2025 14:32 (Europe/Stockholm), matching the design copy.
 */
import type { SourceId } from '../common';
import type {
  AlertRule,
  EnvironmentalMetric,
  EventCategory,
  ExposureClass,
  FeedItem,
  GeographicEvent,
  MetricKey,
  OfficialWarning,
  Portfolio,
  PropertySnapshot,
  WarningLevel,
} from '../entities';
import type { PropertyStatus } from '../common';
import { syntheticSeries } from './synthetic-series';
import { assessPropertyRisk } from '../risk-index';

export const DEMO_ORGANIZATION_ID = 'demo-org';
/** Reference "now" for the demo snapshot (design shows "Wednesday 12 November · 14:32"). */
export const DEMO_REFERENCE_TIME = '2025-11-12T14:32:00+01:00';
const DEMO_DAY = '2025-11-12';

/* ------------------------------------------------------------------ */
/* Raw design values (kept 1:1 with the prototype for auditability)    */
/* ------------------------------------------------------------------ */

interface RawWarning {
  level: WarningLevel;
  type: string;
  src: string;
  start: string; // ISO
  end: string | null; // ISO, null = until further notice
  summary: string;
  region: string;
}
interface RawEvent {
  kind: EventCategory;
  title: string;
  src: string;
  /** metres; null = area-level publication */
  distM: number | null;
  time: string;
  sev: PropertyStatus;
  dx: number;
  dy: number;
}
interface RawProperty {
  slug: string;
  seed: number;
  name: string;
  address: string;
  area: string;
  group: 'inner' | 'outer';
  lat: number;
  lng: number;
  status: PropertyStatus;
  type: string;
  floors: number;
  units: string;
  temp: number;
  feels: number;
  rain24: number;
  wind: number;
  gust: number;
  dir: number;
  hum: number;
  aqi: number;
  flood: ExposureClass;
  fdist: number;
  body: string;
  lvl: number;
  trend: string;
  alerts: number;
  risk: number;
  sms: boolean;
  fac: [number, number, number, number, number];
  warnings: RawWarning[];
  events: RawEvent[];
}

const t = (hhmm: string, day = DEMO_DAY) => `${day}T${hhmm}:00+01:00`;
const THU = '2025-11-13';
const FRI = '2025-11-14';

const RAW: RawProperty[] = [
  {
    slug: 'sjostaden-kaj', seed: 1, name: 'Sjöstaden Kaj', address: 'Hammarby Kaj 12, 120 30 Stockholm', area: 'Hammarby Sjöstad', group: 'inner', lat: 59.3036, lng: 18.1028, status: 'warning', type: 'Bostäder', floors: 9, units: '146 lägenheter',
    temp: 4.2, feels: 0.8, rain24: 18.4, wind: 9.6, gust: 16, dir: 225, hum: 88, aqi: 31, flood: 'High', fdist: 40, body: 'Saltsjön', lvl: 38, trend: 'Stigande +3 cm/h', alerts: 3, risk: 68, sms: true, fac: [62, 84, 8, 30, 18],
    warnings: [
      { level: 'Yellow', type: 'Kraftigt regn', src: 'SMHI', start: t('06:00', THU), end: t('20:00', THU), summary: '15–25 mm regn inom 12 timmar. Risk för ytvatten på gator och i lågt liggande källare.', region: 'Stockholm · Innerstaden' },
      { level: 'Info', type: 'Högt vattenstånd', src: 'SMHI Oceanografi', start: t('12:00'), end: t('00:00', FRI), summary: 'Vattenståndet i Saltsjön väntas bli 30–45 cm över medelvattenstånd.', region: 'Saltsjön' },
    ],
    events: [
      { kind: 'Water', title: 'Dagvattensystemet nära kapacitetsgräns, Sickla kanal', src: 'Stockholm Vatten', distM: 610, time: 'Sedan 11:20', sev: 'warning', dx: 5, dy: -2 },
      { kind: 'Traffic', title: 'Vägarbete på Hammarby Allé, ett körfält avstängt', src: 'Trafikverket', distM: 260, time: 'Till 21 nov', sev: 'monitor', dx: 2, dy: 2 },
      { kind: 'Traffic', title: 'Tvärbanan glesare trafik, Luma–Sickla', src: 'SL Trafikinfo', distM: 480, time: '15:00–20:00', sev: 'monitor', dx: -4, dy: 2 },
    ],
  },
  {
    slug: 'strandhuset', seed: 2, name: 'Strandhuset', address: 'Kungsholms Strand 147, 112 48 Stockholm', area: 'Kungsholmen', group: 'inner', lat: 59.3365, lng: 18.0335, status: 'monitor', type: 'Kontor', floors: 7, units: '42 hyresgäster',
    temp: 4.6, feels: 1.9, rain24: 11.2, wind: 7.1, gust: 12, dir: 240, hum: 84, aqi: 54, flood: 'Medium', fdist: 180, body: 'Karlbergssjön', lvl: 14, trend: 'Stabil', alerts: 1, risk: 44, sms: true, fac: [44, 52, 5, 22, 46],
    warnings: [
      { level: 'Yellow', type: 'Kraftigt regn', src: 'SMHI', start: t('06:00', THU), end: t('20:00', THU), summary: '15–25 mm regn inom 12 timmar. Risk för ytvatten i lågt liggande områden.', region: 'Stockholm · Innerstaden' },
    ],
    events: [
      { kind: 'Air', title: 'Förhöjd NO₂ längs Fleminggatan', src: 'SLB-analys', distM: 350, time: 'Sedan 10:40', sev: 'monitor', dx: 3, dy: -3 },
      { kind: 'Traffic', title: 'Barnhusbron avstängd för underhåll', src: 'Trafikverket', distM: 700, time: 'Till 30 nov', sev: 'monitor', dx: 6, dy: -1 },
    ],
  },
  {
    slug: 'gotgarden', seed: 3, name: 'Götgården', address: 'Götgatan 48, 118 26 Stockholm', area: 'Södermalm', group: 'inner', lat: 59.3135, lng: 18.0725, status: 'normal', type: 'Blandat ändamål', floors: 6, units: '64 lägenheter',
    temp: 4.4, feels: 1.5, rain24: 9.8, wind: 6.2, gust: 10, dir: 230, hum: 82, aqi: 38, flood: 'Low', fdist: 850, body: 'Saltsjön', lvl: 38, trend: 'Stigande +3 cm/h', alerts: 0, risk: 18, sms: true, fac: [30, 12, 4, 10, 20],
    warnings: [],
    events: [{ kind: 'Info', title: 'Planerat arbete på vattenledning, Åsögatan', src: 'Stockholm Vatten', distM: 420, time: 'mån 17 nov', sev: 'normal', dx: 3, dy: -2 }],
  },
  {
    slug: 'odenplan-atrium', seed: 4, name: 'Odenplan Atrium', address: 'Odengatan 65, 113 22 Stockholm', area: 'Vasastan', group: 'inner', lat: 59.3428, lng: 18.0468, status: 'normal', type: 'Kontor', floors: 8, units: '28 hyresgäster',
    temp: 4.0, feels: 1.2, rain24: 9.1, wind: 5.8, gust: 9, dir: 220, hum: 81, aqi: 42, flood: 'Low', fdist: 1200, body: 'Brunnsviken', lvl: 9, trend: 'Stabil', alerts: 0, risk: 22, sms: false, fac: [28, 6, 4, 24, 26],
    warnings: [],
    events: [{ kind: 'Traffic', title: 'Buss 4 omleds via Karlbergsvägen', src: 'SL Trafikinfo', distM: 150, time: 'Till 18:00', sev: 'monitor', dx: -2, dy: 1 }],
  },
  {
    slug: 'arenastaden-hus-c', seed: 5, name: 'Arenastaden Hus C', address: 'Evenemangsgatan 21, 169 79 Solna', area: 'Solna', group: 'outer', lat: 59.3705, lng: 18.0035, status: 'monitor', type: 'Kontor', floors: 12, units: '9 hyresgäster',
    temp: 3.6, feels: 0.2, rain24: 8.7, wind: 8.4, gust: 14, dir: 250, hum: 83, aqi: 47, flood: 'Low', fdist: 950, body: 'Brunnsviken', lvl: 9, trend: 'Stabil', alerts: 2, risk: 38, sms: true, fac: [40, 10, 6, 72, 30],
    warnings: [],
    events: [
      { kind: 'Traffic', title: 'Evenemang på arenan i kväll, räkna med tät trafik', src: 'Trafikverket', distM: 300, time: '17:00–23:00', sev: 'monitor', dx: 2, dy: -2 },
      { kind: 'Traffic', title: 'Körfält avstängt på E4 norrgående vid Haga', src: 'Trafikverket', distM: 1100, time: 'Sedan 12:57', sev: 'monitor', dx: 7, dy: -3 },
      { kind: 'Traffic', title: 'Förseningar i pendeltågstrafiken vid Solna station', src: 'SL Trafikinfo', distM: 800, time: 'Sedan 13:40', sev: 'monitor', dx: -5, dy: 3 },
    ],
  },
  {
    slug: 'augustendal-brygga', seed: 6, name: 'Augustendal Brygga', address: 'Augustendalsvägen 20, 131 52 Nacka Strand', area: 'Nacka Strand', group: 'outer', lat: 59.3172, lng: 18.1588, status: 'critical', type: 'Bostäder', floors: 10, units: '118 lägenheter',
    temp: 3.9, feels: -1.4, rain24: 22.1, wind: 14.2, gust: 25, dir: 200, hum: 90, aqi: 26, flood: 'High', fdist: 15, body: 'Saltsjön', lvl: 41, trend: 'Stigande +4 cm/h', alerts: 5, risk: 82, sms: true, fac: [88, 90, 40, 26, 14],
    warnings: [
      { level: 'Orange', type: 'Kraftig vind', src: 'SMHI', start: t('16:00'), end: t('10:00', THU), summary: 'Vindbyar på 21–25 m/s längs kusten. Risk för nedfallna träd, lösa föremål och störd färjetrafik.', region: 'Stockholms skärgård · Nacka' },
      { level: 'Yellow', type: 'Kraftigt regn', src: 'SMHI', start: t('06:00', THU), end: t('20:00', THU), summary: '20–30 mm inom 12 timmar i kustområden.', region: 'Nacka · Värmdö' },
    ],
    events: [
      { kind: 'Water', title: 'Risk för översvämning av kajen vid Augustendal brygga', src: 'Nacka kommun', distM: 60, time: 'I natt 22:00–04:00', sev: 'critical', dx: 1, dy: 2 },
      { kind: 'Crisis', title: 'Färjetrafiken inställd, Nacka Strand brygga', src: 'Krisinformation', distM: 90, time: 'Sedan 13:10', sev: 'warning', dx: -2, dy: 3 },
      { kind: 'Traffic', title: 'Nedfallet träd på Augustendalsvägen', src: 'Trafikverket', distM: 400, time: 'Sedan 14:02', sev: 'warning', dx: -4, dy: -2 },
    ],
  },
  {
    slug: 'torsviks-torg', seed: 7, name: 'Torsviks Torg', address: 'Torsvikssvängen 2, 181 34 Lidingö', area: 'Lidingö', group: 'outer', lat: 59.3655, lng: 18.1335, status: 'normal', type: 'Handel', floors: 4, units: '22 hyresgäster',
    temp: 3.7, feels: 0.4, rain24: 10.4, wind: 9.1, gust: 15, dir: 210, hum: 85, aqi: 24, flood: 'Low', fdist: 700, body: 'Lilla Värtan', lvl: 39, trend: 'Stigande +3 cm/h', alerts: 0, risk: 14, sms: true, fac: [36, 14, 2, 6, 10],
    warnings: [],
    events: [],
  },
  {
    slug: 'ulvsunda-lager', seed: 8, name: 'Ulvsunda Lager', address: 'Ulvsundavägen 106, 168 67 Bromma', area: 'Bromma', group: 'outer', lat: 59.3445, lng: 17.961, status: 'warning', type: 'Industri', floors: 3, units: '4 hyresgäster',
    temp: 3.1, feels: -0.6, rain24: 7.9, wind: 6.9, gust: 12, dir: 260, hum: 79, aqi: 96, flood: 'Low', fdist: 1500, body: 'Mälaren', lvl: 14, trend: 'Stabil', alerts: 3, risk: 57, sms: true, fac: [34, 8, 78, 28, 74],
    warnings: [
      { level: 'VMA', type: 'Viktigt meddelande till allmänheten — rök', src: 'Krisinformation', start: t('13:15'), end: null, summary: 'Stor brand på ett industriområde i Ulvsunda. Håll dörrar, fönster och ventilation stängda.', region: 'Bromma · Ulvsunda' },
    ],
    events: [
      { kind: 'Crisis', title: 'Industribrand, Ulvsunda industriområde', src: 'Räddningstjänsten', distM: 1400, time: 'Sedan 13:05', sev: 'warning', dx: 6, dy: 4 },
      { kind: 'Traffic', title: 'Ulvsundavägen avstängd vid Bällstavägen', src: 'Trafikverket', distM: 600, time: 'Sedan 13:30', sev: 'warning', dx: 3, dy: 3 },
      { kind: 'Weather', title: 'Risk för frost i natt, −3 °C', src: 'SMHI', distM: null, time: '02:00–07:00', sev: 'monitor', dx: -3, dy: -2 },
    ],
  },
];

const RAW_FEED: Array<{ t: string; title: string; src: string; sev: PropertyStatus; slug: string }> = [
  { t: '14:32', title: 'Orange varning — kraftig vind, byar upp till 25 m/s', src: 'SMHI', sev: 'critical', slug: 'augustendal-brygga' },
  { t: '14:05', title: 'Vattenståndet i Saltsjön +38 cm över medel och stigande', src: 'SMHI', sev: 'warning', slug: 'sjostaden-kaj' },
  { t: '13:48', title: 'Gräns för kraftigt regn överskriden — 12 mm på 3 h', src: 'Radar', sev: 'warning', slug: 'sjostaden-kaj' },
  { t: '13:20', title: 'VMA: industribrand, håll fönster och ventilation stängda', src: 'Krisinformation', sev: 'critical', slug: 'ulvsunda-lager' },
  { t: '13:10', title: 'Färjetrafiken inställd vid Nacka Strand brygga', src: 'Krisinformation', sev: 'warning', slug: 'augustendal-brygga' },
  { t: '12:57', title: 'Körfält avstängt på E4 norrgående vid Haga', src: 'Trafikverket', sev: 'monitor', slug: 'arenastaden-hus-c' },
  { t: '11:40', title: 'Förhöjd NO₂, måttlig luftkvalitet', src: 'SLB-analys', sev: 'monitor', slug: 'strandhuset' },
  { t: '10:15', title: 'Fastigheten ligger i karterad översvämningszon (15 m)', src: 'Länsstyrelsen', sev: 'warning', slug: 'augustendal-brygga' },
  { t: '09:02', title: 'Risk för frost i natt, −3 °C väntas', src: 'SMHI', sev: 'monitor', slug: 'ulvsunda-lager' },
  { t: '08:30', title: 'Gul varning hävd — vind', src: 'SMHI', sev: 'normal', slug: 'gotgarden' },
];

/* ------------------------------------------------------------------ */
/* Mapping raw design values → typed domain objects                    */
/* ------------------------------------------------------------------ */

const SOURCE_BY_LABEL: Record<string, SourceId> = {
  SMHI: 'smhi_warnings',
  'SMHI Oceanografi': 'smhi_oceanography',
  Krisinformation: 'krisinformation',
  Trafikverket: 'trafikverket',
  'SLB-analys': 'air_quality',
  Länsstyrelsen: 'mcf_flood',
};
const sourceFor = (label: string): SourceId => SOURCE_BY_LABEL[label] ?? 'demo_other';

export const demoPropertyId = (slug: string) => `demo-${slug}`;

function metric(
  propertyId: string,
  metricKey: MetricKey,
  value: number,
  unit: string,
  sourceId: SourceId,
  kind: EnvironmentalMetric['kind'],
  geo: EnvironmentalMetric['geo'] = { match: 'point_grid' },
): EnvironmentalMetric {
  return {
    propertyId,
    metricKey,
    value,
    unit,
    sourceId,
    kind,
    sourceTimestamp: DEMO_REFERENCE_TIME,
    fetchedAt: DEMO_REFERENCE_TIME,
    freshness: 'fresh',
    availability: 'ok',
    geo,
    origin: 'demo_fixture',
    qualityFlags: ['demo_fixture'],
  };
}

const RULE_TEMPLATES = [
  { code: 'RN', name: 'Kraftigt regn', cond: 'Mer än 15 mm på 24 h', sourceId: 'smhi_forecast', metricKey: 'weather.precipitation_24h', operator: 'gt', threshold: 15, unit: 'mm', window: '24h' },
  { code: 'WD', name: 'Vind över gränsvärde', cond: 'Byar över 18 m/s', sourceId: 'smhi_forecast', metricKey: 'weather.wind_gust', operator: 'gt', threshold: 18, unit: 'm/s', window: null },
  { code: 'OW', name: 'Officiell varningsnivå', cond: 'SMHI gul eller högre, alla VMA', sourceId: 'smhi_warnings', metricKey: 'warning.level', operator: 'any', threshold: null, unit: null, window: null },
  { code: 'CR', name: 'Lokal krishändelse', cond: 'Krisinformation inom 2 km', sourceId: 'krisinformation', metricKey: 'crisis.regional_publication', operator: 'any', threshold: null, unit: null, window: null },
  { code: 'FL', name: 'Ökad översvämningsrisk', cond: 'Vattennivå över +50 cm', sourceId: 'smhi_oceanography', metricKey: 'water.level_relative_to_mean', operator: 'gt', threshold: 50, unit: 'cm', window: null },
] as const;

function buildSnapshot(p: RawProperty): PropertySnapshot {
  const id = demoPropertyId(p.slug);
  const series = syntheticSeries({ seed: p.seed, temp: p.temp, rain24: p.rain24, wind: p.wind, hum: p.hum });
  const startMs = Date.parse(t('14:00'));
  const pts = (vals: number[]) => vals.map((value, i) => ({ validAt: new Date(startMs + i * 3600_000).toISOString(), value }));

  const warnings: OfficialWarning[] = p.warnings.map((w, i) => ({
    id: `${id}-warning-${i}`,
    sourceId: sourceFor(w.src),
    sourceLabel: w.src,
    externalId: null,
    level: w.level,
    type: w.type,
    summary: w.summary,
    region: w.region,
    validFrom: w.start,
    validTo: w.end,
    issuedAt: null,
    sourceUrl: null,
    geo: { match: 'polygon_intersection', note: 'Demodata – inte matchad mot ett officiellt varningsområde' },
    origin: 'demo_fixture',
  }));

  const events: GeographicEvent[] = p.events.map((e, i) => ({
    id: `${id}-event-${i}`,
    sourceId: sourceFor(e.src),
    sourceLabel: e.src,
    kind: 'source_event',
    category: e.kind,
    severity: e.sev === 'normal' ? 'info' : e.sev,
    title: e.title,
    location: { lat: p.lat + e.dy * 0.0014, lon: p.lng + e.dx * 0.0022 },
    geo: e.distM === null ? { match: 'municipality', distanceMeters: null, note: 'Publicerad för ett område' } : { match: 'within_radius', distanceMeters: e.distM },
    validFrom: null,
    validTo: null,
    timeLabel: e.time,
    sourceUrl: null,
    origin: 'demo_fixture',
  }));

  const alertRules: AlertRule[] = RULE_TEMPLATES.map((r, i) => ({
    id: `${id}-rule-${r.code.toLowerCase()}`,
    organizationId: DEMO_ORGANIZATION_ID,
    propertyId: id,
    code: r.code,
    name: r.name,
    conditionLabel: r.cond,
    sourceId: r.sourceId,
    metricKey: r.metricKey,
    operator: r.operator,
    threshold: r.threshold,
    unit: r.unit,
    aggregationWindow: r.window,
    channel: 'sms',
    // Default enablement copied from the design. Note: production defaults must be OFF (IMPLEMENTATION.md §15).
    enabled: i === 3 ? p.slug !== 'torsviks-torg' : i === 4 ? p.flood !== 'Low' : true,
    cooldownMinutes: 360,
    quietHours: { enabled: true, from: '22:00', to: '07:00', timezone: 'Europe/Stockholm' },
  }));

  const stationGeo = { match: 'nearest_station' as const, distanceMeters: null, note: 'Demodata – ingen station matchad' };

  return {
    property: {
      id,
      organizationId: DEMO_ORGANIZATION_ID,
      name: p.name,
      address: p.address,
      area: p.area,
      municipality: null,
      countyCode: '01',
      segment: p.group,
      location: { lat: p.lat, lon: p.lng },
      geocode: { provider: 'demo_fixture', precision: 'approximate', confirmedAt: null },
      building: { type: p.type, floors: p.floors, unitsLabel: p.units },
      status: p.status,
      statusReason: null,
      origin: 'demo_fixture',
    },
    metrics: [
      metric(id, 'weather.air_temperature', p.temp, '°C', 'smhi_forecast', 'forecast'),
      metric(id, 'weather.apparent_temperature', p.feels, '°C', 'smhi_forecast', 'derived_alert'),
      metric(id, 'weather.precipitation_24h', p.rain24, 'mm', 'smhi_forecast', 'forecast'),
      metric(id, 'weather.wind_speed', p.wind, 'm/s', 'smhi_forecast', 'forecast'),
      metric(id, 'weather.wind_gust', p.gust, 'm/s', 'smhi_forecast', 'forecast'),
      metric(id, 'weather.wind_direction', p.dir, '°', 'smhi_forecast', 'forecast'),
      metric(id, 'weather.relative_humidity', p.hum, '%', 'smhi_forecast', 'forecast'),
      metric(id, 'air_quality.index', p.aqi, 'index', 'air_quality', 'observation', stationGeo),
      metric(id, 'air_quality.pm25', Math.round(p.aqi * 0.22), 'µg/m³', 'air_quality', 'observation', stationGeo),
      metric(id, 'air_quality.no2', Math.round(p.aqi * 0.6), 'µg/m³', 'air_quality', 'observation', stationGeo),
    ],
    forecast: {
      propertyId: id,
      sourceId: 'smhi_forecast',
      issuedAt: DEMO_REFERENCE_TIME,
      fetchedAt: DEMO_REFERENCE_TIME,
      freshness: 'fresh',
      availability: 'ok',
      geo: { match: 'point_grid', note: 'Syntetisk demoserie' },
      origin: 'demo_fixture',
      series: [
        { metricKey: 'weather.air_temperature', unit: '°C', points: pts(series.temp) },
        { metricKey: 'weather.precipitation_1h', unit: 'mm', intervalNote: 'mm per timme (syntetisk)', points: pts(series.rain) },
        { metricKey: 'weather.wind_speed', unit: 'm/s', points: pts(series.wind) },
        { metricKey: 'weather.relative_humidity', unit: '%', points: pts(series.hum) },
      ],
    },
    warnings,
    events,
    flood: {
      propertyId: id,
      mapped: {
        sourceId: 'mcf_flood',
        exposureClass: p.flood,
        scenario: null,
        distanceToZoneMeters: p.fdist,
        availability: 'ok',
        geo: { match: 'within_radius', distanceMeters: p.fdist, note: 'Demodata – inget MCF-lager importerat' },
        origin: 'demo_fixture',
      },
      waterBody: {
        name: p.body,
        level: {
          value: p.lvl,
          unit: 'cm',
          sourceId: 'smhi_oceanography',
          kind: 'observation',
          sourceTimestamp: DEMO_REFERENCE_TIME,
          fetchedAt: DEMO_REFERENCE_TIME,
          freshness: 'fresh',
          availability: 'ok',
          geo: stationGeo,
          origin: 'demo_fixture',
          qualityFlags: ['demo_fixture'],
        },
        trendLabel: p.trend,
      },
    },
    alertRules,
    sms: { enabled: p.sms, recipientsLabel: '+46 70 ··· 42 18 och 1 till', recipientCount: 2 },
    activeAlertCount: p.alerts,
    demoRisk: {
      method: 'unspecified_demo_value',
      score: p.risk,
      factors: { weather: p.fac[0], water: p.fac[1], crisis: p.fac[2], traffic: p.fac[3], air: p.fac[4] },
    },
  };
}

// Demo uses the same documented method as live data (all demo sources count as current).
/*
 * Synthetic demo series for the radar nowcast, five calendar days and measured rainfall – one
 * per demo property so no panel shows "ej ansluten" in the demo. Values are invented but follow
 * the demo story (wet, windy November day; heavier rain towards Nacka). Labelled as demo in the UI.
 */
const DEMO_NOW = new Date(DEMO_REFERENCE_TIME);
/** 5-minute radar rate (mm/h) per demo property: [first wet step, last wet step, peak]; null = dry. */
const DEMO_RADAR: Array<[number, number, number] | null> = [
  [4, 17, 4], // Sjöstaden Kaj: rain in ~20 min, moderate
  [0, 6, 1.2], // Strandhuset: light rain now, easing within ~35 min
  null, // Götgården
  null, // Odenplan Atrium
  [9, 20, 1.5], // Arenastaden Hus C: light rain in ~45 min
  [0, 23, 5.5], // Augustendal Brygga: moderate rain now
  null, // Torsviks Torg
  [5, 14, 2], // Ulvsunda Lager: light rain in ~25 min
];
/** Mean 15-minute rainfall (mm) over the last 72 h per demo property. */
const DEMO_RAIN_15MIN = [0.13, 0.09, 0.05, 0.04, 0.07, 0.18, 0.06, 0.1];
const DEMO_DAY_RAIN = [7, 13, 3, 0.4, 1.5];

function demoNowcast(index: number) {
  const r = DEMO_RADAR[index] ?? null;
  const points = Array.from({ length: 24 }, (_, i) => ({
    validAt: new Date(DEMO_NOW.getTime() + i * 300_000).toISOString(),
    // A gentle ramp towards the peak in the middle of the spell.
    rateMmH: r && i >= r[0] && i <= r[1] ? Math.round(r[2] * (0.6 + 0.4 * Math.sin(((i - r[0] + 1) / (r[1] - r[0] + 2)) * Math.PI)) * 10) / 10 : 0,
  }));
  return {
    sourceId: 'met_nowcast' as const, coverage: 'ok' as const, updatedAt: DEMO_REFERENCE_TIME, fetchedAt: DEMO_REFERENCE_TIME, freshness: 'fresh' as const,
    points, summary: summarizeNowcast(points, DEMO_NOW, 5), attribution: 'Data från MET Norway · bearbetad av FastighetsRadar · syntetisk demo', origin: 'demo_fixture' as const,
  };
}

function demoDays(index: number) {
  const wet = 0.7 + (index % 4) * 0.15;
  return swedishDayWindows(DEMO_NOW, 5).map(({ from, to }, i) => ({
    from: from.toISOString(), to: to.toISOString(),
    temperatureMin: -1.5 + i * 0.5 - (index % 3) * 0.5, temperatureMax: 5 - i * 0.5 + (index % 2),
    precipitationMean: Math.round(DEMO_DAY_RAIN[i]! * wet * 10) / 10,
    precipitationMin: Math.round(DEMO_DAY_RAIN[i]! * wet * 0.4 * 10) / 10,
    precipitationMax: Math.round(DEMO_DAY_RAIN[i]! * wet * 1.7 * 10) / 10,
    windGustMax: 16 - i * 1.5 + (index % 3),
    snowPercent: i === 2 ? 30 : i === 1 && index % 2 ? 10 : 0,
  }));
}

function demoMeasuredRain(index: number) {
  const end = Math.floor(DEMO_NOW.getTime() / 900_000) * 900_000;
  const rainfall = Array.from({ length: 288 }, (_, i) => ({ observedAt: new Date(end - i * 900_000).toISOString(), value: DEMO_RAIN_15MIN[index] ?? 0.1 }));
  return {
    sourceId: 'smhi_observations' as const, stationName: 'Demo mätstation', distanceMeters: 800 + index * 350, observedAt: DEMO_REFERENCE_TIME, fetchedAt: DEMO_REFERENCE_TIME,
    qualityNote: 'Syntetisk demoserie, inga verkliga mätningar', totals: [1, 24, 72].map((h) => measuredPrecipitation(rainfall, DEMO_NOW, h)),
  };
}

const snapshots = RAW.map(buildSnapshot).map((s, index) => {
  if (s.forecast) s.forecast.days = demoDays(index);
  return { ...s, measuredRain: demoMeasuredRain(index), riskIndex: assessPropertyRisk(s, () => true), nowcast: demoNowcast(index) };
});

const feed: FeedItem[] = RAW_FEED.map((f, i) => ({
  id: `demo-feed-${i}`,
  publishedAt: t(f.t),
  title: f.title,
  sourceLabel: f.src,
  sourceId: sourceFor(f.src),
  severity: f.sev,
  propertyId: demoPropertyId(f.slug),
  origin: 'demo_fixture',
}));

export const demoPortfolio: Portfolio = {
  organizationId: DEMO_ORGANIZATION_ID,
  organizationName: 'Demoportfölj',
  generatedAt: DEMO_REFERENCE_TIME,
  origin: 'demo_fixture',
  regionLabel: 'Stockholmsregionen',
  segments: [
    { id: 'inner', label: 'Innerstad' },
    { id: 'outer', label: 'Förort & Kust' },
  ],
  properties: snapshots,
  feed,
  upcoming: [
    { id: 'u1', label: 'Kraftigt regn väntas', where: 'Nacka Strand och Hammarby', when: 'tors 13 nov · 06:00–20:00', value: '22 mm', tone: 'monitor', origin: 'demo_fixture' },
    { id: 'u2', label: 'Hårdast vind väntas', where: 'Augustendal Brygga', when: 'I natt · kulmen runt 03:00', value: '25 m/s', tone: 'critical', origin: 'demo_fixture' },
    { id: 'u3', label: 'Kallaste området', where: 'Bromma · Ulvsunda', when: 'tors 13 nov · 05:00', value: '−3,4°', tone: 'cold', origin: 'demo_fixture' },
    { id: 'u4', label: 'Nästa officiella varningsperiod', where: 'SMHI gul — kraftigt regn', when: 'Börjar tors 06:00 · 4 fastigheter', value: '15 h', tone: 'warning', origin: 'demo_fixture' },
  ],
  sources: [
    { sourceId: 'smhi_forecast', label: 'SMHI', status: 'demo', lastSuccessAt: null, lastCheckedAt: null, freshness: 'unknown', errorCode: null, note: 'Demodata' },
    { sourceId: 'krisinformation', label: 'Krisinformation', status: 'demo', lastSuccessAt: null, lastCheckedAt: null, freshness: 'unknown', errorCode: null, note: 'Demodata' },
    { sourceId: 'trafikverket', label: 'Trafikverket', status: 'demo', lastSuccessAt: null, lastCheckedAt: null, freshness: 'unknown', errorCode: null, note: 'Demodata' },
    { sourceId: 'air_quality', label: 'SLB-analys', status: 'demo', lastSuccessAt: null, lastCheckedAt: null, freshness: 'unknown', errorCode: null, note: 'Demodata' },
  ],
  narrative: {
    headline: 'Tre fastigheter behöver din uppmärksamhet i dag.',
    detail: 'Kustvind och stigande vattenstånd runt Nacka och Hammarby. Rökvarning gäller i Ulvsunda.',
  },
  demoTrends: {
    riskDeltaLabel: '+6 sedan igår',
    alertsDeltaLabel: '+5',
    alertsSince: 'sedan 08:00',
    alertsSparkWeights: [3, 5, 4, 6, 9, 8, 12, 11, 14],
  },
  viewer: { displayName: 'Elin Lindqvist', role: 'Förvaltare', initials: 'EL' },
};
