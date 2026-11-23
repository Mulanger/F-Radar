'use client';

import { useMemo } from 'react';
import { useDashboard } from '@/lib/state/dashboard-state';
import { groupLabel, groupOptions } from '@/lib/view-models/groups';
import styles from './GroupFilter.module.css';

/**
 * The property group shown on the page (docs/plans/skalning.md, Fas 4 / S-20). One choice for the
 * whole dashboard: picking "Innerstad" on the overview also limits the list, the map and the alert
 * feed. Tabs while the groups fit, a menu beyond that; nothing at all without groups (except the
 * overview's tabs, which always showed "Alla fastigheter").
 */
export function GroupFilter({ variant = 'select' }: { variant?: 'tabs' | 'select' | 'auto' }) {
  const ds = useDashboard();
  const options = useMemo(() => groupOptions(ds.portfolio), [ds.portfolio]);
  if (variant === 'select' && options.length < 2) return null;
  if (variant === 'tabs' || (variant === 'auto' && options.length <= 5)) {
    return (
      <div role="tablist" aria-label="Fastighetsgrupp" className={`fr-tabs ${styles.tabs}`}>
        {options.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={ds.group === g.id} className={styles.tab} onClick={() => ds.setGroup(g.id)}>
            {g.label}
            <span>{g.count}</span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <label className={`${styles.select} ${ds.group !== 'all' ? styles.active : ''}`}>
      Grupp
      <select value={ds.group} onChange={(e) => ds.setGroup(e.target.value)}>
        {options.map((g) => (
          <option key={g.id} value={g.id}>
            {g.label} ({g.count})
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * "Visar bara Innerstad – 3 händelser i andra fastigheter visas inte." Where a group could hide an
 * alarm, the page says so and offers every property with one click.
 */
export function GroupNotice({ hidden, noun }: { hidden: number; noun: [one: string, many: string] }) {
  const ds = useDashboard();
  const label = groupLabel(ds.portfolio, ds.group);
  if (!label) return null;
  return (
    <p className={styles.notice} role="status">
      <span>
        Visar bara <b>{label}</b>.
        {hidden > 0 && ` ${hidden} ${hidden === 1 ? noun[0] : noun[1]} i andra fastigheter visas inte.`}
      </span>
      <button type="button" onClick={() => ds.setGroup('all')}>Visa alla fastigheter</button>
    </p>
  );
}
