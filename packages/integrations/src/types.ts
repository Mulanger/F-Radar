import type { ServerEnv } from '@fastighetsradar/config';
import type { DataClass, EventCategory, LatLon, Severity, SourceId, WarningLevel } from '@fastighetsradar/domain';

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
  municipality?: string;
  county?: string;
  resultType?: string;
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

/* ---------- Normalised collector output (Phase 3) ---------- */

/** GeoJSON geometry in WGS84 lon/lat (validated loosely; PostGIS validates on insert). */
export interface GeoJsonGeometry {
  type: 'Point' | 'MultiPoint' | 'LineString' | 'MultiLineString' | 'Polygon' | 'MultiPolygon';
  coordinates: unknown;
}

/**
 * A centrally collected warning or public event. One record per upstream object/area.
 * Text fields are the official wording, unmodified.
 */
export interface NormalizedSourceEvent {
  sourceId: Extract<SourceId, 'smhi_warnings' | 'krisinformation' | 'trafikverket' | 'sl_deviations'>;
  externalId: string;
  dataClass: Extract<DataClass, 'OFFICIAL_WARNING' | 'PUBLIC_EVENT'>;
  category: EventCategory;
  level: WarningLevel | null;
  severity: Severity;
  eventType: string;
  headline: string;
  description: string | null;
  areaLabel: string | null;
  /** County names exactly as published ("Stockholms län"); '*' = whole country. */
  countyNames: string[];
  /** GeoJSON geometry, or WKT for providers that publish WKT (Trafikverket). */
  geometry: GeoJsonGeometry | null;
  geometryWkt?: string | null;
  publishedAt: string | null;
  sourceUpdatedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  status: 'active' | 'cancelled';
  sourceUrl: string | null;
  attribution: string;
  extra: Record<string, unknown>;
}

/** Latest value of one parameter at one station (MetObs, air quality). */
export interface StationObservation {
  sourceId: Extract<SourceId, 'smhi_observations' | 'air_quality' | 'smhi_oceanography' | 'smhi_hydrology'>;
  stationId: string;
  parameter: string;
  name: string;
  lat: number;
  lon: number;
  value: number | null;
  unit: string | null;
  observedAt: string | null;
  quality: string | null;
  extra: Record<string, unknown>;
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
