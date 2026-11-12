import type { ServerEnv } from '@fastighetsradar/config';
import type { DataPoint, LatLon, MonitorEvent, SourceId } from '@fastighetsradar/domain';

/**
 * Adapter interfaces for all external integrations. Implementations live in
 * per-source folders and are added phase by phase (IMPLEMENTATION.md §19).
 *
 * Contract rules for every implementation:
 *  - Called from backend collectors/workers only, never from the browser.
 *  - Validate upstream payloads (zod) and flag/skip invalid records.
 *  - Never fabricate values: missing → `status: 'no_coverage' | 'unknown'`.
 *  - Use the injected `fetch` so tests run against fixtures without network.
 */

export interface AdapterLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface AdapterContext {
  env: ServerEnv;
  fetch: typeof globalThis.fetch;
  logger: AdapterLogger;
  now: () => Date;
  signal?: AbortSignal;
}

/** Result wrapper – adapters never throw for expected upstream problems. */
export type AdapterResult<T> =
  | { ok: true; data: T; fetchedAt: string }
  | { ok: false; error: AdapterErrorCode; detail?: string; retryAfterSeconds?: number };

export type AdapterErrorCode =
  | 'not_implemented'
  | 'disabled'
  | 'access_required'
  | 'unauthorized'
  | 'rate_limited'
  | 'timeout'
  | 'upstream_error'
  | 'invalid_payload'
  | 'no_coverage';

export interface PropertyLocation {
  propertyId: string;
  location: LatLon;
  countyCode?: string | null;
  municipalityCode?: string | null;
}

/* ---------- Geocoding (Geoapify primary, Lantmäteriet optional) ---------- */

export interface AddressSuggestion {
  label: string;
  lat: number;
  lon: number;
  city?: string;
  postcode?: string;
  street?: string;
  housenumber?: string;
  /** 0–1 where provided by the upstream. */
  confidence?: number;
  precision: 'building' | 'street' | 'approximate';
  placeId?: string;
  provider: 'geoapify' | 'lantmateriet';
}

export interface GeocodingProvider {
  readonly id: Extract<SourceId, 'geoapify_geocoding' | 'lantmateriet_address'>;
  /** Address autocomplete (min 3 chars, max 5 suggestions, Sweden only). */
  suggest(query: string, ctx: AdapterContext): Promise<AdapterResult<AddressSuggestion[]>>;
  /** Explicit verification after the user picked a suggestion. */
  resolve(text: string, ctx: AdapterContext): Promise<AdapterResult<AddressSuggestion | null>>;
}

/* ---------- Measurements ---------- */

export interface ForecastProvider {
  readonly id: Extract<SourceId, 'smhi_forecast'>;
  getPointForecast(target: PropertyLocation, ctx: AdapterContext): Promise<AdapterResult<DataPoint[]>>;
}

export interface ObservationProvider {
  readonly id: Extract<SourceId, 'smhi_observations' | 'air_quality' | 'sgu_groundwater' | 'smhi_oceanography'>;
  getNearestObservations(target: PropertyLocation, ctx: AdapterContext): Promise<AdapterResult<DataPoint[]>>;
}

export interface StatisticsProvider {
  readonly id: Extract<SourceId, 'scb'>;
  getContextStatistics(target: PropertyLocation, ctx: AdapterContext): Promise<AdapterResult<DataPoint[]>>;
}

export interface FloodExposureProvider {
  readonly id: Extract<SourceId, 'mcf_flood'>;
  /** Static scenario exposure for a point – never a live water level. */
  getMappedExposure(target: PropertyLocation, ctx: AdapterContext): Promise<AdapterResult<DataPoint[]>>;
}

/* ---------- Events & warnings (collected centrally, matched geographically) ---------- */

export interface EventFeedProvider {
  readonly id: Extract<SourceId, 'smhi_warnings' | 'krisinformation' | 'trafikverket'>;
  /** Fetch all currently active objects once; geo-matching happens in the geo engine. */
  fetchActive(ctx: AdapterContext): Promise<AdapterResult<MonitorEvent[]>>;
}

/* ---------- SMS ---------- */

export interface SmsMessage {
  to: string; // E.164
  message: string;
  dedupKey: string;
  organizationId: string;
}

export interface SmsSendResult {
  status: 'dry_run' | 'blocked' | 'queued' | 'sent' | 'failed';
  providerId?: string;
  parts: number;
  reason?: string;
}

export interface SmsProvider {
  readonly mode: 'disabled' | 'dry_run' | 'live';
  send(msg: SmsMessage): Promise<SmsSendResult>;
}
