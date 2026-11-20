'use client';

import { useCallback, useRef, useState } from 'react';
import { formatClock } from '@fastighetsradar/domain';
import { useDashboard } from '@/lib/state/dashboard-state';
import { useDemoAcknowledgements } from '../acknowledgements/DemoAcknowledgements';
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
 * with an optimistic update that is undone on failure; demo: shared for the local navigation session.
 */
export function useFeedAcks() {
  const ds = useDashboard();
  const live = ds.mode === 'live';
  const demo = useDemoAcknowledgements();
  // Local changes on top of what the server sent (row id → acknowledged at, or null = undone).
  const [over, setOver] = useState<Record<string, string | null>>({});
  const inFlight = useRef(new Set<string>());
  const overrides = demo?.overrides ?? over;

  const ackedAt = useCallback((f: FeedAckRow): string | null => (f.id in overrides ? overrides[f.id]! : f.acknowledgedAt), [overrides]);
  const pending = (feed: FeedAckRow[]) => feed.filter((f) => f.ackRequired && !ackedAt(f)).length;

  const save = useCallback(
    (f: FeedAckRow, acknowledged: boolean) => {
      if (inFlight.current.has(f.id)) return;
      const previous = ackedAt(f);
      const next = acknowledged ? new Date().toISOString() : null;
      if (demo) return demo.toggle(f.id, next);
      setOver((o) => ({ ...o, [f.id]: next }));
      if (!live) return;
      inFlight.current.add(f.id);
      fetch('/api/app/feed/acknowledgements', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ changeId: f.id, acknowledged }),
      })
        .then(async (r) => {
          if (!r.ok) throw new Error();
          const j = (await r.json()) as { at: string | null };
          inFlight.current.delete(f.id);
          setOver((o) => ({ ...o, [f.id]: j.at }));
          ds.refresh();
        })
        .catch(() => {
          inFlight.current.delete(f.id);
          setOver((o) => ({ ...o, [f.id]: previous }));
          window.alert('Kvitteringen kunde inte sparas. Försök igen.');
        });
    },
    [ackedAt, demo, live, ds],
  );

  return { ackedAt, pending, save, live, isSaving: (id: string) => inFlight.current.has(id) };
}
export type FeedAcks = ReturnType<typeof useFeedAcks>;

/** Keep the history timestamp visible in the feed. Undo lives on the history page. */
export function FeedAckButton({ f, acks }: { f: FeedAckRow; acks: FeedAcks }) {
  if (!f.ackRequired) return null;
  const at = acks.ackedAt(f);
  if (at) return <span className={styles.done}>Kvitterad <time dateTime={at}>{formatClock(at)}</time></span>;
  return (
    <button
      type="button"
      className={styles.ack}
      aria-label={`Kvittera: ${f.title}`}
      disabled={acks.isSaving(f.id)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        acks.save(f, true);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={CHECK} />
      </svg>
      Kvittera
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
