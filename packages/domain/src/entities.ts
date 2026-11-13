import { NowcastSchema } from './nowcast';
import { z } from 'zod';
import {
  DataKindSchema,
  DataOriginSchema,
  DataStatusSchema,
  FreshnessSchema,
  GeographicRelevanceSchema,
  IsoDateTimeSchema,
  MeasurementSchema,
  PropertyStatusSchema,
  SeveritySchema,
  SourceIdSchema,
} from './common';
import { PropertyMonitoringContextSchema } from './monitoring';
import { RiskIndexSchema } from './risk-index';

/* ------------------------------------------------------------------ */
/* Property & portfolio                                                */
/* ------------------------------------------------------------------ */

export const LatLonSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type LatLon = z.infer<typeof LatLonSchema>;

export const PropertySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().min(1),
  /** Full confirmed street address. */
  address: z.string().min(1),
  /** District/area label shown in the UI (e.g. "Hammarby Sjöstad"). */
  area: z.string(),
  municipality: z.string().nullable().optional(),
  countyCode: z.string().nullable().optional(),
  /** Customer-defined portfolio segment used by the overview filter. */
  segment: z.string(),
  /** User-confirmed WGS84 point (EPSG:4326). An address point is not a property boundary. */
  location: LatLonSchema,
  geocode: z.object({
    provider: z.enum(['geoapify', 'manual_pin', 'demo_fixture']),
    precision: z.enum(['building', 'street', 'approximate', 'unknown']),
    confirmedAt: IsoDateTimeSchema.nullable(),
  }),
  /** Descriptive, customer-provided building facts (not fetched from any register). Null = not provided. */
  building: z
    .object({
      type: z.string(),
      floors: z.number().int().positive(),
      unitsLabel: z.string(),
    })
    .nullable(),
  status: PropertyStatusSchema,
  statusReason: z.string().nullable().optional(),
  origin: DataOriginSchema,
});
export type Property = z.infer<typeof PropertySchema>;

/* ------------------------------------------------------------------ */
/* Measurements                                                        */
/* ------------------------------------------------------------------ */

export const METRIC_KEYS = [
  'weather.air_temperature',
  'weather.apparent_temperature',
  'weather.precipitation_24h',
  /** Precipitation per forecast interval (mm per 1 h step) – used for the forecast chart. */
  'weather.precipitation_1h',
  'weather.precipitation_probability',
  'weather.thunder_probability',
  'weather.wind_speed',
  'weather.wind_gust',
  'weather.wind_direction',
  'weather.relative_humidity',
  'air_quality.index',
  'air_quality.pm25',
  'air_quality.no2',
  'air_quality.pm10',
  'air_quality.o3',
  'water.level_relative_to_mean',
] as const;
export const MetricKeySchema = z.enum(METRIC_KEYS);
export type MetricKey = z.infer<typeof MetricKeySchema>;

export const EnvironmentalMetricSchema = MeasurementSchema.extend({
  propertyId: z.string(),
  metricKey: MetricKeySchema,
});
export type EnvironmentalMetric = z.infer<typeof EnvironmentalMetricSchema>;

/* ------------------------------------------------------------------ */
/* Forecast time series                                                */
/* ------------------------------------------------------------------ */

