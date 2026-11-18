'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import { card } from '@/lib/design/tokens';
import { useUpcoming } from './use-upcoming';
import { UpcomingChips, UpcomingHeader, UpcomingHeadline, UpcomingTimeline } from './UpcomingParts';

/** Desktop "Kommande förhållanden": headline, kind chips and a 48 h timeline per property. Full width. */
export function UpcomingPanel({ vm }: { vm: OverviewVM }) {
  const st = useUpcoming(vm);
  return (
    <section aria-label="Kommande förhållanden" data-testid="upcoming-panel" style={{ ...card, flex: '1 1 100%', minWidth: 0, padding: '24px 26px 16px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <UpcomingHeader st={st} variant="desktop" />
      {!vm.avail.weather && vm.upcoming.length === 0 ? (
        <div style={{ fontSize: 13, color: '#6B737B', padding: '8px 0' }}>Prognos otillgänglig just nu.</div>
      ) : (
        <>
          <UpcomingHeadline st={st} />
          {!st.view.empty && <UpcomingChips st={st} variant="desktop" />}
          <UpcomingTimeline st={st} />
        </>
      )}
    </section>
  );
}
