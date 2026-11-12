'use client';

import type { DetailVM } from '@/lib/view-models/detail';
import { C, card, cardSub, cardTitle, tile } from '@/lib/design/tokens';

/** "Local Events & Disruptions" list + counters. */
export function LocalEventsPanel({ d }: { d: DetailVM }) {
  return (
    <div style={{ ...card, flex: '1 1 380px', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={cardTitle}>Local Events &amp; Disruptions</div>
        <div style={cardSub}>Within 1.5 km of the property</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {[
          ['Crisis events', d.crisisN],
          ['Traffic', d.trafficN],
          ['Other', d.otherN],
        ].map(([label, n]) => (
          <div key={label} style={tile}>
            <div style={{ fontSize: 11.5, color: C.text4 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 500 }}>{n}</div>
          </div>
        ))}
      </div>
      {!d.avail.events && (
        <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: C.text3, borderRadius: 14, background: '#F8F9F8' }}>
          Event sources (Krisinformation, Trafikverket) are not connected yet – nearby events cannot be shown.
        </div>
      )}
      {d.avail.events && d.noEvents && <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: C.text3, borderRadius: 14, background: '#F8F9F8' }}>No disruptions reported nearby</div>}
      {d.events.map((e) => (
        <div key={e.id} style={{ display: 'flex', gap: 12, padding: '12px 0', borderTop: '1px solid rgba(20,23,26,0.05)' }}>
          <span style={{ flexShrink: 0, alignSelf: 'flex-start', fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 7, background: e.bg, color: e.c }}>{e.kind}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, lineHeight: 1.35 }}>{e.title}</div>
            <div style={{ fontSize: 11.5, color: C.text4, marginTop: 3 }}>{e.src} · {e.dist} · {e.time}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
