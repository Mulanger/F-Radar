'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import { C, glass } from '@/lib/design/tokens';
import styles from './PortfolioOverview.module.css';
import { IconAlert, IconBellSimple, IconBuildingSimple, IconMessage, IconRain } from '../ui/icons';

const kpiCard: React.CSSProperties = {
  ...glass(0.72, 16),
  borderRadius: 14,
  padding: '10px 12px',
  minWidth: 0,
  minHeight: 84,
  boxSizing: 'border-box',
  boxShadow: '0 10px 28px -20px rgba(20,23,26,0.25)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  transition: 'transform .25s,box-shadow .25s,background .25s',
};
const big: React.CSSProperties = { fontSize: 22, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1 };
const foot: React.CSSProperties = { fontSize: 11, color: C.text4 };

function KpiHead({ icon, bg, fg, label }: { icon: React.ReactNode; bg: string; fg: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.text3, minWidth: 0 }}>
      <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 6, background: bg, display: 'grid', placeItems: 'center', color: fg }}>{icon}</span>
      <span title={label} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}

export function PortfolioKPIs({ vm }: { vm: OverviewVM }) {
  const k = vm.kpi;
  const a = vm.avail;
  // Live data without connected sources: show "—", never 0 (0 would read as "no risk").
  const v = (ok: boolean, value: React.ReactNode) => (ok ? value : '—');
  return (
    <div className={styles.kpis}>
      <div className={`fr-hover-lift ${styles.kpi}`} style={kpiCard} title={k.barLabel}>
        <KpiHead icon={<IconBuildingSimple size={11} sw={1.8} />} bg={C.chip} fg={C.ink} label="Fastigheter totalt" />
        <div style={big}>{k.total}</div>
        <div style={{ display: 'flex', gap: 3, height: 6, marginTop: 'auto' }}>
          {k.bar.map((b) => (
            <div key={b.key} style={{ height: 6, borderRadius: 3, width: b.w, background: b.c }} />
          ))}
        </div>
      </div>

      <div className={`fr-hover-lift ${styles.kpi}`} style={kpiCard}>
        <KpiHead icon={<IconBellSimple size={11} />} bg="oklch(0.95 0.035 30)" fg="oklch(0.56 0.17 28)" label="Aktiva larm" />
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
          <div style={big}>{v(a.alerts, k.alerts)}</div>
          {k.spark && (
            <svg width="44" height="18" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
              <path d={k.spark} fill="none" stroke="oklch(0.6 0.17 28)" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
        </div>
        {!a.alerts && <div style={foot}>Ej ansluten ännu</div>}
      </div>

      <div className={`fr-hover-lift ${styles.kpi}`} style={kpiCard}>
        <KpiHead icon={<IconAlert size={11} sw={1.8} />} bg="oklch(0.95 0.06 95)" fg="oklch(0.5 0.1 85)" label="Officiella varningar" />
        <div style={big}>{v(a.warnings, k.warnings)}</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 'auto' }}>
          {k.warnChips.map((w) => (
            <span key={w.key} style={{ fontSize: 10, fontWeight: 500, padding: '2px 6px', borderRadius: 6, background: w.bg, color: w.fg }}>{w.label}</span>
          ))}
        </div>
        {!a.warnings && <div style={foot}>Källor ej anslutna</div>}
      </div>

      <div className={`fr-hover-lift ${styles.kpi}`} style={kpiCard}>
        <KpiHead icon={<IconRain size={11} />} bg="oklch(0.95 0.03 230)" fg="oklch(0.52 0.1 235)" label="Väderhändelser idag" />
        <div style={big}>{v(a.weather, k.wx)}</div>
        <div style={{ display: 'flex', gap: 4, marginTop: 'auto', flexWrap: 'wrap' }}>
          {k.wxSplit.map((x) => (
            <span key={x.label} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: C.chip, color: C.text2 }}>
              {x.label} <b style={{ fontWeight: 600, color: C.ink }}>{a.weather ? x.n : '—'}</b>
            </span>
          ))}
        </div>
        {!a.weather && <div style={foot}>Prognos ej ansluten</div>}
      </div>

      <div className={`fr-hover-lift ${styles.kpi}`} style={{ ...kpiCard, gridColumn: '1 / -1' }}>
        <KpiHead icon={<IconMessage size={11} sw={1.8} />} bg="oklch(0.95 0.035 155)" fg="oklch(0.52 0.12 155)" label="Aktiva SMS-regler" />
        <div style={big}>{v(a.alerts, k.sms)}</div>
        <div style={{ height: 6, borderRadius: 3, background: C.chip, marginTop: 'auto', overflow: 'hidden' }}>
          <div style={{ height: 6, borderRadius: 3, background: 'oklch(0.65 0.13 155)', width: k.smsW, transition: 'width .8s' }} />
        </div>
        {!a.alerts && <div style={foot}>SMS ej aktiverat</div>}
      </div>
    </div>
  );
}
