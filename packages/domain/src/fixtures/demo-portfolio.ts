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
    slug: 'sjostaden-kaj', seed: 1, name: 'Sjöstaden Kaj', address: 'Hammarby Kaj 12, 120 30 Stockholm', area: 'Hammarby Sjöstad', group: 'inner', lat: 59.3036, lng: 18.1028, status: 'warning', type: 'Residential', floors: 9, units: '146 units',
    temp: 4.2, feels: 0.8, rain24: 18.4, wind: 9.6, gust: 16, dir: 225, hum: 88, aqi: 31, flood: 'High', fdist: 40, body: 'Saltsjön', lvl: 38, trend: 'Rising +3 cm/h', alerts: 3, risk: 68, sms: true, fac: [62, 84, 8, 30, 18],
    warnings: [
      { level: 'Yellow', type: 'Heavy rain', src: 'SMHI', start: t('06:00', THU), end: t('20:00', THU), summary: '15–25 mm of rain within 12 hours. Risk of surface water on streets and in low-lying basements.', region: 'Stockholm · Inner city' },
      { level: 'Info', type: 'High sea level', src: 'SMHI Oceanografi', start: t('12:00'), end: t('00:00', FRI), summary: 'Sea level in Saltsjön expected 30–45 cm above mean.', region: 'Saltsjön' },
    ],
    events: [
      { kind: 'Water', title: 'Storm drain capacity alert, Sickla kanal', src: 'Stockholm Vatten', distM: 610, time: 'Since 11:20', sev: 'warning', dx: 5, dy: -2 },
      { kind: 'Traffic', title: 'Roadworks on Hammarby Allé, one lane closed', src: 'Trafikverket', distM: 260, time: 'Until 21 Nov', sev: 'monitor', dx: 2, dy: 2 },
      { kind: 'Traffic', title: 'Tvärbanan service reduced, Luma–Sickla', src: 'SL Trafikinfo', distM: 480, time: '15:00–20:00', sev: 'monitor', dx: -4, dy: 2 },
    ],
  },
  {
    slug: 'strandhuset', seed: 2, name: 'Strandhuset', address: 'Kungsholms Strand 147, 112 48 Stockholm', area: 'Kungsholmen', group: 'inner', lat: 59.3365, lng: 18.0335, status: 'monitor', type: 'Office', floors: 7, units: '42 tenants',
    temp: 4.6, feels: 1.9, rain24: 11.2, wind: 7.1, gust: 12, dir: 240, hum: 84, aqi: 54, flood: 'Medium', fdist: 180, body: 'Karlbergssjön', lvl: 14, trend: 'Stable', alerts: 1, risk: 44, sms: true, fac: [44, 52, 5, 22, 46],
    warnings: [
      { level: 'Yellow', type: 'Heavy rain', src: 'SMHI', start: t('06:00', THU), end: t('20:00', THU), summary: '15–25 mm of rain within 12 hours. Risk of surface water in low-lying areas.', region: 'Stockholm · Inner city' },
    ],
    events: [
      { kind: 'Air', title: 'Elevated NO₂ along Fleminggatan', src: 'SLB-analys', distM: 350, time: 'Since 10:40', sev: 'monitor', dx: 3, dy: -3 },
      { kind: 'Traffic', title: 'Barnhusbron closed for maintenance', src: 'Trafikverket', distM: 700, time: 'Until 30 Nov', sev: 'monitor', dx: 6, dy: -1 },
    ],
  },
  {
    slug: 'gotgarden', seed: 3, name: 'Götgården', address: 'Götgatan 48, 118 26 Stockholm', area: 'Södermalm', group: 'inner', lat: 59.3135, lng: 18.0725, status: 'normal', type: 'Mixed use', floors: 6, units: '64 units',
    temp: 4.4, feels: 1.5, rain24: 9.8, wind: 6.2, gust: 10, dir: 230, hum: 82, aqi: 38, flood: 'Low', fdist: 850, body: 'Saltsjön', lvl: 38, trend: 'Rising +3 cm/h', alerts: 0, risk: 18, sms: true, fac: [30, 12, 4, 10, 20],
    warnings: [],
    events: [{ kind: 'Info', title: 'Planned water main work on Åsögatan', src: 'Stockholm Vatten', distM: 420, time: 'Mon 17 Nov', sev: 'normal', dx: 3, dy: -2 }],
  },
  {
    slug: 'odenplan-atrium', seed: 4, name: 'Odenplan Atrium', address: 'Odengatan 65, 113 22 Stockholm', area: 'Vasastan', group: 'inner', lat: 59.3428, lng: 18.0468, status: 'normal', type: 'Office', floors: 8, units: '28 tenants',
    temp: 4.0, feels: 1.2, rain24: 9.1, wind: 5.8, gust: 9, dir: 220, hum: 81, aqi: 42, flood: 'Low', fdist: 1200, body: 'Brunnsviken', lvl: 9, trend: 'Stable', alerts: 0, risk: 22, sms: false, fac: [28, 6, 4, 24, 26],
    warnings: [],
    events: [{ kind: 'Traffic', title: 'Bus 4 diverted via Karlbergsvägen', src: 'SL Trafikinfo', distM: 150, time: 'Until 18:00', sev: 'monitor', dx: -2, dy: 1 }],
  },
  {
    slug: 'arenastaden-hus-c', seed: 5, name: 'Arenastaden Hus C', address: 'Evenemangsgatan 21, 169 79 Solna', area: 'Solna', group: 'outer', lat: 59.3705, lng: 18.0035, status: 'monitor', type: 'Office', floors: 12, units: '9 tenants',
    temp: 3.6, feels: 0.2, rain24: 8.7, wind: 8.4, gust: 14, dir: 250, hum: 83, aqi: 47, flood: 'Low', fdist: 950, body: 'Brunnsviken', lvl: 9, trend: 'Stable', alerts: 2, risk: 38, sms: true, fac: [40, 10, 6, 72, 30],
    warnings: [],
    events: [
      { kind: 'Traffic', title: 'Arena event tonight, expect heavy congestion', src: 'Trafikverket', distM: 300, time: '17:00–23:00', sev: 'monitor', dx: 2, dy: -2 },
      { kind: 'Traffic', title: 'Lane closure on E4 northbound at Haga', src: 'Trafikverket', distM: 1100, time: 'Since 12:57', sev: 'monitor', dx: 7, dy: -3 },
      { kind: 'Traffic', title: 'Commuter train delays at Solna station', src: 'SL Trafikinfo', distM: 800, time: 'Since 13:40', sev: 'monitor', dx: -5, dy: 3 },
    ],
  },
  {
    slug: 'augustendal-brygga', seed: 6, name: 'Augustendal Brygga', address: 'Augustendalsvägen 20, 131 52 Nacka Strand', area: 'Nacka Strand', group: 'outer', lat: 59.3172, lng: 18.1588, status: 'critical', type: 'Residential', floors: 10, units: '118 units',
    temp: 3.9, feels: -1.4, rain24: 22.1, wind: 14.2, gust: 25, dir: 200, hum: 90, aqi: 26, flood: 'High', fdist: 15, body: 'Saltsjön', lvl: 41, trend: 'Rising +4 cm/h', alerts: 5, risk: 82, sms: true, fac: [88, 90, 40, 26, 14],
    warnings: [
      { level: 'Orange', type: 'Strong wind', src: 'SMHI', start: t('16:00'), end: t('10:00', THU), summary: 'Gusts of 21–25 m/s along the coast. Risk of falling trees, loose objects and disrupted ferry traffic.', region: 'Stockholm archipelago · Nacka' },
      { level: 'Yellow', type: 'Heavy rain', src: 'SMHI', start: t('06:00', THU), end: t('20:00', THU), summary: '20–30 mm within 12 hours in coastal areas.', region: 'Nacka · Värmdö' },
    ],
    events: [
      { kind: 'Water', title: 'Quay flooding risk at Augustendal pier', src: 'Nacka kommun', distM: 60, time: 'Tonight 22:00–04:00', sev: 'critical', dx: 1, dy: 2 },
      { kind: 'Crisis', title: 'Ferry traffic suspended, Nacka Strand pier', src: 'Krisinformation', distM: 90, time: 'Since 13:10', sev: 'warning', dx: -2, dy: 3 },
      { kind: 'Traffic', title: 'Fallen tree on Augustendalsvägen', src: 'Trafikverket', distM: 400, time: 'Since 14:02', sev: 'warning', dx: -4, dy: -2 },
    ],
  },
  {
    slug: 'torsviks-torg', seed: 7, name: 'Torsviks Torg', address: 'Torsvikssvängen 2, 181 34 Lidingö', area: 'Lidingö', group: 'outer', lat: 59.3655, lng: 18.1335, status: 'normal', type: 'Retail', floors: 4, units: '22 tenants',
    temp: 3.7, feels: 0.4, rain24: 10.4, wind: 9.1, gust: 15, dir: 210, hum: 85, aqi: 24, flood: 'Low', fdist: 700, body: 'Lilla Värtan', lvl: 39, trend: 'Rising +3 cm/h', alerts: 0, risk: 14, sms: true, fac: [36, 14, 2, 6, 10],
    warnings: [],
    events: [],
  },
  {
    slug: 'ulvsunda-lager', seed: 8, name: 'Ulvsunda Lager', address: 'Ulvsundavägen 106, 168 67 Bromma', area: 'Bromma', group: 'outer', lat: 59.3445, lng: 17.961, status: 'warning', type: 'Industrial', floors: 3, units: '4 tenants',
    temp: 3.1, feels: -0.6, rain24: 7.9, wind: 6.9, gust: 12, dir: 260, hum: 79, aqi: 96, flood: 'Low', fdist: 1500, body: 'Mälaren', lvl: 14, trend: 'Stable', alerts: 3, risk: 57, sms: true, fac: [34, 8, 78, 28, 74],
    warnings: [
      { level: 'VMA', type: 'Important public announcement — smoke', src: 'Krisinformation', start: t('13:15'), end: null, summary: 'Large fire at an industrial site in Ulvsunda. Keep doors, windows and ventilation closed.', region: 'Bromma · Ulvsunda' },
    ],
    events: [
      { kind: 'Crisis', title: 'Industrial fire, Ulvsunda industrial area', src: 'Räddningstjänsten', distM: 1400, time: 'Since 13:05', sev: 'warning', dx: 6, dy: 4 },
      { kind: 'Traffic', title: 'Ulvsundavägen closed near Bällstavägen', src: 'Trafikverket', distM: 600, time: 'Since 13:30', sev: 'warning', dx: 3, dy: 3 },
      { kind: 'Weather', title: 'Frost risk tonight, −3 °C', src: 'SMHI', distM: null, time: '02:00–07:00', sev: 'monitor', dx: -3, dy: -2 },
    ],
  },
];

