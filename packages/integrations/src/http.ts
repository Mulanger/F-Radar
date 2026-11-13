import type { AdapterContext, AdapterResult } from './types';

/**
 * Shared HTTP helper for public-data collectors (Phase 3).
 *
 *  - Per-request timeout (AbortSignal.timeout) combined with the caller's signal.
 *  - Retries: network errors, timeouts and 5xx with jittered exponential backoff;
 *    429 honours Retry-After (capped). 4xx (other than 429) are never retried.
 *  - Generic User-Agent identifying the application (no personal data).
 *  - URLs passed to the logger must already be redacted by the caller when they carry keys.
 */
export const USER_AGENT = 'FastighetsRadar/0.3 (public-data monitoring; contact via app operator)';

export interface HttpOptions {
  acceptNotModified?: boolean;
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Total attempts (≥ 1). */
  attempts?: number;
  /** Max seconds to wait for a Retry-After before giving up. */
  maxRetryAfterSeconds?: number;
  /** Label used in error details/logs (never the URL when it contains a key). */
  label: string;
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

export async function httpRequest(url: string | URL, ctx: AdapterContext, opts: HttpOptions): Promise<AdapterResult<Response>> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let last: AdapterResult<Response> = { ok: false, error: 'upstream_error', detail: `${opts.label}: no attempt made` };
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (ctx.signal?.aborted) return { ok: false, error: 'timeout', detail: `${opts.label}: cancelled` };
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    try {
      const res = await ctx.fetch(url, {
        method: opts.method ?? 'GET',
        body: opts.body,
        signal,
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...opts.headers },
      });
      if (res.status === 401 || res.status === 403) {
        await res.body?.cancel().catch(() => undefined);
        return { ok: false, error: 'unauthorized', detail: `${opts.label}: HTTP ${res.status}` };
      }
      if (res.status === 429) {
        await res.body?.cancel().catch(() => undefined);
        const ra = Number(res.headers.get('retry-after')) || 2 ** attempt;
        last = { ok: false, error: 'rate_limited', detail: `${opts.label}: HTTP 429`, retryAfterSeconds: ra };
        if (attempt < attempts - 1 && ra <= (opts.maxRetryAfterSeconds ?? 10)) {
          await sleep(ra * 1000, ctx.signal);
          continue;
        }
        return last;
      }
      if (res.status >= 500) {
        await res.body?.cancel().catch(() => undefined);
        last = { ok: false, error: 'upstream_error', detail: `${opts.label}: HTTP ${res.status}` };
        if (attempt < attempts - 1) {
          await sleep(backoffMs(attempt), ctx.signal);
          continue;
        }
        return last;
      }
      if (!res.ok && !(opts.acceptNotModified && res.status === 304)) {
        await res.body?.cancel().catch(() => undefined);
        return { ok: false, error: 'upstream_error', detail: `${opts.label}: HTTP ${res.status}` };
      }
      return { ok: true, data: res, fetchedAt: ctx.now().toISOString() };
    } catch (err) {
      if (ctx.signal?.aborted) return { ok: false, error: 'timeout', detail: `${opts.label}: cancelled` };
      const name = err instanceof Error ? err.name : 'Error';
      last = { ok: false, error: name === 'TimeoutError' ? 'timeout' : 'upstream_error', detail: `${opts.label}: ${name}` };
      if (attempt < attempts - 1) {
        await sleep(backoffMs(attempt), ctx.signal).catch(() => undefined);
        continue;
      }
    }
  }
  return last;
}

export const backoffMs = (attempt: number) => Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);

/** GET/POST + JSON parse. Payload validation is the caller's job (zod). */
export async function httpJson(url: string | URL, ctx: AdapterContext, opts: HttpOptions): Promise<AdapterResult<unknown>> {
  const r = await httpRequest(url, ctx, opts);
  if (!r.ok) return r;
  try {
    return { ok: true, data: await r.data.json(), fetchedAt: r.fetchedAt };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    return { ok: false, error: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'invalid_payload', detail: `${opts.label}: body ${name}` };
  }
}

/** Parses a finite number from number|string; returns null for missing/sentinel values. */
export function num(v: unknown, missing: number[] = []): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || missing.includes(n)) return null;
  return n;
}

/** Normalises an upstream timestamp to ISO-8601 UTC, or null. Accepts ms epoch numbers. */
export function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
