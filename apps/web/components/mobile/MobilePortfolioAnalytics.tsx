import type { OverviewVM } from '@/lib/view-models/overview';
import { MobileSection } from './MobilePrimitives';
import styles from './mobile.module.css';

export function MobilePortfolioAnalytics({ vm }: { vm: OverviewVM }) {
  return <>
    <MobileSection title="Påverkade fastigheter per kategori" subtitle="Riskfaktor på Bevaka eller högre">
      <div className={`${styles.surface} ${styles.health}`}>
        {vm.notAssessed > 0 && <div className={styles.small}>{vm.notAssessed} fastigheter är ännu inte bedömda.</div>}
        <div className={styles.factors}>{vm.cats.map(c => <div className={styles.factor} key={c.label}><span>{c.label}</span><div className={styles.factorTrack}><div style={{ width: c.w, background: c.c }} /></div><b style={{ textAlign: 'right' }}>{c.n}</b></div>)}</div>
      </div>
    </MobileSection>
    <MobileSection title="Kommande förhållanden" subtitle="Portföljprognos · kommande 48 h"><div className={`${styles.surface} ${styles.upcoming}`}>
      {!vm.upcoming.length && <div className={styles.empty}>{vm.avail.weather ? 'Inga tillgängliga prognoser över tröskelvärdena.' : 'Prognos otillgänglig.'}</div>}
      {vm.upcoming.map(u => <div className={styles.upcomingRow} key={u.id}><span className={styles.upcomingBar} style={{ background: u.c }} /><div style={{ flex: 1, minWidth: 0 }}><div className={styles.sectionSub}>{u.label}</div><div style={{ fontSize: 14, fontWeight: 500, marginTop: 2 }}>{u.where}</div><div className={styles.meta} style={{ marginTop: 2 }}>{u.when}</div>{u.source && <div className={styles.small}>{u.source}</div>}{u.explanation && <div className={styles.small}>{u.explanation}</div>}</div><div className={styles.upcomingValue} style={{ fontSize: u.value.length > 12 ? 14 : undefined }}>{u.value}</div></div>)}
    </div></MobileSection>
  </>;
}
