'use client';

import type { DetailVM } from '@/lib/view-models/detail';
import { C, FONT_MONO, card, cardSub, cardTitle } from '@/lib/design/tokens';

/**
 * "Overall Property Risk" gauge from the design. The score and factors are DEMO values
 * only – no risk methodology has been approved (IMPLEMENTATION.md §14.1/§20). In live
 * mode the gauge shows "Not assessed".
 */
export function PropertyRiskPanel({ d, isDemo }: { d: DetailVM; isDemo: boolean }) {
  return (
    <div style={{ ...card, padding: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={cardTitle}>Samlad fastighetsrisk</div>
          <div style={cardSub}>{isDemo ? 'Viktad över 5 faktorer · demovärden' : 'Ingen godkänd metod ännu'}</div>
        </div>
        <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 10, background: d.gauge.bg, color: d.gauge.c }}>{d.gauge.label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 10 }}>
        <div style={{ position: 'relative', width: 150, height: 150, flexShrink: 0 }}>
          <svg width="150" height="150" viewBox="0 0 160 160" style={{ transform: 'rotate(135deg)' }} aria-hidden="true">
            <circle cx="80" cy="80" r="66" fill="none" stroke={C.chip} strokeWidth="12" strokeLinecap="round" strokeDasharray={d.gauge.track} />
            <circle cx="80" cy="80" r="66" fill="none" stroke={d.gauge.c} strokeWidth="12" strokeLinecap="round" strokeDasharray={d.gauge.val} style={{ transition: 'stroke-dasharray 1.4s cubic-bezier(.2,.8,.2,1),stroke .6s' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: 40, fontWeight: 500, letterSpacing: '-0.04em', lineHeight: 1 }}>{d.risk}</div>
              <div style={{ fontSize: 11.5, color: C.text4, marginTop: 4 }}>av 100</div>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0 }}>
          {d.factors.map((f) => (
            <div key={f.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: C.text2 }}>{f.label}</span>
                <span style={{ fontFamily: FONT_MONO, color: C.text3 }}>{f.v}</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: C.chip, overflow: 'hidden' }}>
                <div style={{ height: 4, borderRadius: 2, width: f.w, background: f.c, transition: 'width 1s' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
