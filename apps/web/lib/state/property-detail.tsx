'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PropertySnapshot } from '@fastighetsradar/domain';

/**
 * The FULL snapshot of the property being viewed (docs/plans/skalning.md, Fas 3 / S-10).
 *
 * The dashboard layout only has the portfolio LIST (no forecast series, measured rain or nearby
 * observations). The property page loads one full snapshot on the server and hands it to
 * `PropertyDetail`, which lives in the properties layout so it stays mounted between properties.
 *
 * `PropertyDetailData` is rendered BEFORE `PropertyDetail` (see the properties layouts) and writes
 * the snapshot while rendering, so the server HTML and hydration already show the full page; the
 * layout effect then re-renders readers for client navigations and refreshes.
 */
export type PropertyDetailState = { id: string; snapshot: PropertySnapshot | null; reason?: string };

const WriteCtx = createContext<{ write: (d: PropertyDetailState) => void; commit: () => void } | null>(null);
const ReadCtx = createContext<{ read: () => PropertyDetailState | null; version: number } | null>(null);

export function PropertyDetailProvider({ children }: { children: React.ReactNode }) {
  const ref = useRef<PropertyDetailState | null>(null);
  const [version, setVersion] = useState(0);
  const write = useCallback((d: PropertyDetailState) => {
    ref.current = d;
  }, []);
  const commit = useCallback(() => setVersion((v) => v + 1), []);
  const read = useCallback(() => ref.current, []);
  const writer = useMemo(() => ({ write, commit }), [write, commit]);
  const reader = useMemo(() => ({ read, version }), [read, version]);
  return (
    <WriteCtx.Provider value={writer}>
      <ReadCtx.Provider value={reader}>{children}</ReadCtx.Provider>
    </WriteCtx.Provider>
  );
}

/** The registered detail for `id`; null before the page has provided it (or for another property). */
export function usePropertyDetail(id: string | undefined): PropertyDetailState | null {
  const ctx = useContext(ReadCtx);
  const d = ctx?.read() ?? null;
  return d && d.id === id ? d : null;
}

/** Rendered by the property page with the server-loaded snapshot; renders nothing itself. */
export function PropertyDetailData({ id, snapshot, reason }: PropertyDetailState) {
  const ctx = useContext(WriteCtx);
  ctx?.write({ id, snapshot, reason });
  useLayoutEffect(() => {
    if (!ctx) return;
    ctx.write({ id, snapshot, reason });
    ctx.commit();
  }, [ctx, id, snapshot, reason]);
  return null;
}
