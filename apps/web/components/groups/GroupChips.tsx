'use client';

import { useState } from 'react';
import { PROPERTY_GROUP_NAME_MAX, PROPERTY_GROUPS_MAX, propertyGroupKey } from '@fastighetsradar/domain';
import styles from './PropertyGroups.module.css';

/**
 * The property dialog's "Grupper" (docs/plans/skalning.md, Fas 4 / S-20): one toggle per group, and
 * a field that creates a group and selects it.
 */
export function GroupChips({
  groups,
  selected,
  onChange,
  onCreate,
}: {
  groups: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Creates the group and resolves with its id; rejects with a Swedish message. */
  onCreate?: (name: string) => Promise<string>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = new Set(selected);

  async function create() {
    const n = name.trim();
    if (!n || !onCreate) return;
    const existing = groups.find((g) => propertyGroupKey(g.label) === propertyGroupKey(n));
    if (existing) {
      if (!chosen.has(existing.id)) onChange([...selected, existing.id]);
      setName('');
      return;
    }
    if (groups.length >= PROPERTY_GROUPS_MAX) return setError(`En organisation kan ha högst ${PROPERTY_GROUPS_MAX} grupper.`);
    setBusy(true);
    setError(null);
    try {
      const id = await onCreate(n);
      onChange([...selected, id]);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gruppen kunde inte skapas.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label="Grupper" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className={styles.chips}>
        {groups.map((g) => (
          <button key={g.id} type="button" className={styles.chip} aria-pressed={chosen.has(g.id)}
            onClick={() => onChange(chosen.has(g.id) ? selected.filter((id) => id !== g.id) : [...selected, g.id])}>
            {g.label}
          </button>
        ))}
        {onCreate && (
          <div className={styles.chipNew}>
            <input value={name} maxLength={PROPERTY_GROUP_NAME_MAX} placeholder={groups.length ? 'Ny grupp' : 'Ny grupp, t.ex. Innerstad'} aria-label="Namn på ny grupp"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void create(); } }} />
            <button type="button" className={styles.chip} onClick={() => void create()} disabled={busy || !name.trim()}>{busy ? 'Skapar…' : 'Lägg till'}</button>
          </div>
        )}
      </div>
      {error && <div role="alert" style={{ fontSize: 12, color: 'oklch(0.5 0.17 27)' }}>{error}</div>}
    </div>
  );
}
