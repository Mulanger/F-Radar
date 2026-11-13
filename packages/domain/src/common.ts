import { z } from 'zod';

/**
 * Shared vocabulary for every value FastighetsRadar shows.
 * See IMPLEMENTATION.md §8 (standardised data contracts).
 *
 * Principles encoded here:
 *  - Missing data is `unknown`/`no_coverage`, never an implicit "normal" or 0.
 *  - Forecast ≠ observation ≠ official warning ≠ static exposure.
 *  - Every value carries its source, timestamps, freshness and geographic relevance.
 *  - Demo fixtures are tagged `origin: 'demo_fixture'` and must never be served as live data.
 */

export const SOURCE_IDS = [
  'smhi_forecast',
  'smhi_warnings',
  'smhi_observations',
  'smhi_oceanography',
  'smhi_hydrology',
  'met_nowcast',
  'krisinformation',
  'air_quality',
  'sgu_groundwater',
  'mcf_flood',
  'scb',
  'trafikverket',
  'geoapify_geocoding',
  'lantmateriet_address',
  'boverket_energy',
  'sms_46elks',
  /** Placeholder for demo-only sources shown in the approved design (e.g. municipal notices). */
  'demo_other',
] as const;
export const SourceIdSchema = z.enum(SOURCE_IDS);
export type SourceId = z.infer<typeof SourceIdSchema>;

export const DataStatusSchema = z.enum([
  'ok',
  'loading',
  'no_coverage',
  'stale',
  'source_unavailable',
  'access_required',
  'not_applicable',
  'unknown',
]);
export type DataStatus = z.infer<typeof DataStatusSchema>;

export const DataKindSchema = z.enum([
  'forecast',
  'observation',
  'official_warning',
  'derived_alert',
  'static_exposure',
  'statistics',
  'source_event',
]);
export type DataKind = z.infer<typeof DataKindSchema>;

export const GeoMatchSchema = z.enum([
  'point_grid',
  'polygon_intersection',
  'within_radius',
  'nearest_station',
  'county',
  'municipality',
  'not_matched',
]);
export type GeoMatch = z.infer<typeof GeoMatchSchema>;

/** How current a value is relative to its expected update cadence. */
export const FreshnessSchema = z.enum(['fresh', 'stale', 'expired', 'unknown']);
export type Freshness = z.infer<typeof FreshnessSchema>;

/** Where a value came from. `demo_fixture` values must never be presented as real. */
export const DataOriginSchema = z.enum(['live', 'demo_fixture']);
export type DataOrigin = z.infer<typeof DataOriginSchema>;

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const GeographicRelevanceSchema = z.object({
  match: GeoMatchSchema,
  /** Distance from the property's confirmed point to the station/event, when meaningful. */
  distanceMeters: z.number().nonnegative().nullable().optional(),
  /** Human-readable caveat, e.g. "County-level publication" or "Regional 4×4 km model". */
  note: z.string().optional(),
});
export type GeographicRelevance = z.infer<typeof GeographicRelevanceSchema>;

/**
 * A single value with full provenance. Every measurement shown in the UI must be
 * representable as a Measurement (IMPLEMENTATION.md §8, §20).
 */
export const MeasurementSchema = z.object({
  value: z.union([z.number(), z.string(), z.boolean()]).nullable(),
  unit: z.string().nullable(),
  sourceId: SourceIdSchema,
  kind: DataKindSchema,
  /** When the source observed/issued/validated the value (source clock). */
  sourceTimestamp: IsoDateTimeSchema.nullable(),
  /** When FastighetsRadar fetched it (our clock). */
  fetchedAt: IsoDateTimeSchema.nullable(),
  freshness: FreshnessSchema,
  /** Availability of the value. Anything other than `ok` must not be rendered as a normal reading. */
  availability: DataStatusSchema,
  geo: GeographicRelevanceSchema,
  origin: DataOriginSchema,
  qualityFlags: z.array(z.string()).default([]),
});
export type Measurement<V extends number | string | boolean = number> = Omit<
  z.infer<typeof MeasurementSchema>,
  'value'
> & { value: V | null };

export const SeveritySchema = z.enum(['info', 'monitor', 'warning', 'critical', 'unknown']);
export type Severity = z.infer<typeof SeveritySchema>;

/**
 * Status vocabulary used by the approved design for properties/events
 * (Normal / Monitor / Warning / Critical). `unknown` must be shown when data is missing.
 */
export const PropertyStatusSchema = z.enum(['normal', 'monitor', 'warning', 'critical', 'unknown']);
export type PropertyStatus = z.infer<typeof PropertyStatusSchema>;

/** Returns true only when a measurement may be rendered as an actual value. */
export function isDisplayableValue<V extends number | string | boolean>(
  m: Pick<Measurement<V>, 'availability' | 'value'> | null | undefined,
): m is Pick<Measurement<V>, 'availability'> & { value: V } {
  return !!m && (m.availability === 'ok' || m.availability === 'stale') && m.value !== null;
}
