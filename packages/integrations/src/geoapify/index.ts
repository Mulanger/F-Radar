import { z } from 'zod';
import type { ServerEnv } from '@fastighetsradar/config';
import type { AdapterContext, AdapterResult, AddressSuggestion, GeocodingProvider } from '../types';

/**
 * Geoapify – PRIMARY geocoding provider (IMPLEMENTATION.md §3.2, §9.9).
 *
 * Server-side only: the key comes from GEOAPIFY_API_KEY and never reaches the browser.
 * Without a key the provider returns `access_required` (= geocoding_unavailable) so the UI
 * falls back to a manual map pin.
 *
 * Guard rails:
 *  - ≥ 3 characters, max 5 suggestions, `filter=countrycode:se`, `lang=sv`, results outside SE dropped.
 *  - 4 s timeout, caller AbortSignal honoured (cancelled keystrokes cost nothing extra).
 *  - Retries once on 5xx/timeouts with jittered backoff; on 429 honours Retry-After (≤ 2 s) once.
 *  - In-process LRU cache (10 min) for identical queries + a daily credit budget counter.
 *  - Geoapify returns address POINTS – never official property boundaries or register IDs.
 */

export const GEOAPIFY_MIN_QUERY_LENGTH = 3;
export const GEOAPIFY_MAX_SUGGESTIONS = 5;
export const GEOAPIFY_ATTRIBUTION = 'Drivs av Geoapify · © OpenStreetMap-bidragsgivare';
const TIMEOUT_MS = 4_000;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 500;
/** Free plan: 3 000 credits/day shared across Geoapify APIs. Keep head-room for other uses. */
export const GEOAPIFY_DAILY_BUDGET = 2_500;

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

export function buildGeoapifySearchUrl(env: ServerEnv, text: string): URL {
  const url = new URL(env.GEOAPIFY_GEOCODING_URL);
  buildGeoapifyAutocompleteUrl(env, text).searchParams.forEach((v, k) => url.searchParams.set(k, v));
  url.searchParams.set('limit', '1');
  return url;
}

/** Redacts the apiKey query parameter for logging. */
export function redactGeoapifyUrl(url: URL): string {
  const copy = new URL(url.toString());
  if (copy.searchParams.has('apiKey')) copy.searchParams.set('apiKey', 'REDACTED');
  return copy.toString();
}

/** Normalises user input: collapses whitespace, strips control characters, caps length. */
export function normalizeAddressQuery(q: string): string {
  // eslint-disable-next-line no-control-regex
  return q.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

const ResultSchema = z
  .object({
    formatted: z.string().optional(),
    address_line1: z.string().optional(),
    address_line2: z.string().optional(),
    lat: z.number(),
    lon: z.number(),
    street: z.string().optional(),
    housenumber: z.string().optional(),
    postcode: z.string().optional(),
    city: z.string().optional(),
    municipality: z.string().optional(),
    county: z.string().optional(),
    country_code: z.string().optional(),
    result_type: z.string().optional(),
    place_id: z.string().optional(),
    rank: z
      .object({
        confidence: z.number().optional(),
        confidence_street_level: z.number().optional(),
        confidence_building_level: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
const ResponseSchema = z.object({ results: z.array(z.unknown()).default([]) }).passthrough();

const clamp01 = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? undefined : Math.min(1, Math.max(0, n)));

/** Maps one Geoapify result; returns null for invalid or non-Swedish results. */
export function mapGeoapifyResult(raw: unknown): AddressSuggestion | null {
  const parsed = ResultSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (r.country_code && r.country_code.toLowerCase() !== 'se') return null;
  const buildingConf = clamp01(r.rank?.confidence_building_level);
  const precision: AddressSuggestion['precision'] =
    (r.result_type === 'building' || r.housenumber) && (buildingConf === undefined || buildingConf >= 0.6)
      ? 'building'
      : r.result_type === 'street' || r.street
        ? 'street'
        : 'approximate';
  const label = r.formatted ?? [r.address_line1, r.address_line2].filter(Boolean).join(', ');
  if (!label) return null;
  return {
    label,
    lat: r.lat,
    lon: r.lon,
    street: r.street,
    housenumber: r.housenumber,
    postcode: r.postcode,
    city: r.city,
    municipality: r.municipality,
    county: r.county,
    resultType: r.result_type,
    confidence: clamp01(r.rank?.confidence),
    precision,
    placeId: r.place_id,
    provider: 'geoapify',
  };
}

/* ---------------- cache + budget (per process) ---------------- */

const cache = new Map<string, { at: number; value: AddressSuggestion[] }>();
let budget = { day: '', used: 0 };

function cacheGet(key: string, now: number) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key); // refresh LRU order
  cache.set(key, hit);
  return hit.value;
}
function cacheSet(key: string, value: AddressSuggestion[], now: number) {
  cache.set(key, { at: now, value });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}
function consumeBudget(now: Date): boolean {
  const day = now.toISOString().slice(0, 10);
  if (budget.day !== day) budget = { day, used: 0 };
  if (budget.used >= GEOAPIFY_DAILY_BUDGET) return false;
  budget.used++;
  return true;
}
/** Test hook. */
export function __resetGeoapifyState() {
  cache.clear();
  budget = { day: '', used: 0 };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

async function fetchWithRetry(url: URL, ctx: AdapterContext): Promise<AdapterResult<unknown>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
    try {
      if (!consumeBudget(ctx.now())) return { ok: false, error: 'rate_limited', detail: 'Daily Geoapify budget reached' };
      const res = await ctx.fetch(url, { signal, headers: { Accept: 'application/json' } });
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'unauthorized', detail: `Geoapify rejected the key (${res.status})` };
      if (res.status === 429) {
        const retryAfter = Math.min(2, Number(res.headers.get('retry-after')) || 1);
        if (attempt === 0) {
          await sleep(retryAfter * 1000, ctx.signal);
          continue;
        }
        return { ok: false, error: 'rate_limited', retryAfterSeconds: retryAfter };
      }
      if (res.status >= 500) {
        if (attempt === 0) {
          await sleep(250 + Math.random() * 250, ctx.signal);
          continue;
        }
        return { ok: false, error: 'upstream_error', detail: `Geoapify ${res.status}` };
      }
      if (!res.ok) return { ok: false, error: 'upstream_error', detail: `Geoapify ${res.status}` };
      return { ok: true, data: await res.json(), fetchedAt: ctx.now().toISOString() };
    } catch (err) {
      if (ctx.signal?.aborted) throw err; // caller cancelled – propagate
      if (attempt === 0) continue;
      return { ok: false, error: 'timeout', detail: err instanceof Error ? err.name : 'request failed' };
    }
  }
  return { ok: false, error: 'upstream_error' };
}

