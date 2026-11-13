'use client';

import { useState } from 'react';
import type { DetailVM } from '@/lib/view-models/detail';
import { C } from '@/lib/design/tokens';
import { IconChevronDown, IconChevronLeft, IconChevronRight } from '../ui/icons';
import { Popover } from '../ui/Popover';
import { PropertyList } from './PropertyList';

/** Prev / dropdown / next switcher – changes property without leaving the detail page. */
export function PropertySwitcher({ d, onSwitch }: { d: DetailVM; onSwitch: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const round: React.CSSProperties = { width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center' };
  const go = (id: string) => {
    setOpen(false);
    onSwitch(id);
  };
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, padding: 4, borderRadius: 24, background: C.white, border: '1px solid rgba(20,23,26,0.06)' }}>
      <button className="fr-hover-soft" onClick={() => go(d.prevId)} aria-label="Föregående fastighet" style={round}>
        <IconChevronLeft stroke={C.ink} />
      </button>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{ height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderRadius: 18, border: 'none', background: C.page, cursor: 'pointer', fontSize: 13.5, color: C.ink, minWidth: 190 }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.c }} />
        {d.name}
        <span style={{ fontSize: 11.5, color: C.text4, marginLeft: 'auto' }}>{d.pos}</span>
        <IconChevronDown stroke={C.text4} />
      </button>
      <button className="fr-hover-soft" onClick={() => go(d.nextId)} aria-label="Nästa fastighet" style={round}>
        <IconChevronRight stroke={C.ink} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} style={{ top: 52, right: 0, width: 320, background: 'rgba(255,255,255,0.94)' }}>
        <PropertyList variant="risk" currentId={d.id} onSelect={go} />
      </Popover>
    </div>
  );
}
