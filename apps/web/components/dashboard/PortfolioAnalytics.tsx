'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import { C, card, cardSub, cardTitle } from '@/lib/design/tokens';

/** "Portfolio Health": status distribution donut + properties affected by category. */
export function PortfolioAnalytics({ vm }: { vm: OverviewVM }) {
  return (
    <div style={{ ...card, flex: '1.5 1 620px', padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div style={cardTitle}>Varningsstatus</div>
        <div style={cardSub}>Statusfördelning och påverkade fastigheter per kategori</div>
      </div>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ position: 'relative', width: 150, height: 150 }}>
            <svg width="150" height="150" viewBox="0 0 150 150" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
              <circle cx="75" cy="75" r="54" fill="none" stroke={C.chip} strokeWidth="16" />
              {vm.donut.map((s) => (
                <circle key={s.key} cx="75" cy="75" r="54" fill="none" stroke={s.c} strokeWidth="16" strokeDasharray={s.dash} strokeDashoffset={s.off} style={{ transition: 'all 1s' }} />
              ))}
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-0.03em' }}>{vm.healthPct === null ? '—' : `${vm.healthPct}%`}</div>
                <div style={{ fontSize: 11.5, color: C.text4 }} title="Andel fastigheter utan aktiva officiella varningar i aktuella källor. Ingen bedömning av byggnadens säkerhet.">utan varning</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {vm.health.map((h) => (
              <div key={h.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, minWidth: 150 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: h.c }} />
                <span style={{ flex: 1 }}>{h.label}</span>
                <b style={{ fontWeight: 600 }}>{h.n}</b>
                <span style={{ color: C.text4, width: 36, textAlign: 'right' }}>{h.pct}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, color: C.text3 }} title="Fastigheter där riskfaktorn når Bevaka eller högre. Karterade scenarier, regional information, trafik och utomhusluft räknas inte här.">Fastigheter per riskfaktor · Bevaka eller högre</div>
          {vm.cats.map((c) => (
            <div key={c.label} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 24px', alignItems: 'center', gap: 12, fontSize: 13 }}>
              <span>{c.label}</span>
              <div style={{ height: 10, borderRadius: 5, background: '#F4F5F4', overflow: 'hidden', display: 'flex' }}>
                <div style={{ height: 10, width: c.w, background: c.c, borderRadius: 5, transition: 'width 1s' }} />
              </div>
              <b style={{ fontWeight: 600, textAlign: 'right' }}>{c.n}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function UpcomingConditions({ vm }: { vm: OverviewVM }) {
  return (
    <div style={{ ...card, flex: '1 1 380px', padding: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ marginBottom: 8 }}>
        <div style={cardTitle}>Kommande förhållanden</div>
        <div style={cardSub}>Prognos för portföljen · kommande 24 h</div>
      </div>
      {vm.upcoming.length === 0 && (
        <div style={{ fontSize: 13, color: C.text3, padding: '12px 0' }}>
          {!vm.avail.weather ? 'Prognos otillgänglig' : 'Inga prognoser över tröskelvärdena (byvind ≥ 15 m/s, nederbörd ≥ 15 mm/24 h, minusgrader) de närmaste 24 h'}
        </div>
      )}
      {vm.upcoming.map((u) => (
        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: '1px solid rgba(20,23,26,0.05)' }}>
          <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: u.c }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: C.text3 }}>{u.label}</div>
            <div style={{ fontSize: 14, fontWeight: 500, marginTop: 2 }}>{u.where}</div>
            <div style={{ fontSize: 12, color: C.text4, marginTop: 2 }}>{u.when}</div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.03em', whiteSpace: 'nowrap' }}>{u.value}</div>
        </div>
      ))}
    </div>
  );
}