const RAW_FEED: Array<{ t: string; title: string; src: string; sev: PropertyStatus; slug: string }> = [
  { t: '14:32', title: 'Orange warning — strong wind, gusts up to 25 m/s', src: 'SMHI', sev: 'critical', slug: 'augustendal-brygga' },
  { t: '14:05', title: 'Sea level in Saltsjön +38 cm above mean and rising', src: 'SMHI', sev: 'warning', slug: 'sjostaden-kaj' },
  { t: '13:48', title: 'Heavy rain threshold exceeded — 12 mm in 3 h', src: 'Radar', sev: 'warning', slug: 'sjostaden-kaj' },
  { t: '13:20', title: 'VMA: industrial fire, keep windows and ventilation closed', src: 'Krisinformation', sev: 'critical', slug: 'ulvsunda-lager' },
  { t: '13:10', title: 'Ferry traffic suspended at Nacka Strand pier', src: 'Krisinformation', sev: 'warning', slug: 'augustendal-brygga' },
  { t: '12:57', title: 'Lane closure on E4 northbound at Haga', src: 'Trafikverket', sev: 'monitor', slug: 'arenastaden-hus-c' },
  { t: '11:40', title: 'Elevated NO₂, moderate air quality', src: 'SLB-analys', sev: 'monitor', slug: 'strandhuset' },
  { t: '10:15', title: 'Property inside mapped flood-risk zone (15 m)', src: 'Länsstyrelsen', sev: 'warning', slug: 'augustendal-brygga' },
  { t: '09:02', title: 'Frost risk overnight, −3 °C expected', src: 'SMHI', sev: 'monitor', slug: 'ulvsunda-lager' },
  { t: '08:30', title: 'Yellow warning lifted — wind', src: 'SMHI', sev: 'normal', slug: 'gotgarden' },
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
  { code: 'RN', name: 'Heavy rain', cond: 'More than 15 mm in 24 h', sourceId: 'smhi_forecast', metricKey: 'weather.precipitation_24h', operator: 'gt', threshold: 15, unit: 'mm', window: '24h' },
  { code: 'WD', name: 'Wind above threshold', cond: 'Gusts above 18 m/s', sourceId: 'smhi_forecast', metricKey: 'weather.wind_gust', operator: 'gt', threshold: 18, unit: 'm/s', window: null },
  { code: 'OW', name: 'Official warning level', cond: 'SMHI Yellow or higher, any VMA', sourceId: 'smhi_warnings', metricKey: 'warning.level', operator: 'any', threshold: null, unit: null, window: null },
  { code: 'CR', name: 'Local crisis event', cond: 'Krisinformation event within 2 km', sourceId: 'krisinformation', metricKey: 'crisis.regional_publication', operator: 'any', threshold: null, unit: null, window: null },
  { code: 'FL', name: 'Flood risk escalation', cond: 'Water level above +50 cm', sourceId: 'smhi_oceanography', metricKey: 'water.level_relative_to_mean', operator: 'gt', threshold: 50, unit: 'cm', window: null },
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
    geo: { match: 'polygon_intersection', note: 'Demo fixture – not matched against an official warning area' },
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
    geo: e.distM === null ? { match: 'municipality', distanceMeters: null, note: 'Area-level publication' } : { match: 'within_radius', distanceMeters: e.distM },
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

  const stationGeo = { match: 'nearest_station' as const, distanceMeters: null, note: 'Demo fixture – no station matched' };

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
      geo: { match: 'point_grid', note: 'Synthetic demo series' },
      origin: 'demo_fixture',
      series: [
        { metricKey: 'weather.air_temperature', unit: '°C', points: pts(series.temp) },
        { metricKey: 'weather.precipitation_24h', unit: 'mm', intervalNote: 'mm per hour (synthetic)', points: pts(series.rain) },
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
        geo: { match: 'within_radius', distanceMeters: p.fdist, note: 'Demo fixture – no MCF layer imported' },
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
    sms: { enabled: p.sms, recipientsLabel: '+46 70 ··· 42 18 and 1 more', recipientCount: 2 },
    activeAlertCount: p.alerts,
    demoRisk: {
      method: 'unspecified_demo_value',
      score: p.risk,
      factors: { weather: p.fac[0], water: p.fac[1], crisis: p.fac[2], traffic: p.fac[3], air: p.fac[4] },
    },
  };
}

