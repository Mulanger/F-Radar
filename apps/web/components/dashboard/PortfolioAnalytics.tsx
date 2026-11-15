'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import { C, card, cardSub, cardTitle } from '@/lib/design/tokens';

/** Properties affected per risk factor (status overview lives in the hero). */
export function PortfolioAnalytics({ vm }: { vm: OverviewVM }) {
  return (
    <div style={{ ...card, flex: '1.5 1 620px', padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div style={cardTitle}>Påverkade fastigheter per kategori</div>
        <div
          style={cardSub}
          title="Fastigheter där riskfaktorn når Bevaka eller högre. Karterade scenarier, regional information, trafik och utomhusluft räknas inte här."
        >
          Riskfaktor på Bevaka eller högre
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {vm.cats.map((c) => (
          <div key={c.label} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 32px', alignItems: 'center', gap: 12, fontSize: 13.5 }}>
            <span>{c.label}</span>
            <div style={{ height: 10, borderRadius: 5, background: '#F4F5F4', overflow: 'hidden', display: 'flex' }}>
              <div style={{ height: 10, width: c.w, background: c.c, borderRadius: 5, transition: 'width 1s' }} />
            </div>
            <b style={{ fontWeight: 600, textAlign: 'right' }}>{c.n}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export function UpcomingConditions({ vm }: { vm: OverviewVM }) {
  return (
    <div style={{ ...card, flex: '1 1 380px', padding: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ marginBottom: 8 }}>
        <div style={cardTitle}>Kommande förhållanden</div>
        <div style={cardSub}>Prognos och officiell information · kommande 48 h</div>
      </div>
      {vm.upcoming.length === 0 && (
        <div style={{ fontSize: 13, color: C.text3, padding: '12px 0' }}>
          {!vm.avail.weather ? 'Prognos otillgänglig' : 'Inga tillgängliga prognoser över de valda tröskelvärdena under de närmaste 48 h'}
        </div>
      )}
      {vm.upcoming.map((u) => (
        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: '1px solid rgba(20,23,26,0.05)' }}>
          <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: u.c }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: C.text3 }}>{u.label}</div>
            <div style={{ fontSize: 14, fontWeight: 500, marginTop: 2 }}>{u.where}</div>
            <div style={{ fontSize: 12, color: C.text4, marginTop: 2 }}>{u.when}</div>{u.explanation && <div style={{fontSize:11,color:C.text3,marginTop:2}}>{u.explanation}</div>}{u.source && <div style={{fontSize:11,color:C.text4,marginTop:2}}>{u.source}</div>}
          </div>
          <div style={{ fontSize: u.value.length > 12 ? 14 : 22, fontWeight: 500, letterSpacing: '-0.03em', whiteSpace: 'normal', maxWidth:'45%', overflowWrap:'anywhere' }}>{u.value}</div>
        </div>
      ))}
    </div>
  );
}
