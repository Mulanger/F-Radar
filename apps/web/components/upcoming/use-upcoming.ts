'use client';

import { useMemo, useState } from 'react';
import { useDashboard } from '@/lib/state/dashboard-state';
import type { OverviewVM } from '@/lib/view-models/overview';
import { upcomingView, type UpcomingFilter } from '@/lib/view-models/upcoming';

/**
 * State behind "Kommande förhållanden": the kind filter and the expanded row. Plain information –
 * nothing here is acknowledged.
 */
export function useUpcoming(vm: OverviewVM) {
  const ds = useDashboard();
  const [filter, setFilter] = useState<UpcomingFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const view = useMemo(() => upcomingView(vm.upcoming, vm.referenceAt, { filter, center: vm.upcomingCenter }), [vm.upcoming, vm.referenceAt, vm.upcomingCenter, filter]);

  return {
    hasOutages: vm.upcoming.some((e) => e.kind === 'outage'),
    hasWeather: vm.upcoming.some((e) => e.kind !== 'outage'),
    view,
    live: ds.mode === 'live',
    updated: vm.upcomingUpdated,
    setFilter,
    openId,
    toggle: (id: string) => setOpenId((o) => (o === id ? null : id)),
    openProperty: (id: string) => ds.openProperty(id),
  };
}
export type UpcomingState = ReturnType<typeof useUpcoming>;
