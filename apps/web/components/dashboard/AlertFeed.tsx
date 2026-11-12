'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import { C, FONT_MONO, card, cardSub, cardTitle } from '@/lib/design/tokens';

export function AlertFeed({ vm, isDemo, onOpen }: { vm: OverviewVM; isDemo: boolean; onOpen: (id: string) => void }) {
  return (
    <div style={{ ...card, flex: '1 1 380px', height: 460, boxSizing: 'border-box', padding: '20px 8px 8px 20px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 12, marginBottom: 12 }}>
        <div>
          <div style={cardTitle}>Alert Feed</div>
          <div style={cardSub}>Public-data events across the portfolio</div>
        </div>
        <span
          style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 10px', borderRadius: 12,
            background: isDemo ? 'oklch(0.95 0.05 80)' : vm.avail.warnings || vm.avail.events ? 'oklch(0.95 0.035 155)' : C.chip,
            color: isDemo ? 'oklch(0.45 0.1 70)' : vm.avail.warnings || vm.avail.events ? 'oklch(0.45 0.11 155)' : C.text3,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', animation: 'frBreath 2s infinite' }} />
          {isDemo ? 'Demo' : vm.avail.warnings || vm.avail.events ? 'Live' : 'Not connected'}
        </span>
      </div>
      <div style={{ overflowY: 'auto', overflowX: 'hidden', flex: 1, paddingRight: 12, paddingLeft: 10, marginLeft: -10, display: 'flex', flexDirection: 'column' }}>
        {vm.feed.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: C.text3 }}>
            {vm.avail.warnings || vm.avail.events ? 'No events for the selected properties' : 'Public-data event sources are not connected yet. Events will appear here once SMHI, Krisinformation and Trafikverket are integrated.'}
          </div>
        )}
        {vm.feed.map((f) => (
          <div
            key={f.id}
            role="button"
            tabIndex={0}
            className="fr-hover-row"
            onClick={() => onOpen(f.propertyId)}
            onKeyDown={(e) => e.key === 'Enter' && onOpen(f.propertyId)}
            style={{ display: 'flex', gap: 12, padding: '12px 10px', margin: '0 -10px', borderRadius: 14, cursor: 'pointer', transition: 'background .2s' }}
          >
            <div style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 11, background: f.bg, display: 'grid', placeItems: 'center', position: 'relative' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: f.c }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, lineHeight: 1.35, textWrap: 'pretty' }}>{f.title}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, fontSize: 11.5, color: C.text4 }}>
                <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, padding: '2px 6px', borderRadius: 5, background: C.chip, color: C.text2 }}>{f.src}</span>
                {f.prop}
              </div>
            </div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.text4, whiteSpace: 'nowrap' }}>{f.t}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