function guard(query: string, env: ServerEnv): AdapterResult<never> | null {
  if (env.GEOCODING_PROVIDER !== 'geoapify') return { ok: false, error: 'disabled', detail: 'GEOCODING_PROVIDER is not geoapify' };
  if (!env.GEOAPIFY_API_KEY) return { ok: false, error: 'access_required', detail: 'geocoding_unavailable: GEOAPIFY_API_KEY missing – use manual pin' };
  if (query.length < GEOAPIFY_MIN_QUERY_LENGTH) return { ok: false, error: 'invalid_payload', detail: 'Query shorter than 3 characters' };
  return null;
}

async function lookup(kind: 'suggest' | 'resolve', rawQuery: string, ctx: AdapterContext): Promise<AdapterResult<AddressSuggestion[]>> {
  const query = normalizeAddressQuery(rawQuery);
  const blocked = guard(query, ctx.env);
  if (blocked) return blocked;
  const key = `${kind}:${query.toLowerCase()}`;
  const now = ctx.now().getTime();
  const cached = cacheGet(key, now);
  if (cached) return { ok: true, data: cached, fetchedAt: new Date(now).toISOString() };
  const url = kind === 'suggest' ? buildGeoapifyAutocompleteUrl(ctx.env, query) : buildGeoapifySearchUrl(ctx.env, query);
  const res = await fetchWithRetry(url, ctx);
  if (!res.ok) {
    ctx.logger.warn({ url: redactGeoapifyUrl(url), error: res.error }, 'geoapify request failed');
    return res;
  }
  const body = ResponseSchema.safeParse(res.data);
  if (!body.success) return { ok: false, error: 'invalid_payload', detail: 'Unexpected Geoapify response shape' };
  const suggestions = body.data.results
    .map(mapGeoapifyResult)
    .filter((s): s is AddressSuggestion => s !== null)
    .slice(0, GEOAPIFY_MAX_SUGGESTIONS);
  cacheSet(key, suggestions, now);
  return { ok: true, data: suggestions, fetchedAt: res.fetchedAt };
}

export const geoapifyAdapter: GeocodingProvider = {
  id: 'geoapify_geocoding',
  suggest: (query, ctx) => lookup('suggest', query, ctx),
  resolve: async (text, ctx) => {
    const r = await lookup('resolve', text, ctx);
    return r.ok ? { ...r, data: r.data[0] ?? null } : r;
  },
};
