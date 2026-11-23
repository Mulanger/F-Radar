'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PositionReviewItem, PropertySnapshot } from '@fastighetsradar/domain';
import { useDashboard } from '@/lib/state/dashboard-state';
import { createDemoImport } from '@/lib/import/demo';
import { submitToApi } from '@/lib/import/run';
import { PropertyEditorDialog } from './PropertyEditorDialog';
import { PropertyImportDialog } from './PropertyImportDialog';
import { PropertyGroupsDialog } from '../groups/PropertyGroupsDialog';
import { runGroupChange, type GroupChangeRequest } from '@/lib/groups/store';
import { useDemoSmsRules } from '../notifications/DemoSmsRules';

type EditorMode = { kind: 'create' } | { kind: 'edit'; snapshot: PropertySnapshot };

const EditorCtx = createContext<{
  openCreate: () => void;
  openEdit: (s: PropertySnapshot) => void;
  openImport: () => void;
  /** The group dialog (Fas 4 / S-20); in demo mode it changes the shown portfolio only. */
  openGroups: () => void;
  /** Runs a group change (the property dialog creates groups through it). */
  changeGroups: (c: GroupChangeRequest) => Promise<string>;
  enabled: boolean;
  /** Demo mode: the uncertain positions from the latest simulated import (nothing is saved). */
  demoReview?: PositionReviewItem[];
} | null>(null);

/** Owns the add/edit and import dialogs so the header, empty states and detail page share one instance. */
export function PropertyEditorHost({ children }: { children: React.ReactNode }) {
  const ds = useDashboard();
  const demoRules = useDemoSmsRules()?.rules;
  const [mode, setMode] = useState<EditorMode | null>(null);
  const [importing, setImporting] = useState(false);
  const [grouping, setGrouping] = useState(false);
  // The latest portfolio for a change that follows another before the page re-renders.
  const latest = useRef(ds.portfolio);
  useLayoutEffect(() => {
    latest.current = ds.portfolio;
  }, [ds.portfolio]);
  const { patchPortfolio, refresh } = ds;
  const changeGroups = useCallback(
    (c: GroupChangeRequest) =>
      runGroupChange(c, {
        live: ds.canEdit,
        portfolio: () => latest.current,
        patch: (next) => {
          latest.current = next;
          patchPortfolio(next);
        },
        refresh,
        demoRules,
      }),
    [ds.canEdit, patchPortfolio, refresh, demoRules],
  );
  const openGroups = useCallback(() => setGrouping(true), []);
  const [demoReview, setDemoReview] = useState<PositionReviewItem[]>([]);
  const [demoConfirmed, setDemoConfirmed] = useState(false);
  const openCreate = useCallback(() => {
    setDemoConfirmed(false);
    setMode({ kind: 'create' });
  }, []);
  const openEdit = useCallback((s: PropertySnapshot) => ds.canEdit && setMode({ kind: 'edit', snapshot: s }), [ds.canEdit]);
  // The import also opens in demo mode, against a simulation that saves nothing.
  const openImport = useCallback(() => setImporting(true), []);
  const demo = !ds.canEdit;
  const submit = useMemo(() => (demo ? createDemoImport() : submitToApi), [demo]);
  const existingAddresses = useMemo(() => (importing ? ds.portfolio.properties.map((s) => s.property.address) : []), [importing, ds.portfolio.properties]);
  const closeImport = useCallback(
    ({ created, review }: { created: number; review: PositionReviewItem[] }) => {
      setImporting(false);
      if (demo) setDemoReview((list) => [...review, ...list]);
      else if (created > 0) ds.refresh();
    },
    [demo, ds],
  );

  return (
    <EditorCtx.Provider value={{ openCreate, openEdit, openImport, openGroups, changeGroups, enabled: ds.canEdit, demoReview }}>
      {children}
      {demoConfirmed && <div role="status" style={{ position: 'fixed', zIndex: 1200, bottom: 90, right: 16, maxWidth: 'calc(100vw - 32px)', padding: '12px 16px', borderRadius: 12, background: '#14171a', color: '#fff', fontSize: 13 }}>Positionen är bekräftad. Demoläget sparar inga fastigheter.</div>}
      {grouping && <PropertyGroupsDialog portfolio={ds.portfolio} demo={demo} change={changeGroups} onClose={() => setGrouping(false)} />}
      {importing && <PropertyImportDialog submit={submit} existingAddresses={existingAddresses} demo={demo} onClose={closeImport} />}
      {mode && (
        <PropertyEditorDialog
          mode={mode}
          demo={demo}
          groups={demo ? [] : ds.portfolio.groups}
          onCreateGroup={demo ? undefined : (name) => changeGroups({ kind: 'create', name, propertyIds: [] })}
          onDemoConfirmed={() => {
            setMode(null);
            setDemoConfirmed(true);
          }}
          onClose={() => setMode(null)}
          onSaved={(id) => {
            setMode(null);
            ds.refresh();
            ds.openProperty(id);
          }}
          onDeleted={() => {
            setMode(null);
            ds.goProperties();
            ds.refresh();
          }}
        />
      )}
    </EditorCtx.Provider>
  );
}

export function usePropertyEditor() {
  const v = useContext(EditorCtx);
  if (!v) throw new Error('usePropertyEditor must be used inside <PropertyEditorHost>');
  return v;
}
