import { useState, type ReactNode } from 'react';
import { groupFeedRows, type OverviewFeedRow } from '@/lib/view-models/overview';
import { IconChevronDown } from '../ui/icons';
import { FeedAckButton, type FeedAcks } from './FeedAck';
import { FeedMapButton, FeedUpdatedBadge } from './FeedEventMap';
import { NightMoon } from './NightMoon';
import styles from './FeedRows.module.css';

export function FeedRows({ feed, acks, onMap, isUnread, property, children }: {
  feed: OverviewFeedRow[];
  acks?: FeedAcks;
  onMap?: (row: OverviewFeedRow) => void;
  isUnread?: (row: OverviewFeedRow) => boolean;
  property: (row: OverviewFeedRow) => ReactNode;
  children: (row: OverviewFeedRow) => ReactNode;
}) {
  return groupFeedRows(feed).map((rows) => {
    const first = rows[0]!;
    if (rows.length === 1) return children(first);
    const pending = acks?.pending(rows) ?? 0;
    const confirmed = acks ? rows.filter((row) => row.ackRequired && acks.ackedAt(row)).length : 0;
    const updated = rows.some((row) => row.acknowledgementUpdate || (isUnread?.(row) ?? !!row.unreadUpdateId));

    return (
      <FeedGroup key={first.eventGroupKey} className={styles.group} style={pending ? { background: `color-mix(in oklch, ${first.bg} 75%, white)` } : undefined} rows={() => rows.map((row) => <li key={row.rowKey}>
        <span className={styles.property}>{property(row)}</span>
        <span className={styles.actions}>
          {acks && <FeedAckButton f={{ ...row, title: `${row.title} · ${row.prop}` }} acks={acks} />}
          {onMap && row.mapEventId && <FeedMapButton title={`${row.title} · ${row.prop}`} ended={row.mapEnded} onClick={() => onMap(row)} />}
        </span>
      </li>)}>
        <summary className={styles.summary}>
          <span className={styles.icon} style={{ background: first.bg }}><span style={{ background: first.c }} /></span>
          <span className={styles.main}>
            <span className={styles.title}>{first.title}</span>
            <span className={styles.meta}><span className={styles.source}>{first.src}</span> {rows.length} berörda fastigheter</span>
            <span className={styles.toggle}>
              <span className={styles.show}>Visa fastigheter</span>
              <span className={styles.hide}>Dölj fastigheter</span>
              <IconChevronDown size={13} aria-hidden="true" />
            </span>
          </span>
          <span className={styles.side}>
            {updated && <FeedUpdatedBadge />}
            <span className={styles.time}>{first.nightWork && <NightMoon label={first.nightWork} />}<time>{first.t}</time></span>
            {pending > 0 && <span className={styles.pending}>{pending} att kvittera</span>}
            {pending === 0 && confirmed > 0 && <span className={styles.confirmed}>{confirmed} av {rows.length} kvitterade</span>}
          </span>
        </summary>
      </FeedGroup>
    );
  });
}

/**
 * One card for an event over several properties. The property rows are rendered only while the card
 * is open: a county warning names hundreds of properties (docs/plans/skalning.md, Fas 2 / S-04).
 */
function FeedGroup({ rows, children, ...props }: { rows: () => ReactNode[]; children: ReactNode; className: string; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  return (
    <details {...props} onToggle={(e) => setOpen(e.currentTarget.open)}>
      {children}
      {open && <ul className={styles.properties}>{rows()}</ul>}
    </details>
  );
}
