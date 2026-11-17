'use client';

import { useEffect, useState } from 'react';
import { ACTIVITY, PropertyActivitySchema, type ActivityItem } from '@fastighetsradar/domain';
import { useDashboard } from '@/lib/state/dashboard-state';
import type { DetailVM } from '@/lib/view-models/detail';
import { liveTimeline, type TimelineEntry } from '@/lib/view-models/timeline';

export interface PropertyTimelineState {
  entries: TimelineEntry[];
  /** Text shown when `entries` is empty. */
  emptyText: string;
}

/**
 * "Tidslinje" rows. The demo uses the view-model's fixture timeline; live properties load the
 * API's short activity log and reload it whenever the portfolio is refreshed.
 */
export function usePropertyTimeline(d: DetailVM): PropertyTimelineState {
  const ds = useDashboard();
  const live = d.origin === 'live';
  const refreshKey = ds.portfolio.generatedAt;
  const [loaded, setLoaded] = useState<{ id: string; items: ActivityItem[] | null } | null>(null);

  useEffect(() => {
    if (!live) return;
    const ctrl = new AbortController();
    fetch(`/api/app/properties/${encodeURIComponent(d.id)}/activity`, { signal: ctrl.signal, cache: 'no-store', headers: { accept: 'application/json' } })
      .then(async (r) => {
        const parsed = r.ok ? PropertyActivitySchema.safeParse(await r.json()) : null;
        setLoaded({ id: d.id, items: parsed?.success && parsed.data.propertyId === d.id ? parsed.data.items : null });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setLoaded({ id: d.id, items: null });
      });
    return () => ctrl.abort();
  }, [live, d.id, refreshKey]);

  if (!live) return { entries: d.timeline, emptyText: 'Ingen aktivitet nyligen' };
  // Never show another property's rows while the newly opened one loads.
  const mine = loaded?.id === d.id ? loaded : null;
  if (!mine) return { entries: [], emptyText: 'Hämtar aktivitet…' };
  if (!mine.items) return { entries: [], emptyText: 'Aktiviteten kunde inte hämtas just nu.' };
  return { entries: liveTimeline(mine.items, new Date().toISOString()), emptyText: `Ingen aktivitet de senaste ${ACTIVITY.days} dygnen` };
}
