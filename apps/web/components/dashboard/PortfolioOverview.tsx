'use client';

import { useMemo } from 'react';
import { useSavedView, useViewScroll } from '@/lib/navigation/view-state';
import { useDashboard } from '@/lib/state/dashboard-state';
import { buildOverviewVM, filterByGroup } from '@/lib/view-models/overview';
import { GroupFilter } from '../groups/GroupFilter';
import { C } from '@/lib/design/tokens';
import { PortfolioHero3D } from './PortfolioHero3D';
import { PortfolioMap } from '../maps/PortfolioMap';
import { AlertFeed } from './AlertFeed';
import { PropertyStatusTable } from './PropertyStatusTable';
import { PortfolioAnalytics } from './PortfolioAnalytics';
import { UpcomingPanel } from '../upcoming/UpcomingPanel';
import { EmptyPortfolio } from './EmptyPortfolio';
import { MonitoringStatus } from './MonitoringStatus';
import styles from './PortfolioOverview.module.css';
import { useMobileDashboard } from '@/lib/design/use-mobile-dashboard';
import { MobilePortfolioOverview } from '../mobile/MobilePortfolioOverview';

/** Page 1 – Portfolio Overview (`/overview`). */
export function PortfolioOverview() {
  const ds = useDashboard();

  const { portfolio, ready, group, isSmsOn, isRuleOn } = ds;
  const mobile = useMobileDashboard();
  const viewKey = `${ds.basePath}:${portfolio.organizationId}:overview:desktop`;
  const [statusFull, setStatusFull, restored] = useSavedView(`${viewKey}:full-table`, false);
  useViewScroll(viewKey, !mobile && restored);
  const vm = useMemo(() => buildOverviewVM(portfolio, { ready, group, isSmsOn, isRuleOn }), [portfolio, ready, group, isSmsOn, isRuleOn]);
  // The map refits only when the set of properties changes (group filter), not on a data refresh.
  const mapList = useMemo(() => filterByGroup(portfolio, group), [portfolio, group]);
  const isDemo = ds.mode === 'demo';

  if (mobile) return <MobilePortfolioOverview vm={vm} />;

  return (
    <div className="fr-desktop-dashboard-view" data-screen-label="01 Portfolio Overview" style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: 'frFade .45s ease both' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, color: C.text3, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: isDemo ? C.demo : C.live, animation: 'frBreath 2.4s ease-in-out infinite' }} />
            {vm.dateLine}
          </div>
          <h1 style={{ margin: '8px 0 0', fontSize: 42, lineHeight: 1.05, fontWeight: 500, letterSpacing: '-0.035em' }}>Portföljöversikt</h1>
          <p style={{ margin: '8px 0 0', color: C.text3, fontSize: 15 }}>
            {isDemo
              ? 'Demo av miljö- och samhällsbevakning för dina fastigheter'
              : 'Bevakning av väder, varningar och offentliga data för dina fastigheter'}
          </p>
        </div>
        <GroupFilter variant="auto" />
      </div>

      <div className={styles.summaryRow}>
        <PortfolioHero3D vm={vm} isDemo={isDemo} />
        <AlertFeed vm={vm} isDemo={isDemo} onOpen={(id) => ds.openProperty(id)} />
      </div>

      <div className={styles.mapRow}>
        <PortfolioMap list={mapList} legend={vm.legend} layers={ds.layers} onToggleLayer={ds.toggleLayer} onOpen={(id) => ds.openProperty(id)} />
        <MonitoringStatus vm={vm} onOpen={ds.openProperty} expanded={statusFull} onToggleFull={() => setStatusFull(!statusFull)} />
      </div>

      {vm.isEmpty ? <EmptyPortfolio /> : statusFull && (
        <div id="portfolio-full-status" className={styles.fullTable}>
          <PropertyStatusTable vm={vm} onOpen={(id) => ds.openProperty(id)} />
        </div>
      )}

      <div className="fr-row" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <UpcomingPanel vm={vm} />
        <PortfolioAnalytics vm={vm} />
      </div>
    </div>
  );
}
