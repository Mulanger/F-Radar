'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import { useUpcoming } from '../upcoming/use-upcoming';
import { UpcomingChips, UpcomingDays, UpcomingDetail, UpcomingHeader, UpcomingTiles } from '../upcoming/UpcomingParts';
import styles from './mobile.module.css';

/** Mobile "Kommande förhållanden" (design: MobilDashboard rework) with a bottom sheet per event. */
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
              <div className={styles.sectionSub}>Portföljprognos · kommande 48 h</div>
            </div>
          }
        />
      </div>
      {!vm.avail.weather && vm.upcoming.length === 0 ? (
        <div className={`${styles.surface} ${styles.empty}`}>Prognos otillgänglig.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <UpcomingTiles sum={st.view.sum} />
            {st.view.chips.length > 2 && <UpcomingChips chips={st.view.chips} onSelect={st.setFilter} style={{ margin: '12px -16px 0', padding: '0 16px' }} />}
          </div>
          <UpcomingDays st={st} />
        </div>
      )}
      <UpcomingDetail st={st} variant="sheet" />
    </section>
  );
}
