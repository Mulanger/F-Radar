import type { OverviewVM } from '@/lib/view-models/overview';
import { MobileSection, shortStatus } from './MobilePrimitives';
import styles from './mobile.module.css';

export function MobilePortfolioAnalytics({ vm }: { vm: OverviewVM }) {
  return <>
    <MobileSection title="Varningsstatus" subtitle="Statusfördelning och påverkan per kategori">
      <div className={`${styles.surface} ${styles.health}`}>
        <div className={styles.healthTop}>
          <div className={styles.donut}>
            <svg width="100%" height="100%" viewBox="0 0 150 150" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true"><circle cx="75" cy="75" r="54" fill="none" stroke="#F1F3F2" strokeWidth="16" />{vm.donut.map(s => <circle key={s.key} cx="75" cy="75" r="54" fill="none" stroke={s.c} strokeWidth="16" strokeDasharray={s.dash} strokeDashoffset={s.off} style={{ transition: 'all 1s' }} />)}</svg>
            <div className={styles.donutCenter}>{vm.healthPct === null ? '—' : `${vm.healthPct}%`}<span className={styles.small} style={{ fontWeight: 400, letterSpacing: 0 }}>utan varning</span></div>
          </div>
          <div className={styles.healthList}>{vm.health.map(h => <div className={styles.healthRow} key={h.key}><span style={{ width: 9, height: 9, background: h.c, borderRadius: 3 }} /><span>{shortStatus(h.label)}</span><b>{h.n}</b><span>{h.pct}</span></div>)}</div>
        </div>
        {vm.notAssessed > 0 && <div className={styles.small}>{vm.notAssessed} fastigheter är ännu inte bedömda.</div>}
        <div className={styles.factors}><div className={styles.sectionSub}>Riskfaktorer · fastigheter på Bevaka eller högre</div>{vm.cats.map(c => <div className={styles.factor} key={c.label}><span>{c.label}</span><div className={styles.factorTrack}><div style={{ width: c.w, background: c.c }} /></div><b style={{ textAlign: 'right' }}>{c.n}</b></div>)}</div>
      </div>
    </MobileSection>
    <MobileSection title="Kommande förhållanden" subtitle="Portföljprognos · kommande 48 h"><div className={`${styles.surface} ${styles.upcoming}`}>
      {!vm.upcoming.length && <div className={styles.empty}>{vm.avail.weather ? 'Inga tillgängliga prognoser över tröskelvärdena.' : 'Prognos otillgänglig.'}</div>}
      {vm.upcoming.map(u => <div className={styles.upcomingRow} key={u.id}><span className={styles.upcomingBar} style={{ background: u.c }} /><div style={{ flex: 1, minWidth: 0 }}><div className={styles.sectionSub}>{u.label}</div><div style={{ fontSize: 14, fontWeight: 500, marginTop: 2 }}>{u.where}</div><div className={styles.meta} style={{ marginTop: 2 }}>{u.when}</div>{u.source && <div className={styles.small}>{u.source}</div>}{u.explanation && <div className={styles.small}>{u.explanation}</div>}</div><div className={styles.upcomingValue} style={{ fontSize: u.value.length > 12 ? 14 : undefined }}>{u.value}</div></div>)}
    </div></MobileSection>
  </>;
}
