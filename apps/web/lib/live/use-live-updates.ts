'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PortfolioNowcastPatch, PortfolioRowsPatch, PropertySnapshot, StreamUpdate } from '@fastighetsradar/domain';
import { useDashboard } from '@/lib/state/dashboard-state';
import { useLivePropertyDetail } from '@/lib/state/property-detail';
import { addUpdate, applyNowcastPatch, applyRowsPatch, emptyPending, hasPending, mergePending, nowcastForDetail, sourcesChanged, type LivePending } from './patch';

/**
 * Live updates for the signed-in organization (docs/plans/skalning.md, Fas 3 / S-12).
 *
 *  - Opens an authenticated SSE stream via the same-origin BFF (/api/app/stream). The API scopes it
 *    to the verified organization and only sends HINTS (which sources and properties changed).
 *  - Hints are collected and applied together, at least `MIN_REFRESH_GAP_MS` apart and after a
 *    random 0–5 s delay so open tabs do not all ask at the same second (S-33). Hidden tabs wait
 *    until they are shown again.
 *  - Changed properties are fetched as rows and patched into the list (`patch.ts`); the radar
 *    nowcast alone; the open property page reloads its own snapshot when it is affected. Only what
 *    a patch cannot rebuild – or a list older than `FULL_RELOAD_MAX_AGE_MS` – reloads the whole
 *    server-rendered dashboard (`router.refresh()`). No provider is called because a user looks.
 *  - If the stream keeps failing, falls back to a full reload every 5 minutes and says so.
 */
export const MIN_REFRESH_GAP_MS = 15_000;
export const REFRESH_JITTER_MS = 5_000;
export const FALLBACK_POLL_MS = 5 * 60_000;
/** Rows are rebuilt with the time they were built in mind (current forecast hour, freshness): reload at least this often. */
export const FULL_RELOAD_MAX_AGE_MS = 30 * 60_000;

export type LiveMode = 'connecting' | 'live' | 'polling';

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`/api/app/${path}`, { cache: 'no-store', headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`Live update failed (${r.status})`);
  return (await r.json()) as T;
}

const idsQuery = (ids: Iterable<string>) => [...ids].map(encodeURIComponent).join(',');

export function useLiveUpdates(): LiveMode {
  const router = useRouter();
  const { portfolio, patchPortfolio } = useDashboard();
  const detail = useLivePropertyDetail();
  const [mode, setMode] = useState<LiveMode>('connecting');
  const latest = useRef({ router, portfolio, patchPortfolio, detail });
  useLayoutEffect(() => {
    latest.current = { router, portfolio, patchPortfolio, detail };
  }, [router, portfolio, patchPortfolio, detail]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      setMode('polling');
      return;
    }
    let pending = emptyPending();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let lastFlush = 0;
    let lastFull = Date.now();
    let disposed = false;
    let failures = 0;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;

    const fullReload = () => {
      lastFull = Date.now();
      latest.current.router.refresh();
    };

    /** Fetches what `w` needs, then applies it in one synchronous step to the newest state. */
    const apply = async (w: LivePending) => {
      if (w.full || Date.now() - lastFull > FULL_RELOAD_MAX_AGE_MS) return fullReload();
      const open = latest.current.detail?.current() ?? null;
      const openId = open?.snapshot ? open.id : null;
      const rowIds = [...w.rows];
      const [rows, nowcast, fresh] = await Promise.all([
        rowIds.length ? getJson<PortfolioRowsPatch>(`portfolio/rows?ids=${idsQuery(rowIds)}`) : null,
        w.nowcast ? getJson<PortfolioNowcastPatch>(`portfolio/nowcast${w.nowcast === 'all' ? '' : `?ids=${idsQuery(w.nowcast)}`}`) : null,
        openId && (w.detail || w.rows.has(openId)) ? getJson<{ snapshot: PropertySnapshot }>(`properties/${encodeURIComponent(openId)}/snapshot`) : null,
      ]);
      if (disposed) return;

      const base = latest.current.portfolio;
      let next = base;
      if (rows) {
        const patched = sourcesChanged(base.sources, rows.sources) ? null : applyRowsPatch(next, rows, rowIds);
        if (!patched) return fullReload();
        next = patched;
      }
      if (nowcast) {
        if (sourcesChanged(base.sources, nowcast.sources)) return fullReload();
        next = applyNowcastPatch(next, nowcast);
      }
      if (next !== base) latest.current.patchPortfolio(next);

      const d = latest.current.detail;
      const current = d?.current() ?? null;
      if (d && current?.snapshot && current.id === openId) {
        let snapshot = fresh?.snapshot ?? current.snapshot;
        if (nowcast) snapshot = nowcastForDetail(snapshot, nowcast) ?? snapshot;
        if (snapshot !== current.snapshot) d.update({ id: current.id, snapshot, reason: fresh ? undefined : current.reason });
      }
    };

    const flush = async () => {
      if (document.visibilityState === 'hidden') return; // resumed by `visibilitychange`
      const work = pending;
      pending = emptyPending();
      running = true;
      lastFlush = Date.now();
      try {
        await apply(work);
      } catch {
        // API briefly unavailable: keep the work for the next hint instead of reloading everything.
        mergePending(pending, work);
        running = false;
        return;
      }
      running = false;
      schedule();
    };

    const schedule = () => {
      if (timer || running || disposed || !hasPending(pending) || document.visibilityState === 'hidden') return;
      const wait = Math.max(1_500, lastFlush + MIN_REFRESH_GAP_MS - Date.now()) + Math.random() * REFRESH_JITTER_MS;
      timer = setTimeout(() => {
        timer = null;
        void flush();
      }, wait);
    };

    const onUpdate = (e: MessageEvent<string>) => {
      try {
        addUpdate(pending, JSON.parse(e.data) as StreamUpdate);
      } catch {
        pending.full = true;
      }
      schedule();
    };
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') schedule();
    };
    document.addEventListener('visibilitychange', onVisible);

    const startPolling = () => {
      setMode('polling');
      if (!poll) poll = setInterval(() => {
        if (document.visibilityState !== 'hidden') fullReload();
      }, FALLBACK_POLL_MS);
    };

    const connect = () => {
      if (disposed) return;
      es = new EventSource('/api/app/stream');
      es.addEventListener('hello', () => {
        failures = 0;
        setMode('live');
        if (poll) {
          clearInterval(poll);
          poll = null;
        }
      });
      es.addEventListener('update', onUpdate as EventListener);
      es.addEventListener('bye', () => {
        // Server-side max duration reached: reconnect (re-verifies the session).
        es?.close();
        reconnect = setTimeout(connect, 1_000);
      });
      es.onerror = () => {
        failures++;
        if (failures >= 3) {
          es?.close();
          startPolling();
          // Try the stream again later.
          reconnect = setTimeout(() => {
            failures = 0;
            connect();
          }, FALLBACK_POLL_MS);
        }
      };
    };
    connect();

    return () => {
      disposed = true;
      es?.close();
      document.removeEventListener('visibilitychange', onVisible);
      if (poll) clearInterval(poll);
      if (reconnect) clearTimeout(reconnect);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return mode;
}
