'use client';

import { forwardRef } from 'react';
import type { DetailVM } from '@/lib/view-models/detail';
import { C, FONT_MONO, card, cardSub, cardTitle } from '@/lib/design/tokens';
import { Toggle } from '../ui/Toggle';
import { useRouter } from 'next/navigation';
import { useDashboard } from '@/lib/state/dashboard-state';

/**
 * Existing property panel, backed by persisted rules in live mode and isolated fixtures in demo.
 */
export const SMSRulesPanel = forwardRef<
  HTMLDivElement,
  { d: DetailVM; onToggleSms: () => void; onToggleRule: (ruleId: string, current: boolean) => void }
>(function SMSRulesPanel({ d, onToggleSms, onToggleRule }, ref) {
  const router=useRouter();
  const {smsInteractive}=useDashboard();
  const sms = d.sms;
  return (
    <div ref={ref} style={{ ...card, flex: '1.3 1 460px', padding: 22, display: 'flex', flexDirection: 'column', gap: 14, scrollMarginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={cardTitle}>SMS-larmregler</div>
          <div style={cardSub}>{d.live ? 'Testläge – inga riktiga SMS skickas' : sms.sub}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: C.text2 }}>{sms.label}</span>
          <Toggle size="lg" on={sms.on} disabled={!smsInteractive} onToggle={onToggleSms} label={`SMS-larm för ${d.name}`} />
          <button
            title="Konfigurera SMS-regler"
            onClick={()=>router.push(`/sms-rules?property=${encodeURIComponent(d.id)}`)}
            style={{ height: 36, padding: '0 14px', borderRadius: 18, background: C.white, border: '1px solid rgba(20,23,26,0.1)', fontSize: 13, cursor: 'pointer', color: C.ink }}
          >
            Redigera regler
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', opacity: sms.op, transition: 'opacity .3s' }}>
        {sms.rules.length === 0 && (
          <div style={{ padding: '16px 0', borderTop: '1px solid rgba(20,23,26,0.05)', fontSize: 13, color: C.text3 }}>
            Inga regler ännu. Välj Redigera regler för att konfigurera aviseringar i testläge.
          </div>
        )}
        {sms.rules.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0', borderTop: '1px solid rgba(20,23,26,0.05)' }}>
            <div style={{ width: 34, height: 34, borderRadius: 11, background: C.page, display: 'grid', placeItems: 'center', fontFamily: FONT_MONO, fontSize: 11, color: C.text2 }}>{r.code}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{r.name}</div>
              <div style={{ fontSize: 12, color: C.text4 }}>{r.cond}</div>
            </div>
            <span style={{ fontSize: 11.5, color: r.stateC }}>{d.live?(r.on?'Testläge aktivt':'Av'):r.state}</span>
            <Toggle on={r.on} disabled={!smsInteractive} onToggle={() => onToggleRule(r.id, r.on)} label={`Regel ${r.name}`} />
          </div>
        ))}
      </div>
    </div>
  );
});
