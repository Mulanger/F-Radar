'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import { C, glass } from '@/lib/design/tokens';
import styles from './PortfolioOverview.module.css';
import { IconAlert, IconBellSimple, IconBuildingSimple, IconMessage, IconRain } from '../ui/icons';
import { OnOffToggle } from '../ui/OnOffToggle';
import { WeatherKpiPills } from './WeatherKpiPills';

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
/** Compact cards on the first row: label + value only. */
const smallCard: React.CSSProperties = { ...kpiCard, minHeight: 0, padding: '9px 10px', gap: 7, gridColumn: 'span 2' };
const wideCard: React.CSSProperties = { ...kpiCard, gridColumn: 'span 3' };
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

/** Small first-row card: icon left, value centred in the space beside it, the label underneath at full width. */
function SmallKpi({ icon, bg, fg, label, title, children }: { icon: React.ReactNode; bg: string; fg: string; label: string; title?: string; children: React.ReactNode }) {
  return (
    <div className={`fr-hover-lift ${styles.kpi}`} style={smallCard} title={title}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26 }}>
        <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 8, background: bg, display: 'grid', placeItems: 'center', color: fg }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>{children}</div>
      </div>
      <div style={{ fontSize: 11, color: C.text3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
    </div>
  );
}

export function PortfolioKPIs({ vm }: { vm: OverviewVM }) {
  const k = vm.kpi;
  const a = vm.avail;
  // Live data without connected sources: show "—", never 0 (0 would read as "no risk").
  const v = (ok: boolean, value: React.ReactNode) => (ok ? value : '—');
  return (
    <div className={styles.kpis} style={{ gridTemplateColumns: 'repeat(6,minmax(0,1fr))' }}>
      <SmallKpi icon={<IconBuildingSimple size={11} sw={1.8} />} bg={C.chip} fg={C.ink} label="Fastigheter" title={k.barLabel}>
        <div style={big}>{k.total}</div>
      </SmallKpi>

      <SmallKpi icon={<IconBellSimple size={11} />} bg="oklch(0.95 0.035 30)" fg="oklch(0.56 0.17 28)" label="Aktiva larm" title={a.alerts ? undefined : 'Ej ansluten ännu'}>
        <div style={big}>{v(a.alerts, k.alerts)}</div>
      </SmallKpi>

      <SmallKpi icon={<IconMessage size={11} sw={1.8} />} bg="oklch(0.95 0.035 155)" fg="oklch(0.52 0.12 155)" label="SMS-larm" title={a.alerts ? k.smsSub : 'SMS-larm är inte aktiverade · inga SMS skickas'}>
        <span role="img" aria-label={k.smsOn ? 'SMS-larm aktiverat' : 'SMS-larm inte aktiverat'} style={{ display: 'grid' }}>
          <OnOffToggle on={k.smsOn} width={32} />
        </span>
      </SmallKpi>

      <div className={`fr-hover-lift ${styles.kpi}`} style={wideCard}>
        <KpiHead icon={<IconAlert size={11} sw={1.8} />} bg="oklch(0.95 0.06 95)" fg="oklch(0.5 0.1 85)" label="Officiella varningar" />
        <div style={big}>{v(a.warnings, k.warnings)}</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 'auto' }}>
          {k.warnChips.map((w) => (
            <span key={w.key} style={{ fontSize: 10, fontWeight: 500, padding: '2px 6px', borderRadius: 6, background: w.bg, color: w.fg }}>{w.label}</span>
          ))}
        </div>
        {!a.warnings && <div style={foot}>Källor ej anslutna</div>}
      </div>

      <div className={`fr-hover-lift ${styles.kpi}`} style={wideCard}>
        <KpiHead icon={<IconRain size={11} />} bg="oklch(0.95 0.03 230)" fg="oklch(0.52 0.1 235)" label="Väderhändelser idag" />
        <div style={big}>{v(a.weather, k.wx)}</div>
        <div style={{ display: 'flex', gap: 4, marginTop: 'auto', flexWrap: 'wrap' }}>
          <WeatherKpiPills split={k.wxSplit} available={a.weather} pillStyle={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: C.chip, color: C.text2 }} />
        </div>
        {!a.weather && <div style={foot}>Prognos ej ansluten</div>}
      </div>
    </div>
  );
}
