'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import { useUpcoming } from '../upcoming/use-upcoming';
import { UpcomingChips, UpcomingHeader, UpcomingHeadline, UpcomingMobileAxis, UpcomingMobilePlaces } from '../upcoming/UpcomingParts';
import styles from './mobile.module.css';
import up from '../upcoming/Upcoming.module.css';

/**
 * Mobile "Kommande förhållanden" (designer's 1b): a top card with the headline, chips and the 48 h
 * axis, then one white card per address with the page's grey between them.
 */
export function MobileUpcoming({ vm }: { vm: OverviewVM }) {
  const st = useUpcoming(vm);
  const unavailable = !vm.avail.weather && vm.upcoming.length === 0;
  return (
    <section className={styles.section} aria-label="Kommande förhållanden" data-testid="upcoming-panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className={`${styles.surface} ${up.mobileCard}`} style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '18px 16px 4px', overflow: 'visible' }}>
        <UpcomingHeader st={st} variant="mobile" />
        {unavailable ? (
          <div style={{ fontSize: 13, color: '#6B737B', padding: '0 0 10px' }}>Prognos otillgänglig.</div>
        ) : (
          <>
            <UpcomingHeadline st={st} />
            {!st.view.empty && <UpcomingChips st={st} variant="mobile" />}
            <UpcomingMobileAxis st={st} />
          </>
        )}
      </div>
      {!unavailable && <UpcomingMobilePlaces st={st} cardClassName={styles.surface} />}
    </section>
  );
}
