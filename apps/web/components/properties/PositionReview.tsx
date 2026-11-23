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
 * mostly from an import. The editor shows the map before the user can confirm the pin.
 */
export function PositionReviewList({
  items,
  editable,
  onAdjust,
}: {
  items: PositionReviewItem[];
  editable: boolean;
  onAdjust: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!items.length) return null;
  const shown = showAll ? items : items.slice(0, FIRST_ROWS);
  const disabledTitle = editable ? undefined : 'Demodata kan inte redigeras';
  return (
    <details className={styles.review} open={items.length <= FIRST_ROWS ? true : undefined}>
      <summary>Kontrollera position ({items.length})</summary>
      <p className={styles.reviewLead}>
        Öppna kartan för varje fastighet och bekräfta att nålen står på rätt byggnad. Flytta den vid behov.
      </p>
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
              <button className={`${styles.button} ${styles.small}`} disabled={!editable} title={disabledTitle} onClick={() => onAdjust(item.id)}>
                Kontrollera på kartan
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
  // Demo: the fixtures' positions are illustrative, so only rows from a simulated import are listed.
  return <PositionReviewList items={live ? items : (editor.demoReview ?? [])} editable={live && editor.enabled} onAdjust={onAdjust} />;
}