const snapshots = RAW.map(buildSnapshot);

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
  organizationName: 'Demo portfolio',
  generatedAt: DEMO_REFERENCE_TIME,
  origin: 'demo_fixture',
  regionLabel: 'Stockholm region',
  segments: [
    { id: 'inner', label: 'Innerstad' },
    { id: 'outer', label: 'Förort & Kust' },
  ],
  properties: snapshots,
  feed,
  upcoming: [
    { id: 'u1', label: 'Heavy rain expected', where: 'Nacka Strand & Hammarby', when: 'Thu 13 Nov · 06:00–20:00', value: '22 mm', tone: 'monitor', origin: 'demo_fixture' },
    { id: 'u2', label: 'Strongest wind expected', where: 'Augustendal Brygga', when: 'Tonight · peak around 03:00', value: '25 m/s', tone: 'critical', origin: 'demo_fixture' },
    { id: 'u3', label: 'Coldest property region', where: 'Bromma · Ulvsunda', when: 'Thu 13 Nov · 05:00', value: '−3.4°', tone: 'cold', origin: 'demo_fixture' },
    { id: 'u4', label: 'Next official warning window', where: 'SMHI Yellow — heavy rain', when: 'Starts Thu 06:00 · 4 properties', value: '15 h', tone: 'warning', origin: 'demo_fixture' },
  ],
  sources: [
    { sourceId: 'smhi_forecast', label: 'SMHI', status: 'demo', lastSuccessAt: null, lastCheckedAt: null, freshness: 'unknown', errorCode: null, note: 'Demo fixture' },
    { sourceId: 'krisinformation', label: 'Krisinformation', status: 'demo', lastSuccessAt: null, lastCheckedAt: null, freshness: 'unknown', errorCode: null, note: 'Demo fixture' },
    { sourceId: 'trafikverket', label: 'Trafikverket', status: 'demo', lastSuccessAt: null, lastCheckedAt: null, freshness: 'unknown', errorCode: null, note: 'Demo fixture' },
    { sourceId: 'air_quality', label: 'SLB-analys', status: 'demo', lastSuccessAt: null, lastCheckedAt: null, freshness: 'unknown', errorCode: null, note: 'Demo fixture' },
  ],
  narrative: {
    headline: 'Three properties need your attention today.',
    detail: 'Coastal wind and rising sea level around Nacka and Hammarby. Smoke advisory active in Ulvsunda.',
  },
  demoTrends: {
    riskDeltaLabel: '+6 since yesterday',
    alertsDeltaLabel: '+5',
    alertsSince: 'since 08:00',
    alertsSparkWeights: [3, 5, 4, 6, 9, 8, 12, 11, 14],
  },
  viewer: { displayName: 'Elin Lindqvist', role: 'Portfolio Manager', initials: 'EL' },
};
