'use client';

import { useViewScroll } from '@/lib/navigation/view-state';
import { useMemo } from 'react';
import { groupFeedRows, type OverviewVM } from '@/lib/view-models/overview';
import { useDashboard } from '@/lib/state/dashboard-state';
import { C } from '@/lib/design/tokens';
import { portfolioSceneConfig } from '../three/property-scene';
import { IconRain, IconWind } from '../ui/icons';
import { EmptyPortfolio } from '../dashboard/EmptyPortfolio';
import { UtilityCoverage } from '../dashboard/UtilityCoverage';
import { useFeedEventMap } from '../dashboard/FeedEventMap';
import { FeedAckCount, useFeedAcks } from '../dashboard/FeedAck';
import { MobileRiskGauge } from './MobileRiskGauge';
import { MobileFeedRows, MobileSection, MobileStatusRows, MobileWeatherCard } from './MobilePrimitives';
import { MobilePortfolioMap } from './MobilePortfolioMap';
import { MobileKPIs } from './MobileKPIs';
import { MobileScrollList } from './MobileScrollList';
import { MobilePortfolioAnalytics } from './MobilePortfolioAnalytics';
import styles from './mobile.module.css';

export function MobilePortfolioOverview({ vm }: { vm: OverviewVM }) {
  const ds = useDashboard();
  const scrollKey = `${ds.basePath}:${ds.portfolio.organizationId}:overview:mobile`;
  useViewScroll(scrollKey);
  const config = useMemo(() => ({ ...portfolioSceneConfig(), shift: 0, fit: { top: 34, bottom: 24, side: 10 } }), []);
  const st = vm.hero.status;
  const demo = ds.mode === 'demo';
  const hasFeed = vm.avail.warnings || vm.avail.events;
  const map = useFeedEventMap();
  const acks = useFeedAcks();
  return (
    <div className={styles.page} data-screen-label="Mobil portföljöversikt">
      <div className={styles.heading}><div className={styles.date}><span className={styles.dot} style={{ color: demo ? C.demo : C.live }} />{vm.dateLine}</div><h1>Portföljöversikt</h1></div>
      <section className={styles.hero} aria-label="Portföljens risköversikt">
        <div className={styles.heroTop}><span className={styles.heroPill}><span className={styles.dot} style={{ color: demo ? C.demo : C.live, width: 6, height: 6 }} />{vm.hero.count} {vm.hero.count === 1 ? 'fastighet' : 'fastigheter'}{demo ? ' · Demo' : ''}</span><span className={styles.riskBadge} style={{ color: st.c, background: `color-mix(in oklch, ${st.c} 12%, white)` }}><span className={styles.dot} style={{ width: 6, height: 6 }} />{st.label}</span></div>
        <MobileRiskGauge score={st.n === null ? '—' : String(st.n)} unit={`av ${st.total}`} max={String(st.total)} fraction={st.fill} color={st.c} label="Fastigheter att bevaka" ariaLabel={st.headline} config={config} ready={ds.ready} />
        <div className={styles.riskNote}>{st.n === null ? st.headline + ' · ' + st.detail : st.detail}</div>
        <div className={styles.weatherGrid}><MobileWeatherCard icon={<IconRain size={16} />} label="Mest nederbörd 24 h" value={`${vm.hero.maxRain} mm`} sub={vm.hero.maxRainAt} /><MobileWeatherCard icon={<IconWind size={16} />} label="Hårdaste byvind" value={`${vm.hero.gust} m/s`} sub={vm.hero.gustAt} /></div>
        <MobileKPIs vm={vm} alertsHref={`${ds.basePath}/alerts`} />
      </section>
      {vm.isEmpty && <div className={styles.section}><EmptyPortfolio /></div>}
      <MobileSection title="Händelseflöde" subtitle="Offentliga källor i portföljen" id="mobile-events" meta={<span className={styles.riskBadge} style={{ color: demo ? 'oklch(.45 .1 70)' : hasFeed ? 'oklch(.45 .11 155)' : C.text3, background: demo ? 'oklch(.95 .05 80)' : hasFeed ? 'oklch(.95 .035 155)' : C.chip }}><span className={styles.dot} style={{ width: 6, height: 6 }} />{demo ? 'Demo' : hasFeed ? 'Live' : 'Ej ansluten'}</span>}>
        {acks.pending(vm.feed) > 0 && <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '-4px 4px 10px' }}><FeedAckCount n={acks.pendingEvents(vm.feed)} /></div>}
        <div className={`${styles.surface} ${styles.list}`}>
          {!vm.feed.length && <div className={styles.empty}>{hasFeed ? 'Inga händelser för valda fastigheter.' : 'Händelser visas när de offentliga datakällorna levererar data.'}</div>}
          <MobileScrollList scrollKey={`${scrollKey}:feed`} visible={4} count={groupFeedRows(vm.feed).length} label="Händelser"><MobileFeedRows feed={vm.feed} basePath={ds.basePath} onMap={map.open} isUnread={map.isUnread} acks={acks} /></MobileScrollList>
        </div>
      </MobileSection>
      <MobileSection title="Bevakningsstatus" subtitle="Sorterat efter risk" meta={<span className={styles.meta}>Risk</span>}>
        <UtilityCoverage reports={ds.portfolio.utilityCoverage} properties={ds.portfolio.properties.map((s) => s.property)} basePath={ds.basePath} />
        <div className={`${styles.surface} ${styles.list}`}>
          {!vm.rows.length && <div className={styles.empty}>Inga fastigheter i vald grupp.</div>}
          <MobileScrollList scrollKey={`${scrollKey}:properties`} visible={5} count={vm.rows.length} label="Fastigheter"><MobileStatusRows rows={vm.rows} basePath={ds.basePath} /></MobileScrollList>
          {vm.rows.some(r => r.nowcast.badge) && <div className={styles.small} style={{ marginTop: 10 }}>MET Norway · bearbetad av FastighetsRadar · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></div>}
        </div>
      </MobileSection>
      <MobilePortfolioMap vm={vm} />
      <MobilePortfolioAnalytics vm={vm} />
      {map.view}
    </div>
  );
}
