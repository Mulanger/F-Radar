'use client';

import { useMemo, useState } from 'react';
import { useDashboard } from '@/lib/state/dashboard-state';
import type { OverviewVM } from '@/lib/view-models/overview';
import { upcomingView } from '@/lib/view-models/upcoming';

/**
 * State behind "Kommande förhållanden": the open row and the row highlighted together with its
 * dot on the 48 h strip. Plain information – nothing here is acknowledged.
 */
export function useUpcoming(vm: OverviewVM) {
  const ds = useDashboard();
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const view = useMemo(() => upcomingView(vm.upcoming, vm.referenceAt), [vm.upcoming, vm.referenceAt]);
  const open = vm.upcoming.find((e) => e.id === openId) ?? null;

  return {
    view,
    live: ds.mode === 'live',
    open,
    openEvent: setOpenId,
    close: () => setOpenId(null),
    hoverId,
    setHover: setHoverId,
    openProperty: (id: string) => {
      setOpenId(null);
      ds.openProperty(id);
    },
  };
}
export type UpcomingState = ReturnType<typeof useUpcoming>;
