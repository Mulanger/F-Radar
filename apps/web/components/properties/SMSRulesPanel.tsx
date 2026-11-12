'use client';

import { forwardRef } from 'react';
import type { DetailVM } from '@/lib/view-models/detail';
import { C, FONT_MONO, card, cardSub, cardTitle } from '@/lib/design/tokens';
import { Toggle } from '../ui/Toggle';

/**
 * SMS alert rules for the property. Toggles change LOCAL UI state only in this phase –
 * nothing is persisted and no SMS is ever sent (IMPLEMENTATION.md §12, Phase 8).
 */
export const SMSRulesPanel = forwardRef<
  HTMLDivElement,
  { d: DetailVM; onToggleSms: () => void; onToggleRule: (ruleId: string, current: boolean) => void }
>(function SMSRulesPanel({ d, onToggleSms, onToggleRule }, ref) {
  const sms = d.sms;
  return (
    <div ref={ref} style={{ ...card, flex: '1.3 1 460px', padding: 22, display: 'flex', flexDirection: 'column', gap: 14, scrollMarginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={cardTitle}>SMS Alert Rules</div>
          <div style={cardSub}>{d.avail.alerts ? sms.sub : 'SMS alerts arrive in a later phase · no SMS is sent'}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: C.text2 }}>{sms.label}</span>
          <Toggle size="lg" on={sms.on} disabled={!d.avail.alerts} onToggle={onToggleSms} label={`SMS alerts for ${d.name}`} />
          <button
            title="Rule editor is implemented with the alert-rules API (Agent 2)"
            style={{ height: 36, padding: '0 14px', borderRadius: 18, background: C.white, border: '1px solid rgba(20,23,26,0.1)', fontSize: 13, cursor: 'pointer', color: C.ink }}
          >
            Edit rules
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', opacity: sms.op, transition: 'opacity .3s' }}>
        {sms.rules.length === 0 && (
          <div style={{ padding: '16px 0', borderTop: '1px solid rgba(20,23,26,0.05)', fontSize: 13, color: C.text3 }}>
            No alert rules yet. Rule configuration and SMS delivery are implemented in a later phase.
          </div>
        )}
        {sms.rules.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0', borderTop: '1px solid rgba(20,23,26,0.05)' }}>
            <div style={{ width: 34, height: 34, borderRadius: 11, background: C.page, display: 'grid', placeItems: 'center', fontFamily: FONT_MONO, fontSize: 11, color: C.text2 }}>{r.code}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{r.name}</div>
              <div style={{ fontSize: 12, color: C.text4 }}>{r.cond}</div>
            </div>
            <span style={{ fontSize: 11.5, color: r.stateC }}>{r.state}</span>
            <Toggle on={r.on} onToggle={() => onToggleRule(r.id, r.on)} label={`${r.name} rule`} />
          </div>
        ))}
      </div>
    </div>
  );
});
