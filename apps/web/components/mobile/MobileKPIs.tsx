import type { OverviewVM } from '@/lib/view-models/overview';
import { C } from '@/lib/design/tokens';
import { OnOffToggle } from '../ui/OnOffToggle';
import { IconBuildingSimple, IconBellSimple, IconAlert, IconRain, IconMessage } from '../ui/icons';
import styles from './mobile.module.css';

export function MobileKPIs({ vm }: { vm: OverviewVM }) {
  const k = vm.kpi, a = vm.avail;
  const head = (icon: React.ReactNode, label: string, bg: string, color: string) => <div className={styles.kpiHead}><span className={styles.kpiIcon} style={{ background: bg, color }}>{icon}</span>{label}</div>;
  // Small first-row card; its layout adapts to the card's own width (see .smallInner in mobile.module.css).
  const small = (icon: React.ReactNode, label: string, bg: string, color: string, value: React.ReactNode, title?: string) => <div className={`${styles.kpi} ${styles.smallKpi}`} title={title}><div className={styles.smallInner}><span className={styles.kpiIcon} style={{ background: bg, color }}>{icon}</span><div className={styles.smallValue}>{value}</div><div className={styles.smallLabel}>{label}</div></div></div>;
  return <div className={styles.kpis} style={{ gridTemplateColumns: 'repeat(6,minmax(0,1fr))' }}>
    {small(<IconBuildingSimple size={14} />, 'Fastigheter', C.chip, C.ink, <div className={styles.kpiValue} style={{ fontSize: 24 }}>{k.total}</div>, k.barLabel)}
    {small(<IconBellSimple size={14} />, 'Aktiva larm', 'oklch(.95 .035 30)', 'oklch(.56 .17 28)', <div className={styles.kpiValue} style={{ fontSize: 24 }}>{a.alerts ? k.alerts : '—'}</div>)}
    {small(<IconMessage size={14} />, 'SMS-larm', 'oklch(.95 .035 155)', 'oklch(.52 .12 155)', <span role="img" aria-label={k.smsOn ? 'SMS-larm aktiverat' : 'SMS-larm inte aktiverat'} style={{ display: 'grid' }}><OnOffToggle on={k.smsOn} width={36} /></span>, a.alerts ? k.smsSub : 'SMS-larm är inte aktiverade')}
    <div className={styles.kpi} style={{ gridColumn: 'span 3' }}>{head(<IconAlert size={14} />, 'Officiella varningar', 'oklch(.95 .06 95)', 'oklch(.5 .1 85)')}<div className={styles.kpiValue}>{a.warnings ? k.warnings : '—'}</div><div className={styles.kpiGraphic}>{k.warnChips.map(w => <span className={styles.chip} key={w.key} style={{ background: w.bg, color: w.fg }}>{w.label}</span>)}</div><div className={styles.small}>{a.warnings ? `Berör ${k.warnAffected} fastigheter` : 'Källor ej anslutna'}</div></div>
    <div className={styles.kpi} style={{ gridColumn: 'span 3' }}>{head(<IconRain size={14} />, 'Väderhändelser idag', 'oklch(.95 .03 230)', 'oklch(.52 .1 235)')}<div className={styles.kpiValue}>{a.weather ? k.wx : '—'}</div><div className={styles.kpiGraphic}>{k.wxSplit.map(w => <span className={styles.chip} key={w.label}>{w.label} <b>{a.weather ? w.n : '—'}</b></span>)}</div><div className={styles.small}>{a.weather ? 'Över tröskelvärden 24 h' : 'Prognos ej ansluten'}</div></div>
  </div>;
}
