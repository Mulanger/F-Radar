'use client';

import type { DetailVM } from '@/lib/view-models/detail';
import { C, FONT_MONO, card, cardSub, cardTitle } from '@/lib/design/tokens';

/**
 * Official warnings panel. "No active warnings" is only meaningful when the warning
 * source was fetched successfully and is fresh (IMPLEMENTATION.md §9.2). In demo mode the
 * fixture defines that state; live mode must pass the source status through (Agent 2).
 */
export function OfficialWarnings({ d }: { d: DetailVM }) {
  return (
    <div style={{ ...card, flex: 1, padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={cardTitle}>Officiella varningar</div>
          <div style={cardSub}>SMHI · Krisinformation</div>
        </div>
        <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.text3 }}>{d.avail.warnings ? `${d.warnN} aktiva` : 'ej ansluten'}</span>
      </div>
      {!d.avail.warnings && (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 20, borderRadius: 16, background: '#F8F9F8' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: C.text2 }}>Varningar otillgängliga</div>
            <div style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>
              SMHI och Krisinformation har inte kunnat hämtas. Det betyder inte att varningar saknas.
            </div>
          </div>
        </div>
      )}
      {d.avail.warnings && d.noWarnings && (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 20, borderRadius: 16, background: 'oklch(0.97 0.02 155)' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'oklch(0.45 0.11 155)' }}>Inga aktiva officiella varningar</div>
            <div style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>Inget utfärdat som omfattar fastighetens läge</div>
          </div>
        </div>
      )}
      {d.warnings.map((w) => (
        <div key={w.id} style={{ padding: 14, borderRadius: 16, background: '#F8F9F8', border: '1px solid rgba(20,23,26,0.05)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 8px', borderRadius: 7, background: w.bg, color: w.fg }}>{w.levelLabel}</span>
            <span style={{ fontSize: 13.5, fontWeight: 500 }}>{w.type}</span>
          </div>
          <div style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.5, textWrap: 'pretty' }}>{w.summary}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 11.5, color: C.text4 }}>
            <span>Från <b style={{ fontWeight: 500, color: C.text2 }}>{w.start}</b></span>
            <span>Till <b style={{ fontWeight: 500, color: C.text2 }}>{w.end}</b></span>
            <span>{w.src}</span>
            <span>{w.region}</span>
          </div>
        </div>
      ))}
      {d.live && <div style={{ fontSize: 11, color: C.text4, lineHeight: 1.45 }}>{d.live.warningsLine} · Officiell text visas oförändrad.</div>}
    </div>
  );
}
