import type { OverviewVM } from '@/lib/view-models/overview';
import { MobileSection } from './MobilePrimitives';
import styles from './mobile.module.css';
import { MobileUpcoming } from './MobileUpcoming';

export function MobilePortfolioAnalytics({ vm }: { vm: OverviewVM }) {
  return <>
    <MobileSection title="Påverkade fastigheter per kategori" subtitle="Riskfaktor på nivå Info eller högre">
      <div className={`${styles.surface} ${styles.health}`}>
        {vm.notAssessed > 0 && <div className={styles.small}>{vm.notAssessed} fastigheter är ännu inte bedömda.</div>}
        <div className={styles.factors}>{vm.cats.map(c => <div className={styles.factor} key={c.label}><span>{c.label}</span><div className={styles.factorTrack}><div style={{ width: c.w, background: c.c }} /></div><b style={{ textAlign: 'right' }}>{c.n}</b></div>)}</div>
      </div>
    </MobileSection>
    <MobileUpcoming vm={vm} />
  </>;
}