export const ForecastPointSchema = z.object({
  validAt: IsoDateTimeSchema,
  value: z.number().nullable(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
});

export const ForecastDaySchema = z.object({
  from: IsoDateTimeSchema, to: IsoDateTimeSchema,
  temperatureMin: z.number().nullable(), temperatureMax: z.number().nullable(),
  precipitationMean: z.number().nullable(), precipitationMin: z.number().nullable(), precipitationMax: z.number().nullable(),
  windGustMax: z.number().nullable(), snowPercent: z.number().nullable(),
});

export const ForecastSeriesSchema = z.object({
  metricKey: MetricKeySchema,
  unit: z.string(),
  /** Documented meaning of each point, e.g. "mm per hour, non-overlapping intervals". */
  intervalNote: z.string().optional(),
  points: z.array(ForecastPointSchema),
});
export type ForecastSeries = z.infer<typeof ForecastSeriesSchema>;

export const WeatherForecastSchema = z.object({
  propertyId: z.string(),
  sourceId: SourceIdSchema,
  issuedAt: IsoDateTimeSchema.nullable(),
  fetchedAt: IsoDateTimeSchema.nullable(),
  freshness: FreshnessSchema,
  availability: DataStatusSchema,
  geo: GeographicRelevanceSchema,
  origin: DataOriginSchema,
  series: z.array(ForecastSeriesSchema),
  days: z.array(ForecastDaySchema).optional(),
});
export type WeatherForecast = z.infer<typeof WeatherForecastSchema>;

/* ------------------------------------------------------------------ */
/* Official warnings                                                   */
/* ------------------------------------------------------------------ */

/** Original warning levels as published (SMHI yellow/orange/red, VMA, informational). */
export const WarningLevelSchema = z.enum(['Yellow', 'Orange', 'Red', 'VMA', 'Info']);
export type WarningLevel = z.infer<typeof WarningLevelSchema>;

export const OfficialWarningSchema = z.object({
  id: z.string(),
  sourceId: SourceIdSchema,
  /** Name of the issuing authority as shown to users. */
  sourceLabel: z.string(),
  externalId: z.string().nullable(),
  level: WarningLevelSchema,
  /** Unmodified official headline/type. */
  type: z.string(),
  summary: z.string(),
  region: z.string(),
  validFrom: IsoDateTimeSchema.nullable(),
  /** `null` = until further notice. */
  validTo: IsoDateTimeSchema.nullable(),
  issuedAt: IsoDateTimeSchema.nullable(),
  sourceUrl: z.string().nullable(),
  geo: GeographicRelevanceSchema,
  origin: DataOriginSchema,
});
export type OfficialWarning = z.infer<typeof OfficialWarningSchema>;

/* ------------------------------------------------------------------ */
/* Geographic events (crisis, traffic, local notices)                  */
/* ------------------------------------------------------------------ */

export const EventCategorySchema = z.enum(['Crisis', 'Traffic', 'Water', 'Air', 'Weather', 'Info']);
export type EventCategory = z.infer<typeof EventCategorySchema>;

export const GeographicEventSchema = z.object({
  id: z.string(),
  sourceId: SourceIdSchema,
  sourceLabel: z.string(),
  kind: DataKindSchema,
  category: EventCategorySchema,
  severity: SeveritySchema,
  title: z.string(),
  location: LatLonSchema.nullable(),
  geo: GeographicRelevanceSchema,
  validFrom: IsoDateTimeSchema.nullable(),
  validTo: IsoDateTimeSchema.nullable(),
  /** Pre-formatted validity label (fixtures only; live data must derive it from validFrom/validTo). */
  timeLabel: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  origin: DataOriginSchema,
});
export type GeographicEvent = z.infer<typeof GeographicEventSchema>;

/* ------------------------------------------------------------------ */
/* Flood exposure & water                                              */
/* ------------------------------------------------------------------ */

export const ExposureClassSchema = z.enum(['High', 'Medium', 'Low', 'unknown']);
export type ExposureClass = z.infer<typeof ExposureClassSchema>;

export const FloodExposureSchema = z.object({
  propertyId: z.string(),
  /** Static mapped scenario exposure (MCF). This is NOT a current water level. */
  mapped: z.object({
    sourceId: SourceIdSchema,
    exposureClass: ExposureClassSchema,
    scenario: z.string().nullable(),
    distanceToZoneMeters: z.number().nonnegative().nullable(),
    availability: DataStatusSchema,
    geo: GeographicRelevanceSchema,
    origin: DataOriginSchema,
  }),
  /** Nearby water body level relative to mean (e.g. SMHI oceanography), when covered. */
  waterBody: z
    .object({
      name: z.string(),
      level: MeasurementSchema,
      trendLabel: z.string().nullable(),
    })
    .nullable(),
});
export type FloodExposure = z.infer<typeof FloodExposureSchema>;

/* ------------------------------------------------------------------ */
/* Data source status                                                  */
/* ------------------------------------------------------------------ */

export const SourceRuntimeStatusSchema = z.enum([
  'ok',
  'degraded',
  'stale',
  'source_unavailable',
  'access_required',
  'pending_access',
  'disabled',
  'not_implemented',
  'demo',
]);
export type SourceRuntimeStatus = z.infer<typeof SourceRuntimeStatusSchema>;

export const DataSourceStatusSchema = z.object({
  sourceId: SourceIdSchema,
  label: z.string(),
  status: SourceRuntimeStatusSchema,
  lastSuccessAt: IsoDateTimeSchema.nullable(),
  lastCheckedAt: IsoDateTimeSchema.nullable(),
  freshness: FreshnessSchema,
  errorCode: z.string().nullable(),
  note: z.string().nullable().optional(),
  /** Phase 3 runtime health (collector jobs). Optional so fixtures stay valid. */
  dataClass: z.string().optional(),
  expectedIntervalSeconds: z.number().int().positive().nullable().optional(),
  nextRunAt: IsoDateTimeSchema.nullable().optional(),
  lastErrorAt: IsoDateTimeSchema.nullable().optional(),
  attribution: z.string().optional(),
});
export type DataSourceStatus = z.infer<typeof DataSourceStatusSchema>;

/* ------------------------------------------------------------------ */
/* Alert rules                                                         */
/* ------------------------------------------------------------------ */

export const RuleOperatorSchema = z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'any']);

export const QuietHoursSchema = z.object({
  enabled: z.boolean(),
  from: z.string().regex(/^\d{2}:\d{2}$/),
  to: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string(),
});

