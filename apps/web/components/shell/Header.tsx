'use client';

import { useState } from 'react';
import { useDashboard } from '@/lib/state/dashboard-state';
import { C, FONT_MONO } from '@/lib/design/tokens';
import { IconBell, IconBuildingSimple, IconCalendar, IconChevronDown, IconPlus, IconSearch } from '../ui/icons';
import { PropertyList } from '../properties/PropertyList';
import { Popover } from '../ui/Popover';

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
  const { portfolio, openProperty } = useDashboard();
  const [jumpOpen, setJumpOpen] = useState(false);
  const viewer = portfolio.viewer;

  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 26, flexWrap: 'wrap' }}>
      <label style={{ ...pill, flex: '1 1 280px', maxWidth: 420, padding: '0 16px', color: C.text4, fontSize: 14 }}>
        <IconSearch />
        <span className="fr-sr-only">Search</span>
        <input
          placeholder="Search properties, addresses, alerts…"
          style={{ border: 'none', outline: 'none', background: 'transparent', font: 'inherit', color: C.ink, flex: 1, minWidth: 0 }}
        />
        <span style={{ fontFamily: FONT_MONO, fontSize: 11, padding: '2px 6px', borderRadius: 6, background: C.chip }}>⌘K</span>
      </label>

      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setJumpOpen((v) => !v)}
          aria-expanded={jumpOpen}
          aria-haspopup="listbox"
          style={{ ...pill, padding: '0 14px 0 16px', color: C.ink, cursor: 'pointer' }}
        >
          <IconBuildingSimple />
          Quick switch
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

      <div style={{ ...pill, padding: '0 16px' }}>
        <IconCalendar stroke="#6B737B" />
        <span style={{ color: C.text4 }}>Range</span>Today · next 48 h
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          aria-label="Notifications"
          style={{ width: 44, height: 44, borderRadius: '50%', background: C.white, border: '1px solid rgba(20,23,26,0.06)', display: 'grid', placeItems: 'center', position: 'relative', cursor: 'pointer', color: C.ink }}
        >
          <IconBell />
          <span style={{ position: 'absolute', top: 10, right: 11, width: 8, height: 8, borderRadius: '50%', background: 'oklch(0.62 0.19 28)', border: '2px solid #fff' }} />
        </button>
        <button
          className="fr-hover-dark"
          title="Property onboarding is implemented in Phase 2"
          style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px', borderRadius: 22, background: C.ink, color: '#fff', border: 'none', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' }}
        >
          <IconPlus />
          Add Property
        </button>
        <div style={{ ...pill, gap: 10, padding: '4px 14px 4px 4px', boxSizing: 'border-box' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'oklch(0.88 0.04 215)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600, color: 'oklch(0.38 0.07 225)' }}>
            {viewer.initials}
          </div>
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{viewer.displayName}</div>
            <div style={{ fontSize: 11.5, color: C.text4 }}>{viewer.role}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
