'use client';

import { C, card } from '@/lib/design/tokens';
import { IconBuilding, IconPlus } from '../ui/icons';
import { usePropertyEditor } from '../properties/PropertyEditorHost';

/** Shown in place of the Monitoring Status table when the organization has no properties yet. */
export function EmptyPortfolio() {
  const editor = usePropertyEditor();
  return (
    <div style={{ ...card, padding: '36px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
      <div style={{ width: 52, height: 52, borderRadius: 16, background: C.chip, display: 'grid', placeItems: 'center', color: C.ink }}>
        <IconBuilding size={24} />
      </div>
      <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.02em' }}>No properties yet</div>
      <div style={{ fontSize: 13.5, color: C.text3, maxWidth: 440, lineHeight: 1.5 }}>
        Add your first property by searching for its Swedish address. You&apos;ll confirm its position on the map before it is saved.
      </div>
      {editor.enabled && (
        <button
          className="fr-hover-dark"
          onClick={editor.openCreate}
          style={{ marginTop: 6, height: 44, display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px', borderRadius: 22, background: C.ink, color: '#fff', border: 'none', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' }}
        >
          <IconPlus />
          Add your first property
        </button>
      )}
    </div>
  );
}
