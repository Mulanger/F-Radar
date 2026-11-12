import type { ServerEnv } from '@fastighetsradar/config';
import type { AdapterResult, AddressSuggestion, GeocodingProvider } from '../types';
import { notImplemented } from '../not-implemented';

/**
 * Geoapify – PRIMARY geocoding provider (IMPLEMENTATION.md §3.2, §9.9).
 *
 * Server-side only. The key is read from GEOAPIFY_API_KEY and must never reach the browser.
 * Without a key the provider returns `geocoding_unavailable` semantics (`access_required`)
 * so onboarding falls back to a manual map pin.
 *
 * Phase 1 provides the request builder and guard rails only; the HTTP call, response
 * schema and normalisation are implemented in Phase 2 (with a recorded smoke test).
 */

export const GEOAPIFY_MIN_QUERY_LENGTH = 3;
export const GEOAPIFY_MAX_SUGGESTIONS = 5;

export function buildGeoapifyAutocompleteUrl(env: ServerEnv, text: string): URL {
  if (!env.GEOAPIFY_API_KEY) throw new Error('GEOAPIFY_API_KEY is not configured');
  const url = new URL(env.GEOAPIFY_AUTOCOMPLETE_URL);
  url.searchParams.set('text', text);
  url.searchParams.set('filter', `countrycode:${env.GEOAPIFY_COUNTRY_FILTER}`);
  url.searchParams.set('lang', env.GEOAPIFY_LANGUAGE);
  url.searchParams.set('limit', String(GEOAPIFY_MAX_SUGGESTIONS));
  url.searchParams.set('format', 'json');
  url.searchParams.set('apiKey', env.GEOAPIFY_API_KEY);
  return url;
}

/** Redacts the apiKey query parameter for logging. */
export function redactGeoapifyUrl(url: URL): string {
  const copy = new URL(url.toString());
  if (copy.searchParams.has('apiKey')) copy.searchParams.set('apiKey', 'REDACTED');
  return copy.toString();
}

function guard(query: string, env: ServerEnv): AdapterResult<never> | null {
  if (env.GEOCODING_PROVIDER !== 'geoapify') return { ok: false, error: 'disabled', detail: 'GEOCODING_PROVIDER is not geoapify' };
  if (!env.GEOAPIFY_API_KEY) return { ok: false, error: 'access_required', detail: 'geocoding_unavailable: GEOAPIFY_API_KEY missing – use manual pin' };
  if (query.trim().length < GEOAPIFY_MIN_QUERY_LENGTH) return { ok: false, error: 'invalid_payload', detail: 'Query shorter than 3 characters' };
  return null;
}

export const geoapifyAdapter: GeocodingProvider = {
  id: 'geoapify_geocoding',
  suggest: async (query, ctx): Promise<AdapterResult<AddressSuggestion[]>> =>
    guard(query, ctx.env) ?? notImplemented<AddressSuggestion[]>('geoapify_geocoding'),
  resolve: async (text, ctx): Promise<AdapterResult<AddressSuggestion | null>> =>
    guard(text, ctx.env) ?? notImplemented<AddressSuggestion | null>('geoapify_geocoding'),
};
