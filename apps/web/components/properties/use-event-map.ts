'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PropertyEventMapSchema, type EventMapItem } from '@fastighetsradar/domain';
import { demoEventMap } from '@/lib/demo/event-map-demo';
import { useDashboard } from '@/lib/state/dashboard-state';
import type { DetailVM } from '@/lib/view-models/detail';
import { eventMapEntries, type EventMapEntry, type EventMapStatus } from '@/lib/view-models/event-map';

export interface EventMapState {
  entries: EventMapEntry[];
  /** Ids of events that can be shown on the map ("Visa på karta"). */
  mappable: Set<string>;
  /** Event currently open in the map view, or null. */
  openId: string | null;
  status: EventMapStatus;
  open: (eventId?: string) => void;
  close: () => void;
  select: (eventId: string) => void;
}

/**
 * State for "Visa på karta" on a property. Geometry is loaded the first time the map opens
 * (live: the API's published Trafikverket geometry; demo: fixture) and reloaded with the portfolio.
 */
export function useEventMap(d: DetailVM): EventMapState {
  const ds = useDashboard();
  const live = d.origin === 'live';
  const refreshKey = ds.portfolio.generatedAt;
  const [openId, setOpenId] = useState<string | null>(null);
  const [wanted, setWanted] = useState(false);
  const [loaded, setLoaded] = useState<{ id: string; key: string; items: EventMapItem[] | null } | null>(null);

  // A newly opened property starts closed and loads on demand again.
  useEffect(() => {
    setOpenId(null);
    setWanted(false);
  }, [d.id]);

  useEffect(() => {
    if (!wanted || !live) return;
    if (loaded?.id === d.id && loaded.key === refreshKey) return;
    const ctrl = new AbortController();
    fetch(`/api/app/properties/${encodeURIComponent(d.id)}/event-map`, { signal: ctrl.signal, cache: 'no-store', headers: { accept: 'application/json' } })
      .then(async (r) => {
        const parsed = r.ok ? PropertyEventMapSchema.safeParse(await r.json()) : null;
        setLoaded({ id: d.id, key: refreshKey, items: parsed?.success && parsed.data.propertyId === d.id ? parsed.data.items : null });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setLoaded({ id: d.id, key: refreshKey, items: null });
      });
    return () => ctrl.abort();
  }, [wanted, live, d.id, refreshKey, loaded]);

  const mine = live ? (loaded?.id === d.id ? loaded : null) : { id: d.id, key: refreshKey, items: demoEventMap(d.id) };
  const status: EventMapStatus = !live ? 'ready' : !wanted && !mine ? 'idle' : !mine ? 'loading' : mine.items ? 'ready' : 'error';
  const items = mine?.items ?? null;
  const nowIso = live ? new Date().toISOString() : ds.portfolio.generatedAt;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = useMemo(() => eventMapEntries(d.events, items, status, nowIso), [d.events, items, status]);
  const mappable = useMemo(() => new Set(entries.map((e) => e.id)), [entries]);

  const open = useCallback(
    (eventId?: string) => {
      setWanted(true);
      setOpenId(eventId && mappable.has(eventId) ? eventId : entries[0]?.id ?? null);
    },
    [entries, mappable],
  );
  const close = useCallback(() => setOpenId(null), []);
  const select = useCallback((id: string) => setOpenId(id), []);

  return { entries, mappable, openId: openId && mappable.has(openId) ? openId : null, status, open, close, select };
}
