'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import { useUpcoming } from '../upcoming/use-upcoming';
import { UpcomingDays, UpcomingDetail, UpcomingHeader, UpcomingSummary } from '../upcoming/UpcomingParts';
import styles from './mobile.module.css';

/** Mobile "Kommande förhållanden": summary, 48 h strip and rows, with a bottom sheet per row. */
export function MobileUpcoming({ vm }: { vm: OverviewVM }) {
  const st = useUpcoming(vm);
  return (
    <section className={styles.section} aria-label="Kommande förhållanden" data-testid="upcoming-panel">
      <div style={{ padding: '0 4px 10px' }}>
        <UpcomingHeader
          live={st.live}
          title={
            <div>
              <h2 className={styles.sectionTitle}>Kommande förhållanden</h2>
              <div className={styles.sectionSub}>Prognos · kommande 48 h</div>
            </div>
          }
        />
      </div>
      {!vm.avail.weather && vm.upcoming.length === 0 ? (
        <div className={`${styles.surface} ${styles.empty}`}>Prognos otillgänglig.</div>
      ) : (
        <div className={styles.surface} style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 12px 10px' }}>
          <UpcomingSummary st={st} />
          <UpcomingDays st={st} />
        </div>
      )}
      <UpcomingDetail st={st} variant="sheet" />
    </section>
  );
}
