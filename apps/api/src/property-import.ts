import {
  importAddressKey,
  isPositionConfirmed,
  PropertyCreateSchema,
  type PropertyCreateInput,
  type PropertyImportResult,
  type PropertyImportRow,
} from '@fastighetsradar/domain';
import { createProperty, listPropertyImportKeys, type OrgContext, type Queryable } from '@fastighetsradar/db';
import type { AddressSuggestion } from '@fastighetsradar/integrations';

/**
 * One batch of a property import (docs/plans/skalning.md, Fas 6 / S-28).
 *
 * Rows with coordinates are created as given. The others are geocoded – through the shared pacer, so
 * all imports together stay under Geoapify's request rate – until the time budget runs out; rows not
 * reached come back as `pending` and the browser sends them again. Addresses the organization already
 * has (or the same geocoded place) are skipped, so importing the same file again resumes an import.
 */

/** Geoapify's free plan allows 5 requests per second; leave one for the address field in the editor. */
export const IMPORT_GEOCODE_PER_SECOND = 4;
/** Parallel address searches within one batch. */
export const IMPORT_GEOCODE_CONCURRENCY = 4;
/** New searches start only within this budget; the proxy in front of the API gives up after 15 s. */
export const IMPORT_BATCH_BUDGET_MS = 9_000;
/** A search still running at this point is abandoned and its row returned as `pending`. */
export const IMPORT_BATCH_ABORT_MS = 12_000;

export type ImportGeocodeResult =
  | { ok: true; data: AddressSuggestion | null }
  /** `retry`: a passing error (timeout, 429) – the row is sent again; otherwise search is unavailable. */
  | { ok: false; retry: boolean };

export type ImportGeocoder = (address: string, signal: AbortSignal) => Promise<ImportGeocodeResult>;

/** Spaces calls evenly (`perSecond`), shared by every caller: a queue, not a bucket that rejects. */
export function createPacer(perSecond: number, now: () => number = Date.now) {
  const gap = 1000 / perSecond;
  let next = 0;
  return {
    async wait(signal?: AbortSignal): Promise<void> {
      const t = now();
      const at = Math.max(t, next);
      next = at + gap;
      const delay = at - t;
      if (delay <= 0) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal?.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
      });
    },
  };
}

