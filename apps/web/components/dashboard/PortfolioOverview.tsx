'use client';

import { useMemo } from 'react';
import { useDashboard } from '@/lib/state/dashboard-state';
import { buildOverviewVM, filterByGroup } from '@/lib/view-models/overview';
import { C } from '@/lib/design/tokens';
import { PortfolioHero3D } from './PortfolioHero3D';
import { PortfolioKPIs } from './PortfolioKPIs';
import { PortfolioMap } from '../maps/PortfolioMap';
import { AlertFeed } from './AlertFeed';
import { PropertyStatusTable } from './PropertyStatusTable';
import { PortfolioAnalytics, UpcomingConditions } from './PortfolioAnalytics';
import { EmptyPortfolio } from './EmptyPortfolio';

/** Page 1 – Portfolio Overview (`/overview`). */
export function PortfolioOverview() {
  const ds = useDashboard();
  const { portfolio, ready, group, isSmsOn, isRuleOn } = ds;
  const vm = buildOverviewVM(portfolio, { ready, group, isSmsOn, isRuleOn });
  // Stable list identity so the map only refits when the filter actually changes.
  const mapList = useMemo(() => filterByGroup(portfolio, group), [portfolio, group]);
  const isDemo = ds.mode === 'demo';

  return (
    <div data-screen-label="01 Portfolio Overview" style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: 'frFade .45s ease both' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, color: C.text3, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: isDemo ? C.demo : C.live, animation: 'frBreath 2.4s ease-in-out infinite' }} />
            {vm.dateLine}
          </div>
          <h1 style={{ margin: '8px 0 0', fontSize: 42, lineHeight: 1.05, fontWeight: 500, letterSpacing: '-0.035em' }}>Portfolio Overview</h1>
          <p style={{ margin: '8px 0 0', color: C.text3, fontSize: 15 }}>
            {isDemo
              ? 'Demo of environmental and public-data monitoring across your properties'
              : 'Environmental and public-data monitoring across your properties'}
          </p>
        </div>
        <div role="tablist" aria-label="Property group" style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 24, background: C.white, border: '1px solid rgba(20,23,26,0.06)' }}>
          {vm.groups.map((g) => (
            <button
              key={g.id}
              role="tab"
              aria-selected={g.active}
              onClick={() => ds.setGroup(g.id)}
              style={{
                height: 36, padding: '0 16px', borderRadius: 18, border: 'none', cursor: 'pointer', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8,
                background: g.active ? C.ink : 'transparent', color: g.active ? '#FFFFFF' : C.text2, transition: 'all .25s',
              }}
            >
              {g.label}
              <span style={{ fontSize: 11.5, opacity: 0.6 }}>{g.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <PortfolioHero3D vm={vm} isDemo={isDemo} />
        <PortfolioKPIs vm={vm} />
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <PortfolioMap list={mapList} legend={vm.legend} layers={ds.layers} onToggleLayer={ds.toggleLayer} onOpen={(id) => ds.openProperty(id)} />
        <AlertFeed vm={vm} isDemo={isDemo} onOpen={(id) => ds.openProperty(id)} />
      </div>

      {vm.isEmpty ? <EmptyPortfolio /> : <PropertyStatusTable vm={vm} smsInteractive={ds.smsInteractive} onOpen={(id) => ds.openProperty(id)} onToggleSms={ds.toggleSms} />}

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <PortfolioAnalytics vm={vm} />
        <UpcomingConditions vm={vm} />
      </div>
    </div>
  );
}
