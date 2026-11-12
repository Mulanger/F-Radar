'use client';

import type { DetailVM } from '@/lib/view-models/detail';
import { C, FONT_MONO, card, cardSub, cardTitle } from '@/lib/design/tokens';

/** Short activity timeline (not a permanent property journal – IMPLEMENTATION.md §2.2). */
export function PropertyTimeline({ d }: { d: DetailVM }) {
  return (
    <div style={{ ...card, flex: '1 1 380px', padding: 22 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={cardTitle}>Property Timeline</div>
        <div style={cardSub}>Warnings, triggers and resolved states</div>
      </div>
      {d.timeline.length === 0 ? (
        <div style={{ fontSize: 13, color: C.text3 }}>No recent activity</div>
      ) : (
        <ol
          style={{
            position: 'relative', display: 'flex', flexDirection: 'column', gap: 18, paddingLeft: 22, margin: 0, listStyle: 'none',
            backgroundImage: 'linear-gradient(#ECEEED,#ECEEED)', backgroundRepeat: 'no-repeat', backgroundSize: '1.5px calc(100% - 12px)', backgroundPosition: '5px 6px',
          }}
        >
          {d.timeline.map((t, i) => (
            <li key={i} style={{ position: 'relative', display: 'flex', gap: 12 }}>
              <span style={{ position: 'absolute', left: -22, top: 4, width: 12, height: 12, borderRadius: '50%', background: '#fff', border: `3px solid ${t.c}`, boxSizing: 'border-box' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{t.title}</div>
                <div style={{ fontSize: 12, color: C.text4, marginTop: 2 }}>{t.detail}</div>
              </div>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.text4, whiteSpace: 'nowrap' }}>{t.time}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
