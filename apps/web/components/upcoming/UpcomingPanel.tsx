'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import { card, cardSub, cardTitle } from '@/lib/design/tokens';
import { useUpcoming } from './use-upcoming';
import { UpcomingDays, UpcomingDetail, UpcomingHeader, UpcomingSummary } from './UpcomingParts';

/** Desktop "Kommande förhållanden": a summary line, the 48 h strip and simple rows per day. */
export function UpcomingPanel({ vm }: { vm: OverviewVM }) {
  const st = useUpcoming(vm);
  return (
    <section aria-label="Kommande förhållanden" data-testid="upcoming-panel" style={{ ...card, flex: '2 1 640px', minWidth: 0, padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <UpcomingHeader
        live={st.live}
        title={
          <div>
            <h2 style={{ ...cardTitle, margin: 0 }}>Kommande förhållanden</h2>
            <div style={cardSub}>Prognos och officiella varningar · kommande 48 h</div>
          </div>
        }
      />
      {!vm.avail.weather && vm.upcoming.length === 0 ? (
        <div style={{ fontSize: 13, color: '#6B737B', padding: '8px 0' }}>Prognos otillgänglig just nu.</div>
      ) : (
        <>
          <UpcomingSummary st={st} />
          <UpcomingDays st={st} />
        </>
      )}
      <UpcomingDetail st={st} variant="dialog" />
    </section>
  );
}
