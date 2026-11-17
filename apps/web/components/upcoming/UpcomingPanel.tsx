'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import { card, cardSub, cardTitle } from '@/lib/design/tokens';
import { useUpcoming } from './use-upcoming';
import { UpcomingChips, UpcomingDays, UpcomingDetail, UpcomingHeader, UpcomingTiles } from './UpcomingParts';

/** Desktop "Kommande förhållanden": summary tiles, category chips, day groups of event cards. */
export function UpcomingPanel({ vm }: { vm: OverviewVM }) {
  const st = useUpcoming(vm);
  return (
    <section aria-label="Kommande förhållanden" data-testid="upcoming-panel" style={{ ...card, flex: '2 1 640px', minWidth: 0, padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <UpcomingHeader
        live={st.live}
        title={
          <div>
            <h2 style={{ ...cardTitle, margin: 0 }}>Kommande förhållanden</h2>
            <div style={cardSub}>Portföljprognos och officiella varningar · kommande 48 h</div>
          </div>
        }
      />
      {!vm.avail.weather && vm.upcoming.length === 0 ? (
        <div style={{ fontSize: 13, color: '#6B737B', padding: '8px 0' }}>Prognos otillgänglig just nu.</div>
      ) : (
        <>
          <UpcomingTiles sum={st.view.sum} desk />
          {st.view.chips.length > 2 && <UpcomingChips chips={st.view.chips} onSelect={st.setFilter} />}
          <UpcomingDays st={st} desk />
        </>
      )}
      <UpcomingDetail st={st} variant="dialog" />
    </section>
  );
}
