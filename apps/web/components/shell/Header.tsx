'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useDashboard } from '@/lib/state/dashboard-state';
import { C, FONT_MONO } from '@/lib/design/tokens';
import { IconBell, IconBuildingSimple, IconCalendar, IconChevronDown, IconPlus, IconSearch } from '../ui/icons';
import { PropertyList } from '../properties/PropertyList';
import { Popover } from '../ui/Popover';
import { usePropertyEditor } from '../properties/PropertyEditorHost';
import { LiveStatus } from './LiveStatus';

const pill: React.CSSProperties = {
  height: 44,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  borderRadius: 22,
  background: C.white,
  border: '1px solid rgba(20,23,26,0.06)',
  fontSize: 13.5,
};

export function Header() {
  const { portfolio, openProperty, mode, basePath } = useDashboard();
  const isAcknowledgementHistory = usePathname() === `${basePath}/acknowledgements`;
  const editor = usePropertyEditor();
  const isDemo = mode === 'demo';
  const [jumpOpen, setJumpOpen] = useState(false);

  return (
    <header className="fr-header" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 26, flexWrap: 'wrap' }}>
      <label className="fr-header-search" style={{ ...pill, flex: '1 1 280px', maxWidth: 420, padding: '0 16px', color: C.text4, fontSize: 14 }}>
        <IconSearch />
        <span className="fr-sr-only">Sök</span>
        <input
          placeholder="Sök fastigheter, adresser, larm…"
          style={{ border: 'none', outline: 'none', background: 'transparent', font: 'inherit', color: C.ink, flex: 1, minWidth: 0 }}
        />
        <span className="fr-hide-compact" style={{ fontFamily: FONT_MONO, fontSize: 11, padding: '2px 6px', borderRadius: 6, background: C.chip }}>⌘K</span>
      </label>

      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setJumpOpen((v) => !v)}
          aria-expanded={jumpOpen}
          aria-haspopup="listbox"
          style={{ ...pill, padding: '0 14px 0 16px', color: C.ink, cursor: 'pointer' }}
        >
          <IconBuildingSimple />
          Snabbväxla
          <IconChevronDown stroke={C.text4} />
        </button>
        <Popover open={jumpOpen} onClose={() => setJumpOpen(false)} style={{ top: 52, left: 0, width: 300, background: 'rgba(255,255,255,0.92)' }}>
          <PropertyList
            variant="status"
            onSelect={(id) => {
              setJumpOpen(false);
              openProperty(id);
            }}
          />
        </Popover>
      </div>

      {!isAcknowledgementHistory && <div style={{ ...pill, padding: '0 16px' }}>
        <IconCalendar stroke="#6B737B" />
        <span style={{ color: C.text4 }}>Period</span>Idag · kommande 48 h
      </div>}
      {!isDemo && <LiveStatus generatedAt={portfolio.generatedAt} />}

      <div className="fr-header-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          aria-label="Aviseringar"
          style={{ width: 44, height: 44, borderRadius: '50%', background: C.white, border: '1px solid rgba(20,23,26,0.06)', display: 'grid', placeItems: 'center', position: 'relative', cursor: 'pointer', color: C.ink }}
        >
          <IconBell />
          {isDemo && <span style={{ position: 'absolute', top: 10, right: 11, width: 8, height: 8, borderRadius: '50%', background: 'oklch(0.62 0.19 28)', border: '2px solid #fff' }} />}
        </button>
        <button
          className="fr-hover-dark"
          onClick={editor.openCreate}
          disabled={!editor.enabled}
          title={editor.enabled ? 'Lägg till en fastighet' : 'Demodata kan inte redigeras'}
          style={{ opacity: editor.enabled ? 1 : 0.85, height: 44, display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px', borderRadius: 22, background: C.ink, color: '#fff', border: 'none', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' }}
        >
          <IconPlus />
          Lägg till fastighet
        </button>
      </div>
    </header>
  );
}
