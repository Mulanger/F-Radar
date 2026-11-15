'use client';

import { useMemo, useState } from 'react';
import type { OverviewVM } from '@/lib/view-models/overview';
import { useDashboard } from '@/lib/state/dashboard-state';
import { C } from '@/lib/design/tokens';
import { portfolioSceneConfig } from '../three/property-scene';
import { IconRain, IconWind } from '../ui/icons';
import { EmptyPortfolio } from '../dashboard/EmptyPortfolio';
import { MobileRiskGauge } from './MobileRiskGauge';
import { MobileFeedRows, MobileSection, MobileStatusRows, MobileWeatherCard } from './MobilePrimitives';
import { MobilePortfolioMap } from './MobilePortfolioMap';
import { MobileKPIs } from './MobileKPIs';
import { MobilePortfolioAnalytics } from './MobilePortfolioAnalytics';
import styles from './mobile.module.css';

export function MobilePortfolioOverview({ vm }: { vm: OverviewVM }) {
  const ds = useDashboard();
  const [feedAll, setFeedAll] = useState(false);
  const [statusAll, setStatusAll] = useState(false);
  const config = useMemo(() => ({ ...portfolioSceneConfig(), shift: 0, fit: { top: 34, bottom: 24, side: 10 } }), []);
  const level = vm.hero.riskLabel.split(' · ')[0]!;
  const note = vm.hero.riskLabel.split(' · ').slice(1).join(' · ');
  const demo = ds.mode === 'demo';
  const hasFeed = vm.avail.warnings || vm.avail.events;
  return (
    <div className={styles.page} data-screen-label="Mobil portföljöversikt">
      <div className={styles.heading}><div className={styles.date}><span className={styles.dot} style={{ color: demo ? C.demo : C.live }} />{vm.dateLine}</div><h1>Portföljöversikt</h1></div>
      <section className={styles.hero} aria-label="Portföljens risköversikt">
        <div className={styles.heroTop}><span className={styles.heroPill}><span className={styles.dot} style={{ color: demo ? C.demo : C.live, width: 6, height: 6 }} />{vm.hero.count} {vm.hero.count === 1 ? 'fastighet' : 'fastigheter'}{demo ? ' · Demo' : ''}</span><span className={styles.riskBadge} style={{ color: vm.hero.riskC, background: `color-mix(in oklch, ${vm.hero.riskC} 12%, white)` }}><span className={styles.dot} style={{ width: 6, height: 6 }} />{level}</span></div>
        <MobileRiskGauge score={vm.hero.risk} color={vm.hero.riskC} label="Portföljens riskpoäng" config={config} ready={ds.ready} />
        <div className={styles.riskNote}>{note || 'Ingen riskbedömning tillgänglig ännu'}</div>
        <div className={styles.weatherGrid}><MobileWeatherCard icon={<IconRain size={16} />} label="Mest nederbörd 24 h" value={`${vm.hero.maxRain} mm`} sub={vm.hero.maxRainAt} /><MobileWeatherCard icon={<IconWind size={16} />} label="Hårdaste byvind" value={`${vm.hero.gust} m/s`} sub={vm.hero.gustAt} /></div>
        <div className={styles.heroStats}>
          <div className={styles.heroStat}><strong>{vm.avail.warnings || vm.avail.weather ? vm.kpi.atRisk : '—'}<span> av {vm.kpi.total}</span></strong><div className={styles.weatherLabel}>Med varning</div><div className={styles.dots}>{vm.kpi.dots.map(d => <span key={d.id} style={{ background: d.c }} />)}</div></div>
          <div className={styles.heroStat}><strong>{vm.avail.alerts ? vm.kpi.alerts : '—'}</strong><div className={styles.weatherLabel}>Aktiva larm</div><div className={styles.small} style={{ color: 'oklch(.56 .17 28)' }}>{vm.kpi.alertsDelta ? `${vm.kpi.alertsDelta} ${vm.kpi.alertsSince}` : vm.avail.alerts ? 'Aktuell bevakning' : 'Ej ansluten'}</div></div>
          <div className={styles.heroStat}><strong>{vm.avail.warnings ? vm.kpi.warnings : '—'}</strong><div className={styles.weatherLabel}>Officiella varningar</div><div className={styles.small}>{vm.avail.warnings ? `${vm.kpi.warnAffected} fastigheter` : 'Ej ansluten'}</div></div>
        </div>
      </section>
      <div className={styles.filters} role="tablist" aria-label="Fastighetsgrupp">{vm.groups.map((g, index) => <button key={g.id} className={styles.filter} role="tab" aria-label={`${g.label} ${g.count}`} aria-selected={g.active} tabIndex={g.active ? 0 : -1} onClick={() => ds.setGroup(g.id)} onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? vm.groups.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + vm.groups.length) % vm.groups.length;
        ds.setGroup(vm.groups[next]!.id);
        e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
      }}>{g.label}<span className={styles.count}>{g.count}</span></button>)}</div>
      {vm.isEmpty && <div className={styles.section}><EmptyPortfolio /></div>}
      <MobileSection title="Nyckeltal" meta={<span className={styles.meta}>Uppdaterad {vm.updatedAt}</span>}><MobileKPIs vm={vm} /></MobileSection>
      <MobileSection title="Händelseflöde" subtitle="Offentliga källor i portföljen" id="mobile-events" meta={<span className={styles.riskBadge} style={{ color: demo ? 'oklch(.45 .1 70)' : hasFeed ? 'oklch(.45 .11 155)' : C.text3, background: demo ? 'oklch(.95 .05 80)' : hasFeed ? 'oklch(.95 .035 155)' : C.chip }}><span className={styles.dot} style={{ width: 6, height: 6 }} />{demo ? 'Demo' : hasFeed ? 'Live' : 'Ej ansluten'}</span>}>
        <div className={`${styles.surface} ${styles.list}`}>
          {!vm.feed.length && <div className={styles.empty}>{hasFeed ? 'Inga händelser för valda fastigheter.' : 'Händelser visas när de offentliga datakällorna levererar data.'}</div>}
          <MobileFeedRows feed={feedAll ? vm.feed : vm.feed.slice(0, 4)} basePath={ds.basePath} />
          {vm.feed.length > 4 && <button className={styles.more} aria-expanded={feedAll} onClick={() => setFeedAll(v => !v)}>{feedAll ? 'Visa färre händelser' : `Visa alla ${vm.feed.length} händelser`}</button>}
        </div>
      </MobileSection>
      <MobileSection title="Bevakningsstatus" subtitle="Sorterat efter risk" meta={<span className={styles.meta}>Risk</span>}>
        <div className={`${styles.surface} ${styles.list}`}>
          {!vm.rows.length && <div className={styles.empty}>Inga fastigheter i vald grupp.</div>}
          <MobileStatusRows rows={statusAll ? vm.rows : vm.rows.slice(0, 5)} basePath={ds.basePath} />
          {vm.rows.length > 5 && <button className={styles.more} aria-expanded={statusAll} onClick={() => setStatusAll(v => !v)}>{statusAll ? 'Visa färre fastigheter' : `Visa alla ${vm.rows.length} fastigheter`}</button>}
          {vm.rows.some(r => r.nowcast.badge) && <div className={styles.small} style={{ marginTop: 10 }}>MET Norway · bearbetad av FastighetsRadar · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></div>}
        </div>
      </MobileSection>
      <MobilePortfolioMap vm={vm} />
      <MobilePortfolioAnalytics vm={vm} />
    </div>
  );
}
