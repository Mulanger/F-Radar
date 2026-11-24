'use client';

import { useMemo, useRef, useState } from 'react';
import { useDashboard } from '@/lib/state/dashboard-state';
import type { OverviewVM } from '@/lib/view-models/overview';
import { searchUpcomingRows, upcomingView, type UpcomingFilter } from '@/lib/view-models/upcoming';

/** Rows drawn at a time; "Visa fler" adds as many again. */
const PAGE = 100;

/**
 * State behind "Kommande förhållanden": the kind filter, the search, how many rows are drawn and the
 * expanded row. Plain information – nothing here is acknowledged.
 */
export function useUpcoming(vm: OverviewVM) {
  const ds = useDashboard();
  const [filter, setFilter] = useState<UpcomingFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQueryState] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const scrollRef = useRef<HTMLDivElement>(null);
  const view = useMemo(() => upcomingView(vm.upcoming, vm.referenceAt, { filter, center: vm.upcomingCenter }), [vm.upcoming, vm.referenceAt, vm.upcomingCenter, filter]);
  const matches = useMemo(() => searchUpcomingRows(view.rows, query), [view.rows, query]);
  const toTop = () => { if (scrollRef.current) scrollRef.current.scrollTop = 0; };

  return {
    hasOutages: vm.upcoming.some((e) => e.kind === 'outage'),
    hasWeather: vm.upcoming.some((e) => e.kind !== 'outage'),
    view,
    query,
    setQuery: (next: string) => { toTop(); setLimit(PAGE); setQueryState(next); },
    rows: matches.slice(0, limit),
    matchCount: matches.length,
    showMore: () => setLimit((l) => l + PAGE),
    group: ds.group,
    live: ds.mode === 'live',
    updated: vm.upcomingUpdated,
    scrollRef,
    setFilter: (next: UpcomingFilter) => {
      if (next === view.filter) return;
      toTop();
      setLimit(PAGE);
      setFilter(next);
    },
    openId,
    toggle: (id: string) => setOpenId((o) => (o === id ? null : id)),
    openProperty: (id: string) => ds.openProperty(id),
  };
}
export type UpcomingState = ReturnType<typeof useUpcoming>;
