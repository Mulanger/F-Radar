'use client';

import { useCallback, useEffect, useState } from 'react';
import { importAddressKey, type PositionReviewItem, type PositionReviewResponse } from '@fastighetsradar/domain';
import { useDashboard } from '@/lib/state/dashboard-state';
import { usePropertyEditor } from './PropertyEditorHost';
import styles from './PropertyImport.module.css';

/** Rows shown before "Visa alla". */
const FIRST_ROWS = 10;
const PRECISION_SV: Record<string, string> = { street: 'träffade gatan', approximate: 'ungefärlig träff', unknown: 'okänd precision' };

/**
 * The positions nobody has checked (docs/plans/skalning.md, Fas 6 / S-28): street or approximate hits,
 * mostly from an import. "Justera nålen" opens the property editor; "Stämmer" saves the pin where it
 * is, which marks it as checked – either takes the property off the list.
 */
export function PositionReviewList({
  items,
  editable,
  onAdjust,
  onConfirm,
}: {
  items: PositionReviewItem[];
  editable: boolean;
  onAdjust: (id: string) => void;
  onConfirm: (item: PositionReviewItem) => Promise<void>;
}) {
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!items.length) return null;
  const shown = showAll ? items : items.slice(0, FIRST_ROWS);
  const confirm = async (item: PositionReviewItem) => {
    setBusy(item.id);
    setError(null);
    try {
      await onConfirm(item);
    } catch {
      setError(`Positionen för ${item.name} sparades inte – försök igen.`);
    } finally {
      setBusy(null);
    }
  };
  const disabledTitle = editable ? undefined : 'Demodata kan inte redigeras';
  return (
    <details className={styles.review} open={items.length <= FIRST_ROWS ? true : undefined}>
      <summary>Kontrollera position ({items.length})</summary>
      <p className={styles.reviewLead}>
        Adressökningen hittade gatan men inte byggnaden. Kontrollera nålen, så att varningar och avbrott matchas mot rätt plats.
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <ul className={styles.reviewList}>
        {shown.map((item) => (
          <li key={item.id} className={styles.reviewItem}>
            <div className={styles.reviewText}>
              <div className={styles.reviewName}>{item.name}</div>
              <div className={styles.reviewMeta}>
                {item.address}
                {/* The search's own wording only when it names something else (another town, say). */}
                {item.label && importAddressKey(item.label) !== importAddressKey(item.address) ? ` → ${item.label}` : ''} · {PRECISION_SV[item.precision] ?? item.precision}
              </div>
            </div>
            <div className={styles.reviewActions}>
              <button className={`${styles.button} ${styles.small}`} disabled={!editable || busy !== null} title={disabledTitle} onClick={() => onAdjust(item.id)}>
                Justera nålen
              </button>
              <button className={`${styles.button} ${styles.small}`} disabled={!editable || busy !== null} title={disabledTitle} onClick={() => void confirm(item)} aria-label={`Positionen för ${item.name} stämmer`}>
                {busy === item.id ? 'Sparar…' : 'Stämmer'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {items.length > FIRST_ROWS && (
        <button className={`${styles.button} ${styles.small}`} style={{ marginTop: 8 }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Visa färre' : `Visa alla ${items.length}`}
        </button>
      )}
    </details>
  );
}

export function PositionReview() {
  const ds = useDashboard();
  const editor = usePropertyEditor();
  const live = ds.mode === 'live';
  const [items, setItems] = useState<PositionReviewItem[]>([]);
  // Reloaded with the portfolio: after an import, an edit in the dialog or another user's change.
  const generatedAt = ds.portfolio.generatedAt;
  useEffect(() => {
    if (!live) return;
    const ctrl = new AbortController();
    fetch('/api/app/properties/position-review', { signal: ctrl.signal, headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? (res.json() as Promise<PositionReviewResponse>) : null))
      .then((body) => body && setItems(body.properties))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [live, generatedAt]);

  const onAdjust = useCallback(
    (id: string) => {
      const snapshot = ds.portfolio.properties.find((s) => s.property.id === id);
      if (snapshot) editor.openEdit(snapshot);
    },
    [ds.portfolio.properties, editor],
  );
  const onConfirm = useCallback(async (item: PositionReviewItem) => {
    // Saving the pin where it is counts as checked (position_source manual_adjusted).
    const res = await fetch(`/api/app/properties/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ location: item.location }),
    });
    if (!res.ok) throw new Error(String(res.status));
    setItems((list) => list.filter((i) => i.id !== item.id));
  }, []);

  // Demo: the fixtures' positions are illustrative, so only rows from a simulated import are listed.
  return <PositionReviewList items={live ? items : (editor.demoReview ?? [])} editable={live && editor.enabled} onAdjust={onAdjust} onConfirm={onConfirm} />;
}
