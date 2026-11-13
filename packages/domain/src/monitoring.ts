import { z } from 'zod';
import { FreshnessSchema, IsoDateTimeSchema, SeveritySchema, SourceIdSchema } from './common';

/**
 * Phase 3 normalised monitoring contract (Agent 3).
 *
 * Every value collected from a public provider is assigned exactly ONE data class and keeps
 * full provenance. The classes are never mixed in the UI: a forecast is not an observation,
 * an official warning is not a public event, and static/statistical context never raises alerts.
 */
export const DATA_CLASSES = ['FORECAST', 'OBSERVATION', 'OFFICIAL_WARNING', 'PUBLIC_EVENT', 'STATIC_GEODATA', 'REGIONAL_STATISTIC'] as const;
export const DataClassSchema = z.enum(DATA_CLASSES);
export type DataClass = z.infer<typeof DataClassSchema>;

/** Provenance carried by every normalised record. */
export const ProvenanceSchema = z.object({
  sourceId: SourceIdSchema,
  dataClass: DataClassSchema,
  /** Name of the publishing authority, e.g. "SMHI". */
  authority: z.string(),
  attribution: z.string(),
  sourceUrl: z.string().nullable(),
  /** Source clock: issued / observed / published / model reference time. */
  sourceTimestamp: IsoDateTimeSchema.nullable(),
  /** Our clock: when FastighetsRadar fetched it. */
  fetchedAt: IsoDateTimeSchema,
  freshness: FreshnessSchema,
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/* ------------------------------------------------------------------ */
/* Nearby station observations (MetObs, air quality)                   */
/* ------------------------------------------------------------------ */

export const NearbyObservationSchema = z.object({
  parameter: z.string(),
  /** Swedish display label, e.g. "Lufttemperatur". */
  label: z.string(),
  value: z.number().nullable(),
  unit: z.string().nullable(),
  stationId: z.string(),
  stationName: z.string(),
  distanceMeters: z.number().nonnegative(),
  observedAt: IsoDateTimeSchema.nullable(),
  /** Upstream quality code (SMHI: G = controlled, Y = suspect/aggregated; air: preliminary). */
  quality: z.string().nullable(),
  qualityFlags: z.array(z.string()),
  provenance: ProvenanceSchema,
});
export type NearbyObservation = z.infer<typeof NearbyObservationSchema>;

/* ------------------------------------------------------------------ */
/* Groundwater (SGU HYPE model, 4×4 km areas)                          */
/* ------------------------------------------------------------------ */

export const GroundwaterContextSchema = z.object({
  areaId: z.string(),
  date: z.string(),
  /** 0–100 percentile vs. all modelled levels; null when not applicable (SGU −1). */
  fillSmall: z.number().nullable(),
  fillLarge: z.number().nullable(),
  /** 0–100 percentile vs. the same time of year. */
  situationSmall: z.number().nullable(),
  situationLarge: z.number().nullable(),
  note: z.string(),
  provenance: ProvenanceSchema,
});
export type GroundwaterContext = z.infer<typeof GroundwaterContextSchema>;

/* ------------------------------------------------------------------ */
/* Static flood scenarios (MCF)                                        */
/* ------------------------------------------------------------------ */

export const FloodScenarioKeySchema = z.enum(['q100', 'q200', 'bhf']);
export const FloodScenarioResultSchema = z.object({
  scenario: FloodScenarioKeySchema,
  /** Swedish label, e.g. "100-årsflöde". */
  label: z.string(),
  /** Whether the property point lies inside (within ~15 m of) a mapped area. */
  inside: z.boolean(),
  /** Smallest probed search radius that intersects a mapped area; null = none within the max radius. */
  withinMeters: z.number().nullable(),
});
export const FloodContextSchema = z.object({
  scenarios: z.array(FloodScenarioResultSchema),
  maxRadiusMeters: z.number(),
  datasetVersion: z.string().nullable(),
  note: z.string(),
  provenance: ProvenanceSchema,
});
export type FloodContext = z.infer<typeof FloodContextSchema>;

/* ------------------------------------------------------------------ */
/* Regional statistics (SCB)                                           */
/* ------------------------------------------------------------------ */

export const RegionalStatisticSchema = z.object({
  regionCode: z.string(),
  regionName: z.string(),
  tableId: z.string(),
  period: z.string(),
  values: z.array(z.object({ key: z.string(), label: z.string(), value: z.number().nullable(), unit: z.string() })),
  note: z.string(),
  provenance: ProvenanceSchema,
});
export type RegionalStatistic = z.infer<typeof RegionalStatisticSchema>;

/* ------------------------------------------------------------------ */
/* Per-property monitoring context (attached to PropertySnapshot)      */
/* ------------------------------------------------------------------ */

export const PropertyMonitoringContextSchema = z.object({
  county: z.object({ code: z.string(), name: z.string() }).nullable(),
  observations: z.array(NearbyObservationSchema),
  airQuality: z.array(NearbyObservationSchema),
  groundwater: GroundwaterContextSchema.nullable(),
  flood: FloodContextSchema.nullable(),
  statistics: RegionalStatisticSchema.nullable(),
  /** How the property status was derived (documented, transparent; never a risk score). */
  statusMethod: z.literal('highest_official_warning'),
  /** Per-source availability for THIS property (coverage can differ from global source health). */
  coverage: z.array(
    z.object({
      sourceId: SourceIdSchema,
      status: z.enum(['ok', 'no_coverage', 'stale', 'source_unavailable', 'not_applicable', 'unknown', 'loading']),
      note: z.string().nullable(),
    }),
  ),
});
export type PropertyMonitoringContext = z.infer<typeof PropertyMonitoringContextSchema>;

/* ------------------------------------------------------------------ */
/* Change events (dedup log – future SMS input) and live stream        */
/* ------------------------------------------------------------------ */

export const MonitoringChangeSchema = z.object({
  id: z.string(),
  propertyId: z.string(),
  sourceId: SourceIdSchema,
  changeType: z.enum(['new', 'updated', 'ended', 'cancelled']),
  dataClass: DataClassSchema,
  severity: SeveritySchema,
  headline: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type MonitoringChange = z.infer<typeof MonitoringChangeSchema>;

/** Payload of the `update` SSE event – a hint to refetch, never the data itself. */
export const StreamUpdateSchema = z.object({
  at: IsoDateTimeSchema,
  sources: z.array(SourceIdSchema),
  propertyIds: z.array(z.string()),
  changes: z.number().int().nonnegative(),
});
export type StreamUpdate = z.infer<typeof StreamUpdateSchema>;
