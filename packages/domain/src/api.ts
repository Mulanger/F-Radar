import { z } from 'zod';
import { IsoDateTimeSchema } from './common';

/**
 * Request/response contracts for the authenticated customer API (Phase 2).
 * Shared by the Fastify API (validation) and the Next.js app (typing + client checks).
 */

/** Generous WGS84 bounding box for Sweden. Points outside are rejected. */
export const SWEDEN_BOUNDS = { minLat: 55.0, maxLat: 69.2, minLon: 10.5, maxLon: 24.3 } as const;

export const SwedishPointSchema = z.object({
  lat: z.number().finite().min(SWEDEN_BOUNDS.minLat, 'Latitude outside Sweden').max(SWEDEN_BOUNDS.maxLat, 'Latitude outside Sweden'),
  lon: z.number().finite().min(SWEDEN_BOUNDS.minLon, 'Longitude outside Sweden').max(SWEDEN_BOUNDS.maxLon, 'Longitude outside Sweden'),
});
export type SwedishPoint = z.infer<typeof SwedishPointSchema>;

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const PrecisionSchema = z.enum(['building', 'street', 'approximate']);

/** Normalised address suggestion returned by `/v1/geocoding/suggestions`. */
export const AddressSuggestionSchema = z.object({
  label: z.string(),
  lat: z.number(),
  lon: z.number(),
  street: z.string().optional(),
  housenumber: z.string().optional(),
  postcode: z.string().optional(),
  city: z.string().optional(),
  municipality: z.string().optional(),
  county: z.string().optional(),
  resultType: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  precision: PrecisionSchema,
  placeId: z.string().optional(),
  provider: z.literal('geoapify'),
});
export type AddressSuggestionDto = z.infer<typeof AddressSuggestionSchema>;

export const GeocodingSuggestionsResponseSchema = z.object({
  suggestions: z.array(AddressSuggestionSchema),
  attribution: z.string(),
  /** `geocoding_unavailable` when no key / quota exhausted – UI falls back to a manual pin. */
  status: z.enum(['ok', 'geocoding_unavailable', 'rate_limited']),
});
export type GeocodingSuggestionsResponse = z.infer<typeof GeocodingSuggestionsResponseSchema>;

/** Geocoding metadata captured when the user picked a suggestion (never re-fetched on view). */
export const GeocodeMetadataSchema = z.object({
  provider: z.enum(['geoapify', 'manual_pin']),
  placeId: trimmed(1, 512).optional(),
  label: trimmed(1, 300).optional(),
  resultType: trimmed(1, 40).optional(),
  precision: z.enum(['building', 'street', 'approximate', 'unknown']),
  confidence: z.number().min(0).max(1).optional(),
  /** Point returned by the geocoder before any manual adjustment. */
  geocodedPoint: SwedishPointSchema.optional(),
  postcode: trimmed(1, 20).optional(),
  city: trimmed(1, 120).optional(),
  municipality: trimmed(1, 120).optional(),
});
export type GeocodeMetadata = z.infer<typeof GeocodeMetadataSchema>;

export const PropertyCreateSchema = z.object({
  name: trimmed(1, 120),
  address: trimmed(3, 300),
  /** User-confirmed point (may differ from the geocoded point after manual adjustment). */
  location: SwedishPointSchema,
  geocode: GeocodeMetadataSchema,
});
export type PropertyCreateInput = z.infer<typeof PropertyCreateSchema>;

export const PropertyUpdateSchema = z
  .object({
    name: trimmed(1, 120).optional(),
    address: trimmed(3, 300).optional(),
    location: SwedishPointSchema.optional(),
    /** Required when the address changed via a new geocoding selection. */
    geocode: GeocodeMetadataSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type PropertyUpdateInput = z.infer<typeof PropertyUpdateSchema>;

export const PositionSourceSchema = z.enum(['geocoded', 'manual_adjusted', 'manual_pin']);

/** Property as stored for a customer organization. */
export const PropertyRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string(),
  location: z.object({ lat: z.number(), lon: z.number() }),
  positionSource: PositionSourceSchema,
  geocode: z.object({
    provider: z.string(),
    precision: z.string(),
    confidence: z.number().nullable(),
    label: z.string().nullable(),
    placeId: z.string().nullable(),
    resultType: z.string().nullable(),
    postcode: z.string().nullable(),
    city: z.string().nullable(),
    municipality: z.string().nullable(),
    geocodedAt: IsoDateTimeSchema.nullable(),
  }),
  status: z.enum(['profiling', 'active', 'paused']),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type PropertyRecord = z.infer<typeof PropertyRecordSchema>;

export const PropertyIdParamSchema = z.object({ id: z.string().uuid() });
