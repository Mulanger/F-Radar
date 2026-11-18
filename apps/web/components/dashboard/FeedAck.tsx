'use client';

import { useCallback, useState } from 'react';
import { formatClock } from '@fastighetsradar/domain';
import { useDashboard } from '@/lib/state/dashboard-state';
import styles from './FeedAck.module.css';

/** The parts of a feed row that acknowledgement needs (from the overview VM). */
export interface FeedAckRow {
  id: string;
  title: string;
  ackRequired: boolean;
  acknowledgedAt: string | null;
}

const CHECK = 'M20 6 9 17l-5-5';

/**
 * Kvittering i händelseflödet. Live: saved for the whole organization (POST /api/app/feed/acknowledgements)
 * with an optimistic update that is undone on failure; demo: kept in memory only.
 */
export function useFeedAcks() {
  const ds = useDashboard();
  const live = ds.mode === 'live';
  // Local changes on top of what the server sent (row id → acknowledged at, or null = undone).
  const [over, setOver] = useState<Record<string, string | null>>({});

  const ackedAt = useCallback((f: FeedAckRow): string | null => (f.id in over ? over[f.id]! : f.acknowledgedAt), [over]);
  const pending = (feed: FeedAckRow[]) => feed.filter((f) => f.ackRequired && !ackedAt(f)).length;

  const toggle = useCallback(
    (f: FeedAckRow) => {
      const previous = f.id in over ? over[f.id]! : f.acknowledgedAt;
      const next = previous ? null : new Date().toISOString();
      setOver((o) => ({ ...o, [f.id]: next }));
      if (!live) return;
      fetch('/api/app/feed/acknowledgements', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ changeId: f.id, acknowledged: !previous }),
      })
        .then(async (r) => {
          if (!r.ok) throw new Error();
          const j = (await r.json()) as { at: string | null };
          setOver((o) => ({ ...o, [f.id]: j.at }));
          ds.refresh();
        })
        .catch(() => {
          setOver((o) => ({ ...o, [f.id]: previous }));
          window.alert('Kvitteringen kunde inte sparas. Försök igen.');
        });
    },
    [over, live, ds],
  );

  return { ackedAt, pending, toggle, live };
}
export type FeedAcks = ReturnType<typeof useFeedAcks>;

/**
 * "Kvittera" on a feed row that needs it; afterwards "Kvitterad 14:32" (click to undo). Clicks and
 * keys stop here, so the card around it can still open the property.
 */
export function FeedAckButton({ f, acks }: { f: FeedAckRow; acks: FeedAcks }) {
  if (!f.ackRequired) return null;
  const at = acks.ackedAt(f);
  return (
    <button
      type="button"
      className={`${styles.ack} ${at ? styles.done : ''}`}
      aria-label={at ? `Kvitterad ${formatClock(at)}: ${f.title}. Ångra kvittering` : `Kvittera: ${f.title}`}
      aria-pressed={!!at}
      title={at ? 'Ångra kvittering' : 'Kvittera för hela organisationen'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        acks.toggle(f);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={CHECK} />
      </svg>
      {at ? `Kvitterad ${formatClock(at)}` : 'Kvittera'}
    </button>
  );
}

/** Header chip: "2 att kvittera" (hidden at 0). */
export function FeedAckCount({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className={styles.count} role="status">
      {n} att kvittera
    </span>
  );
}
