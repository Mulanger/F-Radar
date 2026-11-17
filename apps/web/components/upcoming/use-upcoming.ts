'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDashboard } from '@/lib/state/dashboard-state';
import type { OverviewVM } from '@/lib/view-models/overview';
import { upcomingView, type UpcomingAcks, type UpcomingCat } from '@/lib/view-models/upcoming';

/**
 * State behind "Kommande förhållanden": category filter, the open event and acknowledgements.
 * Live mode persists acknowledgements for the whole organization (/api/app/upcoming/acknowledgements);
 * the demo keeps them in memory only.
 */
export function useUpcoming(vm: OverviewVM) {
  const ds = useDashboard();
  const live = ds.mode === 'live';
  const [filter, setFilter] = useState<UpcomingCat | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [acks, setAcks] = useState<UpcomingAcks>({});

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    fetch('/api/app/upcoming/acknowledgements', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? (r.json() as Promise<{ acknowledgements: Array<{ key: string; at: string }> }>) : null))
      .then((j) => {
        if (!cancelled && j) setAcks(Object.fromEntries(j.acknowledgements.map((a) => [a.key, a.at])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [live]);

  const toggleAck = useCallback(
    (key: string) => {
      const previous = acks[key];
      const next = previous ? null : new Date().toISOString();
      setAcks((a) => {
        const copy = { ...a };
        if (next) copy[key] = next;
        else delete copy[key];
        return copy;
      });
      if (!live) return;
      fetch('/api/app/upcoming/acknowledgements', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ key, acknowledged: !previous }),
      })
        .then(async (r) => {
          if (!r.ok) throw new Error();
          const j = (await r.json()) as { key: string; at: string | null };
          if (j.at) setAcks((a) => ({ ...a, [key]: j.at! }));
        })
        .catch(() => {
          setAcks((a) => {
            const copy = { ...a };
            if (previous) copy[key] = previous;
            else delete copy[key];
            return copy;
          });
          window.alert('Kvitteringen kunde inte sparas. Försök igen.');
        });
    },
    [acks, live],
  );

  // A filter whose category has disappeared (new forecast, other property group) falls back to "Alla".
  const cats = new Set(vm.upcoming.map((e) => e.cat));
  const activeFilter = filter !== 'all' && !cats.has(filter) ? 'all' : filter;
  const view = useMemo(() => upcomingView(vm.upcoming, acks, activeFilter, vm.referenceAt), [vm.upcoming, acks, activeFilter, vm.referenceAt]);
  const open = vm.upcoming.find((e) => e.id === openId) ?? null;

  return {
    view,
    acks,
    live,
    setFilter,
    open,
    openEvent: setOpenId,
    close: () => setOpenId(null),
    toggleAck,
    openProperty: (id: string) => {
      setOpenId(null);
      ds.openProperty(id);
    },
  };
}
export type UpcomingState = ReturnType<typeof useUpcoming>;
