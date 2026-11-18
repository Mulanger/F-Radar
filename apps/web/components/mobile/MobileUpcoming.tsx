'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import { useUpcoming } from '../upcoming/use-upcoming';
import { UpcomingChips, UpcomingHeader, UpcomingHeadline, UpcomingListMobile } from '../upcoming/UpcomingParts';
import styles from './mobile.module.css';
import up from '../upcoming/Upcoming.module.css';

/** Mobile "Kommande förhållanden" (designer's 1b): one card with headline, chips and the per-property bars. */
export function MobileUpcoming({ vm }: { vm: OverviewVM }) {
  const st = useUpcoming(vm);
  return (
    <section className={styles.section} aria-label="Kommande förhållanden" data-testid="upcoming-panel">
      <div className={`${styles.surface} ${up.mobileCard}`} style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '18px 16px 8px', overflow: 'visible' }}>
        <UpcomingHeader st={st} variant="mobile" />
        {!vm.avail.weather && vm.upcoming.length === 0 ? (
          <div style={{ fontSize: 13, color: '#6B737B', padding: '0 0 10px' }}>Prognos otillgänglig.</div>
        ) : (
          <>
            <UpcomingHeadline st={st} />
            {!st.view.empty && <UpcomingChips st={st} variant="mobile" />}
            <UpcomingListMobile st={st} />
          </>
        )}
      </div>
    </section>
  );
}
