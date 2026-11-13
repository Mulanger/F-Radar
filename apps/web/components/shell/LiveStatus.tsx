'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatClock } from '@fastighetsradar/domain';
import { C } from '@/lib/design/tokens';

/**
 * Live updates for the signed-in organization.
 *
 *  - Opens an authenticated SSE stream via the same-origin BFF (/api/app/stream). The API scopes it
 *    to the verified organization and only sends HINTS ("these sources changed").
 *  - On a hint, refreshes the server-rendered dashboard (router.refresh → /v1/portfolio, which reads
 *    stored snapshots – no provider is called because a user looks at the page).
 *  - Debounced (≥ 15 s between refreshes). If the stream keeps failing, falls back to polling every
 *    5 minutes and says so.
 */
export const MIN_REFRESH_GAP_MS = 15_000;
export const FALLBACK_POLL_MS = 5 * 60_000;

type Mode = 'connecting' | 'live' | 'polling';

export function LiveStatus({ generatedAt }: { generatedAt: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('connecting');
  const lastRefresh = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      setMode('polling');
      return;
    }
    let failures = 0;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const refresh = () => {
      const wait = Math.max(0, lastRefresh.current + MIN_REFRESH_GAP_MS - Date.now());
      if (pending.current) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        lastRefresh.current = Date.now();
        if (document.visibilityState !== 'hidden') router.refresh();
      }, Math.max(1_500, wait));
    };

    const startPolling = () => {
      setMode('polling');
      if (!poll) poll = setInterval(() => router.refresh(), FALLBACK_POLL_MS);
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
      es.addEventListener('update', refresh);
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
      if (poll) clearInterval(poll);
      if (reconnect) clearTimeout(reconnect);
      if (pending.current) clearTimeout(pending.current);
    };
  }, [router]);

  const dot = mode === 'live' ? 'oklch(0.62 0.14 155)' : mode === 'polling' ? 'oklch(0.72 0.14 75)' : '#B4BAC0';
  const label = mode === 'live' ? 'Live' : mode === 'polling' ? 'Uppdateras var 5:e min' : 'Ansluter…';
  return (
    <div
      role="status"
      aria-live="polite"
      title="Data hämtas centralt enligt schema; sidan uppdateras när nya data finns."
      style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', borderRadius: 22, background: C.white, border: '1px solid rgba(20,23,26,0.06)', fontSize: 12.5, color: C.text4 }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
      <span style={{ color: C.ink }}>{label}</span>
      <span>· {formatClock(generatedAt)}</span>
    </div>
  );
}
