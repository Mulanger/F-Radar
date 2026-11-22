'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useDashboard } from '@/lib/state/dashboard-state';
import { C, FONT_MONO } from '@/lib/design/tokens';
import { IconBuildingSimple, IconCalendar, IconChevronDown, IconPlus, IconSearch } from '../ui/icons';
import { PropertyPicker } from '../properties/PropertyPicker';
import { Popover } from '../ui/Popover';
import { usePropertyEditor } from '../properties/PropertyEditorHost';
import { LiveStatus } from './LiveStatus';
import { CommandPalette } from './CommandPalette';

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcut, setShortcut] = useState('⌘K');

  // ⌘K on Mac, Ctrl+K elsewhere opens the property search from anywhere on the dashboard.
  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform)) setShortcut('Ctrl K');
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setJumpOpen(false);
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="fr-header" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 26, flexWrap: 'wrap' }}>
      <button
        type="button"
        className="fr-header-search"
        onClick={() => setSearchOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={searchOpen}
        aria-keyshortcuts="Meta+K Control+K"
        style={{ ...pill, flex: '1 1 280px', maxWidth: 420, padding: '0 16px', color: C.text4, fontSize: 14, cursor: 'text', textAlign: 'left', fontFamily: 'inherit' }}
      >
        <IconSearch />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Sök fastigheter, adresser…</span>
        <span className="fr-hide-compact" style={{ fontFamily: FONT_MONO, fontSize: 11, padding: '2px 6px', borderRadius: 6, background: C.chip }}>{shortcut}</span>
      </button>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />

      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setJumpOpen((v) => !v)}
          aria-expanded={jumpOpen}
          aria-haspopup="dialog"
          style={{ ...pill, padding: '0 14px 0 16px', color: C.ink, cursor: 'pointer' }}
        >
          <IconBuildingSimple />
          Snabbväxla
          <IconChevronDown stroke={C.text4} />
        </button>
        <Popover open={jumpOpen} onClose={() => setJumpOpen(false)} style={{ top: 52, left: 0, width: 340, maxWidth: 'calc(100vw - 32px)', background: 'rgba(255,255,255,0.92)' }}>
          <PropertyPicker
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
