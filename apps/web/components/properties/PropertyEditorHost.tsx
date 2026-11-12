'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import type { PropertySnapshot } from '@fastighetsradar/domain';
import { useDashboard } from '@/lib/state/dashboard-state';
import { PropertyEditorDialog } from './PropertyEditorDialog';

type EditorMode = { kind: 'create' } | { kind: 'edit'; snapshot: PropertySnapshot };

const EditorCtx = createContext<{ openCreate: () => void; openEdit: (s: PropertySnapshot) => void; enabled: boolean } | null>(null);

/** Owns the add/edit dialog so the header, empty states and detail page share one instance. */
export function PropertyEditorHost({ children }: { children: React.ReactNode }) {
  const ds = useDashboard();
  const [mode, setMode] = useState<EditorMode | null>(null);
  const openCreate = useCallback(() => ds.canEdit && setMode({ kind: 'create' }), [ds.canEdit]);
  const openEdit = useCallback((s: PropertySnapshot) => ds.canEdit && setMode({ kind: 'edit', snapshot: s }), [ds.canEdit]);

  return (
    <EditorCtx.Provider value={{ openCreate, openEdit, enabled: ds.canEdit }}>
      {children}
      {mode && (
        <PropertyEditorDialog
          mode={mode}
          onClose={() => setMode(null)}
          onSaved={(id) => {
            setMode(null);
            ds.refresh();
            ds.openProperty(id);
          }}
          onDeleted={() => {
            setMode(null);
            ds.goOverview();
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
