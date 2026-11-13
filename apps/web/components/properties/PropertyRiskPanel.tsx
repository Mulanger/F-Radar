'use client';

import type { DetailVM } from '@/lib/view-models/detail';
import { C, FONT_MONO, card, cardSub, cardTitle } from '@/lib/design/tokens';

/**
 * "Samlad fastighetsrisk" – riskindex v1 (docs/decisions/0003-riskindex.md). Conservative by design:
 * only current official warnings can reach the high levels; every factor shows its source and reason,
 * and missing data is "Ej bedömd", never 0.
 */
export function PropertyRiskPanel({ d }: { d: DetailVM; isDemo?: boolean }) {
  return (
    <div style={{ ...card, padding: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={cardTitle}>Samlad fastighetsrisk</div>
          <div style={cardSub}>{d.riskMeta}</div>
        </div>
        <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 10, background: d.gauge.bg, color: d.gauge.c, whiteSpace: 'nowrap' }}>{d.gauge.label}</span>
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
        <ul style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0, listStyle: 'none', margin: 0, padding: 0 }}>
          {d.factors.map((f) => (
            <li key={f.label} title={f.title}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: C.text2, whiteSpace: 'nowrap' }}>{f.label}</span>
                <span style={{ fontFamily: FONT_MONO, color: C.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.v}</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: C.chip, overflow: 'hidden' }}>
                <div style={{ height: 4, borderRadius: 2, width: f.w, background: f.c, transition: 'width 1s' }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p style={{ margin: '14px 0 0', fontSize: 12.5, lineHeight: 1.5, color: C.text2 }}>{d.riskSummary}</p>
      <details style={{ marginTop: 8, fontSize: 12, color: C.text3 }}>
        <summary style={{ cursor: 'pointer', color: C.text2 }}>Så räknas poängen</summary>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5, lineHeight: 1.45 }}>
          {d.factors.map((f) => (
            <li key={f.label}>
              <b style={{ fontWeight: 500, color: C.text2 }}>{f.label}:</b> {f.title}
            </li>
          ))}
        </ul>
        <p style={{ margin: '8px 0 0', lineHeight: 1.45 }}>
          Poängen styrs av den tyngsta faktorn; övriga kan bara justera den inom samma nivå. Bara aktuella officiella varningar kan ge
          Förhöjd eller Hög – karterade scenarier, prognoser, trafik och utomhusluft ger högst Låg. Indexet bygger på offentliga källor och är
          inte en försäkrings- eller besiktningsbedömning.
        </p>
      </details>
    </div>
  );
}