/** Per-organization queue: two tabs importing at once cannot both pass the property limit. */
const orgQueues = new Map<string, Promise<unknown>>();
export function serializeForOrganization<T>(organizationId: string, run: () => Promise<T>): Promise<T> {
  const previous = orgQueues.get(organizationId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  orgQueues.set(organizationId, next);
  void next.catch(() => undefined).finally(() => orgQueues.get(organizationId) === next && orgQueues.delete(organizationId));
  return next;
}

function geocodedInput(row: PropertyImportRow, s: AddressSuggestion): PropertyCreateInput | null {
  const parsed = PropertyCreateSchema.safeParse({
    name: row.name,
    // The customer's own wording; the search label is kept as geocode.label.
    address: row.address,
    location: { lat: s.lat, lon: s.lon },
    geocode: {
      provider: 'geoapify',
      placeId: s.placeId?.slice(0, 512),
      label: s.label.slice(0, 300),
      resultType: s.resultType?.slice(0, 40),
      precision: s.precision,
      confidence: s.confidence,
      geocodedPoint: { lat: s.lat, lon: s.lon },
      postcode: s.postcode?.slice(0, 20),
      city: s.city?.slice(0, 120),
      municipality: s.municipality?.slice(0, 120),
      street: s.street?.slice(0, 120),
      housenumber: s.housenumber?.slice(0, 20),
    },
  });
  // Outside Sweden's bounds (or an unusable label): treated as not found.
  return parsed.success ? parsed.data : null;
}

export interface ImportBatchOutcome {
  results: PropertyImportResult[];
  created: number;
  remaining: number;
}

export async function importPropertyBatch(
  db: Queryable,
  ctx: OrgContext,
  rows: PropertyImportRow[],
  options: { geocode: ImportGeocoder; limit: number; signal?: AbortSignal; now?: () => number },
): Promise<ImportBatchOutcome> {
  const now = options.now ?? (() => performance.now());
  const started = now();
  const existing = await listPropertyImportKeys(db, ctx);
  const byKey = new Map<string, string>();
  const byPlace = new Map<string, string>();
  for (const p of existing) {
    byKey.set(importAddressKey(p.address), p.id);
    if (p.label) byKey.set(importAddressKey(p.label), p.id);
    if (p.placeId) byPlace.set(p.placeId, p.id);
  }
  // Reserved synchronously before each insert, so parallel searches cannot pass the limit together.
  let count = existing.length;
  let created = 0;
  const results = new Map<number, PropertyImportResult>();

  const create = async (row: PropertyImportRow, input: PropertyCreateInput, key: string, extra: Partial<PropertyImportResult>) => {
    if (count >= options.limit) {
      results.set(row.row, { row: row.row, status: 'limit_reached' });
      return;
    }
    // Everything that identifies this property is reserved before the insert awaits, so a parallel
    // search that lands on the same place sees it.
    count++;
    const keys = [key, ...(input.geocode.label ? [importAddressKey(input.geocode.label)] : [])];
    const place = input.geocode.placeId;
    for (const k of keys) byKey.set(k, 'reserved');
    if (place) byPlace.set(place, 'reserved');
    try {
      const property = await createProperty(db, ctx, input);
      for (const k of keys) byKey.set(k, property.id);
      if (place) byPlace.set(place, property.id);
      created++;
      results.set(row.row, { row: row.row, status: 'created', propertyId: property.id, ...extra });
    } catch (err) {
      count--;
      for (const k of keys) byKey.delete(k);
      if (place) byPlace.delete(place);
      throw err;
    }
  };

  const toGeocode: Array<{ row: PropertyImportRow; key: string }> = [];
  for (const row of rows) {
    const key = importAddressKey(row.address);
    const known = byKey.get(key);
    if (known) {
      results.set(row.row, { row: row.row, status: 'duplicate', ...(known !== 'reserved' && { propertyId: known }) });
      continue;
    }
    if (row.location) {
      await create(row, { name: row.name, address: row.address, location: row.location, geocode: { provider: 'manual_pin', precision: 'unknown' } }, key, {});
      continue;
    }
    // Reserve the key so a repeat within the batch is a duplicate, not a second search.
    byKey.set(key, 'reserved');
    toGeocode.push({ row, key });
  }

  const abort = new AbortController();
  const abortTimer = setTimeout(() => abort.abort(), Math.max(0, IMPORT_BATCH_ABORT_MS - (now() - started)));
  const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
  let unavailable = false;
  let next = 0;
  const worker = async () => {
    while (next < toGeocode.length) {
      const item = toGeocode[next++]!;
      const { row, key } = item;
      byKey.delete(key);
      if (unavailable) {
        results.set(row.row, { row: row.row, status: 'geocoding_unavailable' });
        continue;
      }
      // Full: no search spent on a row that cannot be created anyway.
      if (count >= options.limit) {
        results.set(row.row, { row: row.row, status: 'limit_reached' });
        continue;
      }
      if (signal.aborted || now() - started > IMPORT_BATCH_BUDGET_MS) {
        results.set(row.row, { row: row.row, status: 'pending' });
        continue;
      }
      let found: ImportGeocodeResult;
      try {
        found = await options.geocode(row.address, signal);
      } catch {
        found = { ok: false, retry: true };
      }
      if (!found.ok) {
        if (!found.retry) unavailable = true;
        results.set(row.row, { row: row.row, status: found.retry ? 'pending' : 'geocoding_unavailable' });
        continue;
      }
      const input = found.data ? geocodedInput(row, found.data) : null;
      if (!found.data || !input) {
        results.set(row.row, { row: row.row, status: 'not_found' });
        continue;
      }
      const match = { label: found.data.label, precision: found.data.precision };
      const samePlace = input.geocode.placeId ? byPlace.get(input.geocode.placeId) : undefined;
      const sameKey = byKey.get(key) ?? byKey.get(importAddressKey(found.data.label));
      const duplicate = samePlace ?? sameKey;
      if (duplicate) {
        results.set(row.row, { row: row.row, status: 'duplicate', match, ...(duplicate !== 'reserved' && { propertyId: duplicate }) });
        continue;
      }
      await create(row, input, key, { match, needsReview: !isPositionConfirmed(found.data.precision, 'geocoded') });
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(IMPORT_GEOCODE_CONCURRENCY, toGeocode.length) }, worker));
  } finally {
    clearTimeout(abortTimer);
  }

  return {
    results: rows.map((r) => results.get(r.row) ?? { row: r.row, status: 'pending' }),
    created,
    remaining: Math.max(0, options.limit - count),
  };
}
