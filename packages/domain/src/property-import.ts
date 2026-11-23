import { z } from 'zod';
import { SwedishPointSchema } from './api';
import { PropertyGroupNameSchema } from './property-groups';

/**
 * Bulk import of properties (docs/plans/skalning.md, Fas 6 / S-28).
 *
 * The browser parses the customer's file (CSV or rows pasted from Excel), shows a preview and sends
 * the rows in small batches. The API geocodes each address within Geoapify's rate limit (or uses the
 * coordinates from the file), creates the properties and answers with a status per row. Importing the
 * same file again skips addresses that already exist, so an interrupted import is resumed that way.
 */

/** Rows per request: with geocoding at ~4 per second one batch stays well inside the proxy's 15 s. */
export const PROPERTY_IMPORT_BATCH_MAX = 25;
/** Rows per file: the largest per-organization property limit (organizations.max_properties). */
export const PROPERTY_IMPORT_ROWS_MAX = 10_000;

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const PropertyImportRowSchema = z.object({
  /** The row's number in the customer's file, echoed back so the status lands on the right line. */
  row: z.number().int().positive().max(1_000_000),
  name: trimmed(1, 120),
  address: trimmed(3, 300),
  /** Coordinates from the file: used as given (no geocoding), counted as a position set by the customer. */
  location: SwedishPointSchema.optional(),
  /** Group by name (Fas 4 / S-20): created when the organization has none by that name. */
  group: PropertyGroupNameSchema.optional(),
});
export type PropertyImportRow = z.infer<typeof PropertyImportRowSchema>;

export const PropertyImportRequestSchema = z.object({
  rows: z.array(PropertyImportRowSchema).min(1).max(PROPERTY_IMPORT_BATCH_MAX),
  /** False while more batches follow: the re-match waits for the end of the import (S-29). */
  final: z.boolean().default(true),
});
export type PropertyImportRequest = z.input<typeof PropertyImportRequestSchema>;

export const PropertyImportStatusSchema = z.enum([
  /** Created. */
  'created',
  /** The organization already has a property with this address (or the same geocoded place). */
  'duplicate',
  /** The address search found nothing in Sweden. */
  'not_found',
  /** The organization's property limit is reached. */
  'limit_reached',
  /** Address search is switched off or out of quota: give coordinates in the file or try later. */
  'geocoding_unavailable',
  /** Not processed in this request (time budget or a passing upstream error): send the row again. */
  'pending',
]);
export type PropertyImportStatus = z.infer<typeof PropertyImportStatusSchema>;

export const PropertyImportResultSchema = z.object({
  row: z.number().int(),
  status: PropertyImportStatusSchema,
  /** The created property, or the existing one for a duplicate. */
  propertyId: z.string().uuid().optional(),
  /** What the address search found, so the customer can spot a wrong town. */
  match: z
    .object({ label: z.string().nullable(), precision: z.enum(['building', 'street', 'approximate', 'unknown']) })
    .optional(),
  /** The position is not confirmed (street or approximate hit): it is on the review list. */
  needsReview: z.boolean().optional(),
  /** Created, but not put in the row's group: the organization has as many groups as it may. */
  groupNotSet: z.boolean().optional(),
});
export type PropertyImportResult = z.infer<typeof PropertyImportResultSchema>;

export const PropertyImportResponseSchema = z.object({
  results: z.array(PropertyImportResultSchema),
  /** Properties the organization can still add under its limit. */
  remaining: z.number().int().nonnegative(),
});
export type PropertyImportResponse = z.infer<typeof PropertyImportResponseSchema>;

/** A property whose position is a street or approximate hit and has not been checked by a person. */
export const PositionReviewItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string(),
  /** The address search's label for the point (may name another town than the customer meant). */
  label: z.string().nullable(),
  precision: z.enum(['street', 'approximate', 'unknown']),
  location: z.object({ lat: z.number(), lon: z.number() }),
});
export type PositionReviewItem = z.infer<typeof PositionReviewItemSchema>;

export const PositionReviewResponseSchema = z.object({ properties: z.array(PositionReviewItemSchema) });
export type PositionReviewResponse = z.infer<typeof PositionReviewResponseSchema>;

/**
 * Comparable form of an address for duplicate checks: case, punctuation, postcode and country are
 * ignored, so "Sveavägen 42, Stockholm" matches the search label "Sveavägen 42, 111 34 Stockholm, Sverige".
 */
export function importAddressKey(address: string): string {
  return ` ${address.toLocaleLowerCase('sv-SE').replace(/[^\p{L}\p{N}]+/gu, ' ')} `
    .replace(/ \d{3} ?\d{2} /g, ' ')
    .replace(/ (sverige|sweden) /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
