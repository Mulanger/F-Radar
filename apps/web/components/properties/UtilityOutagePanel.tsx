'use client';

import type { OutagePanelVM, OutageRowVM } from '@/lib/view-models/utility-outages';
import { C, FONT_MONO, card, cardSub, cardTitle } from '@/lib/design/tokens';

/**
 * "Elnät" – grid operator outages for the property (docs/plans/stromavbrott.md §8).
 * Red = unplanned outage covering the address, orange = planned work in progress / uncertain,
 * blue = planned work ahead or area-level information, green = restored.
 */
function Row({ r }: { r: OutageRowVM }) {
  return (
    <div style={{ padding: 14, borderRadius: 16, background: '#F8F9F8', border: '1px solid rgba(20,23,26,0.05)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 8px', borderRadius: 7, background: r.tone.bg, color: r.tone.c }}>{r.badge}</span>
        <span style={{ fontSize: 13.5, fontWeight: 500 }}>{r.title}</span>
      </div>
      <div style={{ fontSize: 12, color: C.text3 }}>{r.precision}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '4px 12px', fontSize: 11.5, color: C.text4 }}>
        {r.facts.map(([k, v]) => (
          <span key={k}>
            {k} <b style={{ fontWeight: 500, color: C.text2 }}>{v}</b>
          </span>
        ))}
      </div>
      {r.operatorText && (
        <div style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.5, textWrap: 'pretty' }}>
          <span style={{ color: C.text4 }}>Nätbolaget: </span>”{r.operatorText}”
        </div>
      )}
      <div style={{ fontSize: 11, color: C.text4 }}>
        {r.sourceUrl ? (
          <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.text3 }}>
            {r.sourceLine}
          </a>
        ) : (
          r.sourceLine
        )}
      </div>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: OutageRowVM[] }) {
  if (!rows.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
      {rows.map((r) => (
        <Row key={r.id} r={r} />
      ))}
    </div>
  );
}

export function UtilityOutagePanel({ vm }: { vm: OutagePanelVM }) {
  if (!vm.available) return null;
  const st = vm.state;
  return (
    <section aria-label="Strömavbrott" style={{ ...card, flex: '1 1 100%', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={cardTitle}>{vm.title}</div>
          <div style={cardSub}>{vm.subtitle}</div>
        </div>
        <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.text3 }}>
          {vm.current.length} pågående · {vm.upcoming.length} planerade
        </span>
      </div>
      {st && (
        <div role="status" style={{ padding: '14px 16px', borderRadius: 16, background: st.tone.bg, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: st.tone.c }}>{st.label}</div>
          <div style={{ fontSize: 12.5, color: C.text2 }}>{st.detail}</div>
        </div>
      )}
      <Section title="Pågående" rows={vm.current} />
      <Section title="Kommande planerade" rows={vm.upcoming} />
      <Section title="Nyligen återställt" rows={vm.restored} />
      <Section title="I närheten – inte bekräftat att fastigheten berörs" rows={vm.nearby} />
      <div style={{ fontSize: 11, color: C.text4, lineHeight: 1.45 }}>{vm.footer}</div>
    </section>
  );
}