export const AlertRuleSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  propertyId: z.string().nullable(),
  /** Two-letter code shown in the design (RN, WD, OW, CR, FL). */
  code: z.string().max(4),
  name: z.string(),
  conditionLabel: z.string(),
  sourceId: SourceIdSchema,
  metricKey: z.string(),
  operator: RuleOperatorSchema,
  threshold: z.number().nullable(),
  unit: z.string().nullable(),
  aggregationWindow: z.string().nullable(),
  channel: z.literal('sms'),
  enabled: z.boolean(),
  cooldownMinutes: z.number().int().nonnegative(),
  quietHours: QuietHoursSchema.nullable(),
});
export type AlertRule = z.infer<typeof AlertRuleSchema>;

/* ------------------------------------------------------------------ */
/* Demo-only presentation values                                       */
/* ------------------------------------------------------------------ */

/**
 * Legacy hand-picked demo values from before the risk method existed. Not displayed any more:
 * the dashboard shows `riskIndex` (docs/decisions/0003-riskindex.md) in both live and demo mode.
 */
export const DemoRiskAssessmentSchema = z.object({
  method: z.literal('unspecified_demo_value'),
  score: z.number().min(0).max(100),
  factors: z.object({
    weather: z.number(),
    water: z.number(),
    crisis: z.number(),
    traffic: z.number(),
    air: z.number(),
  }),
});
export type DemoRiskAssessment = z.infer<typeof DemoRiskAssessmentSchema>;

/* ------------------------------------------------------------------ */
/* Aggregates consumed by the dashboard                                */
/* ------------------------------------------------------------------ */

export const PropertySnapshotSchema = z.object({
  property: PropertySchema,
  metrics: z.array(EnvironmentalMetricSchema),
  forecast: WeatherForecastSchema.nullable(),
  warnings: z.array(OfficialWarningSchema),
  events: z.array(GeographicEventSchema),
  flood: FloodExposureSchema,
  alertRules: z.array(AlertRuleSchema),
  sms: z.object({
    enabled: z.boolean(),
    /** Masked recipient summary – never a full phone number. */
    recipientsLabel: z.string(),
    recipientCount: z.number().int().nonnegative(),
  }),
  activeAlertCount: z.number().int().nonnegative(),
  demoRisk: DemoRiskAssessmentSchema.nullable(),
  /** Riskindex v1 (docs/decisions/0003-riskindex.md). Absent in old payloads. */
  riskIndex: RiskIndexSchema.nullable().optional(),
  /** Live monitoring context (Phase 3). Absent in demo fixtures. */
  monitoring: PropertyMonitoringContextSchema.nullable().optional(),
  nowcast: NowcastSchema.nullable().optional(),
});
export type PropertySnapshot = z.infer<typeof PropertySnapshotSchema>;

export const FeedItemSchema = z.object({
  id: z.string(),
  publishedAt: IsoDateTimeSchema,
  title: z.string(),
  sourceLabel: z.string(),
  sourceId: SourceIdSchema,
  severity: PropertyStatusSchema,
  propertyId: z.string(),
  origin: DataOriginSchema,
});
export type FeedItem = z.infer<typeof FeedItemSchema>;

export const UpcomingConditionSchema = z.object({
  id: z.string(),
  label: z.string(),
  where: z.string(),
  when: z.string(),
  value: z.string(),
  tone: z.enum(['monitor', 'critical', 'warning', 'cold']),
  explanation: z.string().optional(),
  sourceId: SourceIdSchema.optional(),
  validAt: IsoDateTimeSchema.optional(),
  origin: DataOriginSchema,
});
export type UpcomingCondition = z.infer<typeof UpcomingConditionSchema>;

export const PortfolioSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  /** Snapshot reference time (source clock for demo data). */
  generatedAt: IsoDateTimeSchema,
  origin: DataOriginSchema,
  regionLabel: z.string(),
  segments: z.array(z.object({ id: z.string(), label: z.string() })),
  properties: z.array(PropertySnapshotSchema),
  feed: z.array(FeedItemSchema),
  upcoming: z.array(UpcomingConditionSchema),
  sources: z.array(DataSourceStatusSchema),
  /** Free-text narrative shown on the hero card (demo copy from the approved design). */
  narrative: z.object({ headline: z.string(), detail: z.string() }).nullable(),
  /** Demo-only trend annotations ("+6 since yesterday" etc.). Null in live mode until history exists. */
  demoTrends: z
    .object({
      riskDeltaLabel: z.string(),
      alertsDeltaLabel: z.string(),
      alertsSince: z.string(),
      alertsSparkWeights: z.array(z.number()),
    })
    .nullable(),
  viewer: z.object({ displayName: z.string(), role: z.string(), initials: z.string() }),
});
export type Portfolio = z.infer<typeof PortfolioSchema>;
