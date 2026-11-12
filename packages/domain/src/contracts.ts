import { z } from 'zod';
import {
  DataKindSchema,
  DataStatusSchema,
  GeoMatchSchema,
  IsoDateTimeSchema,
  SeveritySchema,
  SourceIdSchema,
} from './common';

/**
 * Normalised adapter output (IMPLEMENTATION.md §8). Every source adapter maps
 * upstream payloads to these shapes so UI and rule engine stay source-agnostic.
 */
export const DataPointSchema = z.object({
  propertyId: z.string(),
  sourceId: SourceIdSchema,
  metricKey: z.string(),
  kind: DataKindSchema,
  status: DataStatusSchema,
  value: z.union([z.number(), z.string(), z.boolean()]).nullable(),
  unit: z.string().nullable(),
  observedAt: IsoDateTimeSchema.nullable().optional(),
  issuedAt: IsoDateTimeSchema.nullable().optional(),
  validAt: IsoDateTimeSchema.nullable().optional(),
  fetchedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema.nullable().optional(),
  geoMatch: GeoMatchSchema,
  matchedDistanceMeters: z.number().nonnegative().nullable().optional(),
  coverageNote: z.string().optional(),
  attribution: z.string(),
  sourceUrl: z.string(),
  qualityFlags: z.array(z.string()),
});
export type DataPoint = z.infer<typeof DataPointSchema>;

export const MonitorEventSchema = z.object({
  id: z.string(),
  sourceId: SourceIdSchema,
  externalId: z.string(),
  type: z.string(),
  kind: z.enum(['official_warning', 'source_event', 'derived_alert']),
  severity: SeveritySchema,
  headline: z.string(),
  description: z.string().optional(),
  sourceUrl: z.string(),
  issuedAt: IsoDateTimeSchema.optional(),
  validFrom: IsoDateTimeSchema.optional(),
  validTo: IsoDateTimeSchema.optional(),
  /** GeoJSON geometry (WGS84, lon/lat order). Validated by the geo package later. */
  geometry: z.unknown().optional(),
  countyCodes: z.array(z.string()).optional(),
  qualityFlags: z.array(z.string()),
});
export type MonitorEvent = z.infer<typeof MonitorEventSchema>;

/** RFC 9457 problem details returned by the API for every error. */
export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export const HealthCheckSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error', 'skipped']),
  detail: z.string().optional(),
});

export const ReadinessResponseSchema = z.object({
  status: z.enum(['ready', 'degraded', 'not_ready']),
  version: z.string(),
  time: IsoDateTimeSchema,
  checks: z.record(z.string(), HealthCheckSchema),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
