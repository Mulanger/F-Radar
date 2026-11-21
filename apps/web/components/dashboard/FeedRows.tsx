import type { ReactNode } from 'react';
import { groupFeedRows, type OverviewFeedRow } from '@/lib/view-models/overview';
import { IconChevronDown } from '../ui/icons';
import { FeedAckButton, type FeedAcks } from './FeedAck';
import { FeedMapButton, FeedUpdatedBadge } from './FeedEventMap';
import styles from './FeedRows.module.css';

export function FeedRows({ feed, acks, onMap, property, children }: {
  feed: OverviewFeedRow[];
  acks?: FeedAcks;
  onMap?: (row: OverviewFeedRow) => void;
  property: (row: OverviewFeedRow) => ReactNode;
  children: (row: OverviewFeedRow) => ReactNode;
}) {
  return groupFeedRows(feed).map((rows) => {
    const first = rows[0]!;
    if (rows.length === 1) return children(first);
    const pending = acks?.pending(rows) ?? 0;
    const confirmed = acks ? rows.filter((row) => row.ackRequired && acks.ackedAt(row)).length : 0;

    return (
      <details key={first.updateGroupKey} className={styles.group} style={pending ? { background: `color-mix(in oklch, ${first.bg} 75%, white)` } : undefined}>
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
            <FeedUpdatedBadge />
            <time className={styles.time}>{first.t}</time>
            {pending > 0 && <span className={styles.pending}>{pending} att kvittera</span>}
            {pending === 0 && confirmed > 0 && <span className={styles.confirmed}>{confirmed} av {rows.length} kvitterade</span>}
          </span>
        </summary>
        <ul className={styles.properties}>
          {rows.map((row) => <li key={row.rowKey}>
            <span className={styles.property}>{property(row)}</span>
            <span className={styles.actions}>
              {acks && <FeedAckButton f={{ ...row, title: `${row.title} · ${row.prop}` }} acks={acks} />}
              {onMap && row.mapEventId && <FeedMapButton title={`${row.title} · ${row.prop}`} ended={row.mapEnded} onClick={() => onMap(row)} />}
            </span>
          </li>)}
        </ul>
      </details>
    );
  });
}
