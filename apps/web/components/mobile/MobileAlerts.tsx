'use client';

import { useMemo, useRef } from 'react';
import { DashboardLink } from '../shell/DashboardLink';
import { useViewScroll } from '@/lib/navigation/view-state';
import { useDashboard } from '@/lib/state/dashboard-state';
import { buildOverviewVM, countFeedEvents, groupFeedRows } from '@/lib/view-models/overview';
import { filterByGroup } from '@/lib/view-models/groups';
import { FeedAckCount, useFeedAcks } from '../dashboard/FeedAck';
import { useFeedEventMap } from '../dashboard/FeedEventMap';
import { GroupFilter, GroupNotice } from '../groups/GroupFilter';
import { MobileFeedRows, MobileSection } from './MobilePrimitives';
import styles from './mobile.module.css';

export function MobileAlerts() {
  const ds = useDashboard();
  const scrollKey = `${ds.basePath}:${ds.portfolio.organizationId}:alerts`;
  useViewScroll(`${scrollKey}:scroll`);
  const acks = useFeedAcks();
  const map = useFeedEventMap();
  const { portfolio, ready, group, isSmsOn, isRuleOn } = ds;
  const feed = useMemo(() => {
    const alarms = portfolio.activeAlarms ?? [];
    const active = new Set(alarms.map((alarm) => `${alarm.propertyId}:${alarm.eventId}`));
    return [...alarms, ...portfolio.feed.filter((item) => !active.has(`${item.propertyId}:${item.eventId}`))];
  }, [portfolio.activeAlarms, portfolio.feed]);
  const vm = useMemo(() => buildOverviewVM({ ...portfolio, feed }, { ready, group, isSmsOn, isRuleOn }), [portfolio, feed, ready, group, isSmsOn, isRuleOn]);
  const feedCount = useMemo(() => groupFeedRows(vm.feed).length, [vm.feed]);
  const feedRef = useRef<HTMLDivElement>(null);
  useViewScroll(`${scrollKey}:feed:${group}`, ready && feedCount > 0, feedRef);
  // What the chosen group leaves out: the cards of every property minus the group's (S-20).
  const hidden = useMemo(() => {
    if (group === 'all') return 0;
    const members = new Set(filterByGroup(portfolio, group).map((s) => s.property.id));
    return countFeedEvents(feed) - countFeedEvents(feed.filter((item) => members.has(item.propertyId)));
  }, [feed, group, portfolio]);
  return <div className={`${styles.page} ${styles.alertsPage}`}>
    <div className={styles.heading}>
      <div className={styles.date}>{ds.mode === 'demo' ? 'Demodata · ' : ''}Händelser från offentliga källor</div>
      <h1>Larm och händelser</h1>
      <DashboardLink className={styles.alertHistory} href={`${ds.basePath}/acknowledgements?via=alerts`}>Visa kvitteringar</DashboardLink>
      {portfolio.groups.length > 0 && <div className={styles.groupRow}><GroupFilter /></div>}
    </div>
    {group !== 'all' && <div className={styles.groupNotice}><GroupNotice hidden={hidden} noun={['händelse', 'händelser']} /></div>}
    <MobileSection title="Händelseflöde" subtitle={`${feedCount} ${feedCount === 1 ? 'händelse' : 'händelser'} ${group === 'all' ? 'i portföljen' : 'i gruppen'}`} meta={<FeedAckCount n={acks.pendingEvents(vm.feed)} />}>
      <div
        key={group}
        ref={feedRef}
        className={`${styles.surface} ${styles.list} ${styles.scrollList} ${styles.alertsFeed}`}
        role={feedCount > 0 ? 'region' : undefined}
        aria-label={feedCount > 0 ? `Händelser, ${feedCount} st` : undefined}
        tabIndex={feedCount > 0 ? 0 : undefined}
      >
        {feedCount > 0 ? (
          <MobileFeedRows feed={vm.feed} basePath={ds.basePath} from="alerts" onMap={map.open} isUnread={map.isUnread} acks={acks} />
        ) : (
          <div className={styles.empty}>{group === 'all' ? 'Inga händelser att visa just nu.' : 'Inga händelser i gruppen just nu.'}</div>
        )}
      </div>
    </MobileSection>
    {map.view}
  </div>;
}
