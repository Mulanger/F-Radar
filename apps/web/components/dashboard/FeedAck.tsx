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
  /** The card (event revision) the row belongs to; rows of one event over many properties share it. */
  eventGroupKey?: string | null;
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
  /** Events (cards) and properties waiting for acknowledgement. */
  const pendingEvents = (feed: FeedAckRow[]) => {
    const rows = feed.filter((f) => f.ackRequired && !ackedAt(f));
    return { events: new Set(rows.map((f) => f.eventGroupKey ?? f.id)).size, properties: rows.length };
  };

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

  // The rows the last "Kvittera alla" acknowledged, so the card can offer "Ångra" for exactly those.
  const [lastBatch, setLastBatch] = useState<Set<string> | null>(null);

  /**
   * "Kvittera alla" / "Ångra" for an event over many properties (docs/plans/skalning.md, Fas 2 / S-05):
   * one request for all rows (POST /api/app/feed/acknowledgements/batch), all or none.
   */
  const saveMany = useCallback(
    (rows: FeedAckRow[], acknowledged: boolean) => {
      const targets = rows.filter((f) => f.ackRequired && !inFlight.current.has(f.id) && !!ackedAt(f) !== acknowledged);
      if (!targets.length) return;
      const ids = targets.map((f) => f.id);
      const next = acknowledged ? new Date().toISOString() : null;
      setLastBatch(acknowledged ? new Set(ids) : null);
      if (demo) return demo.toggleMany(ids, next);
      const previous = Object.fromEntries(targets.map((f) => [f.id, ackedAt(f)]));
      setOver((o) => ({ ...o, ...Object.fromEntries(ids.map((id) => [id, next])) }));
      if (!live) return;
      for (const id of ids) inFlight.current.add(id);
      fetch('/api/app/feed/acknowledgements/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ changeIds: ids, acknowledged }),
      })
        .then(async (r) => {
          if (!r.ok) throw new Error();
          const j = (await r.json()) as { changes: Array<{ changeId: string; at: string | null }> };
          const saved = new Map(j.changes.map((c) => [c.changeId, c.at]));
          for (const id of ids) inFlight.current.delete(id);
          // A row the server did not change keeps its previous state.
          setOver((o) => ({ ...o, ...Object.fromEntries(ids.map((id) => [id, saved.has(id) ? saved.get(id)! : previous[id]!])) }));
          ds.refresh();
        })
        .catch(() => {
          for (const id of ids) inFlight.current.delete(id);
          setOver((o) => ({ ...o, ...previous }));
          setLastBatch(null);
          window.alert(acknowledged ? 'Kvitteringen kunde inte sparas. Försök igen.' : 'Kvitteringen kunde inte ångras. Försök igen.');
        });
    },
    [ackedAt, demo, live, ds],
  );

  return { ackedAt, pending, pendingEvents, save, saveMany, lastBatch, live, isSaving: (id: string) => inFlight.current.has(id) };
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

/** "Kvittera alla (300)" and, right after, "Ångra" on the card of an event over many properties. */
export function FeedAckAllButton({ rows, acks, title }: { rows: FeedAckRow[]; acks: FeedAcks; title: string }) {
  const waiting = rows.filter((f) => f.ackRequired && !acks.ackedAt(f));
  const undoable = acks.lastBatch ? rows.filter((f) => acks.lastBatch!.has(f.id) && acks.ackedAt(f)) : [];
  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  if (waiting.length) {
    return (
      <button type="button" className={styles.ack} aria-label={`Kvittera alla ${waiting.length}: ${title}`} disabled={waiting.some((f) => acks.isSaving(f.id))}
        onClick={(e) => { stop(e); acks.saveMany(waiting, true); }} onKeyDown={(e) => e.stopPropagation()}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={CHECK} />
        </svg>
        Kvittera alla ({waiting.length})
      </button>
    );
  }
  if (!undoable.length) return null;
  return (
    <button type="button" className={styles.undo} aria-label={`Ångra kvitteringen av ${undoable.length}: ${title}`} disabled={undoable.some((f) => acks.isSaving(f.id))}
      onClick={(e) => { stop(e); acks.saveMany(undoable, false); }} onKeyDown={(e) => e.stopPropagation()}>
      Ångra
    </button>
  );
}

/** Header chip: "2 att kvittera" – events; "· 612 fastigheter" when they reach more (hidden at 0). */
export function FeedAckCount({ n }: { n: { events: number; properties: number } }) {
  if (!n.events) return null;
  return (
    <span className={styles.count} role="status">
      {n.events} att kvittera{n.properties > n.events ? ` · ${n.properties} fastigheter` : ''}
    </span>
  );
}
