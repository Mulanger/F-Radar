'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import { card, cardSub, cardTitle } from '@/lib/design/tokens';

/** Properties affected per risk factor (status overview lives in the hero). */
export function PortfolioAnalytics({ vm }: { vm: OverviewVM }) {
  return (
    <div style={{ ...card, flex: '1 1 340px', alignSelf: 'flex-start', padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
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
