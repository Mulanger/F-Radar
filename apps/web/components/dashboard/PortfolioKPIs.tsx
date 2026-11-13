'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import { C, smallCard } from '@/lib/design/tokens';
import { IconAlert, IconBellSimple, IconBuildingSimple, IconMessage, IconRain, IconShield } from '../ui/icons';

const kpiCard: React.CSSProperties = {
  ...smallCard,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  transition: 'transform .25s,box-shadow .25s',
};
const big: React.CSSProperties = { fontSize: 34, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1 };
const foot: React.CSSProperties = { fontSize: 11.5, color: C.text4 };

function KpiHead({ icon, bg, fg, label }: { icon: React.ReactNode; bg: string; fg: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: C.text3 }}>
      <span style={{ width: 28, height: 28, borderRadius: 9, background: bg, display: 'grid', placeItems: 'center', color: fg }}>{icon}</span>
      {label}
    </div>
  );
}

export function PortfolioKPIs({ vm }: { vm: OverviewVM }) {
  const k = vm.kpi;
  const a = vm.avail;
  // Live data without connected sources: show "—", never 0 (0 would read as "no risk").
  const v = (ok: boolean, value: React.ReactNode) => (ok ? value : '—');
  return (
    <div style={{ flex: '1 1 420px', display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 14 }}>
      <div className="fr-hover-lift" style={kpiCard}>
        <KpiHead icon={<IconBuildingSimple size={15} sw={1.8} />} bg={C.chip} fg={C.ink} label="Fastigheter totalt" />
        <div style={big}>{k.total}</div>
        <div style={{ display: 'flex', gap: 3, height: 6, marginTop: 'auto' }}>
          {k.bar.map((b) => (
            <div key={b.key} style={{ height: 6, borderRadius: 3, width: b.w, background: b.c }} />
          ))}
        </div>
        <div style={foot}>{k.barLabel}</div>
      </div>

      <div className="fr-hover-lift" style={kpiCard}>
        <KpiHead icon={<IconBellSimple />} bg="oklch(0.95 0.035 30)" fg="oklch(0.56 0.17 28)" label="Aktiva larm" />
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
          <div style={big}>{v(a.alerts, k.alerts)}</div>
          {k.spark && (
            <svg width="90" height="30" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
              <path d={k.spark} fill="none" stroke="oklch(0.6 0.17 28)" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
        </div>
        <div style={{ ...foot, marginTop: 'auto' }}>
          {k.alertsDelta ? (
            <>
              <span style={{ color: 'oklch(0.56 0.17 28)' }}>{k.alertsDelta}</span> {k.alertsSince}
            </>
          ) : (
            a.alerts ? 'Ingen historik ännu' : 'Ej ansluten ännu'
          )}
        </div>
      </div>

      <div className="fr-hover-lift" style={kpiCard}>
        <KpiHead icon={<IconShield />} bg="oklch(0.95 0.045 65)" fg="oklch(0.6 0.15 55)" label="Fastigheter med varning" />
        <div style={big}>
          {v(a.warnings || a.weather, k.atRisk)}
          <span style={{ fontSize: 15, color: C.text4 }}> av {k.total}</span>
        </div>
        <div style={{ display: 'flex', gap: 5, marginTop: 'auto' }}>
          {k.dots.map((d) => (
            <span key={d.id} style={{ width: 12, height: 12, borderRadius: 4, background: d.c }} />
          ))}
        </div>
        <div style={foot}>{a.warnings || a.weather ? 'Orange, röd varning eller VMA' : 'Status kräver anslutna källor'}</div>
      </div>

      <div className="fr-hover-lift" style={kpiCard}>
        <KpiHead icon={<IconAlert size={15} sw={1.8} />} bg="oklch(0.95 0.06 95)" fg="oklch(0.5 0.1 85)" label="Officiella varningar" />
        <div style={big}>{v(a.warnings, k.warnings)}</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 'auto' }}>
          {k.warnChips.map((w) => (
            <span key={w.key} style={{ fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 8, background: w.bg, color: w.fg }}>{w.label}</span>
          ))}
        </div>
        <div style={foot}>{a.warnings ? `Berör ${k.warnAffected} fastigheter` : 'SMHI / Krisinformation ej anslutna ännu'}</div>
      </div>

      <div className="fr-hover-lift" style={kpiCard}>
        <KpiHead icon={<IconRain />} bg="oklch(0.95 0.03 230)" fg="oklch(0.52 0.1 235)" label="Väderhändelser idag" />
        <div style={big}>{v(a.weather, k.wx)}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 'auto', flexWrap: 'wrap' }}>
          {k.wxSplit.map((x) => (
            <span key={x.label} style={{ fontSize: 11.5, padding: '3px 8px', borderRadius: 8, background: C.chip, color: C.text2 }}>
              {x.label} <b style={{ fontWeight: 600, color: C.ink }}>{x.n}</b>
            </span>
          ))}
        </div>
        <div style={foot}>{a.weather ? 'Prognos över tröskelvärden kommande 24 h' : 'SMHI-prognos ej ansluten ännu'}</div>
      </div>

      <div className="fr-hover-lift" style={kpiCard}>
        <KpiHead icon={<IconMessage size={15} sw={1.8} />} bg="oklch(0.95 0.035 155)" fg="oklch(0.52 0.12 155)" label="Aktiva SMS-regler" />
        <div style={big}>{v(a.alerts, k.sms)}</div>
        <div style={{ height: 6, borderRadius: 3, background: C.chip, marginTop: 'auto', overflow: 'hidden' }}>
          <div style={{ height: 6, borderRadius: 3, background: 'oklch(0.65 0.13 155)', width: k.smsW, transition: 'width .8s' }} />
        </div>
        <div style={foot}>{a.alerts ? k.smsSub : 'SMS-larm är inte aktiverade · inga SMS skickas'}</div>
      </div>
    </div>
  );
}
