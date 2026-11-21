'use client';

import { DashboardLink } from '../shell/DashboardLink';
import { useViewScroll } from '@/lib/navigation/view-state';
import { useDashboard } from '@/lib/state/dashboard-state';
import { buildOverviewVM, groupFeedRows } from '@/lib/view-models/overview';
import { FeedAckCount, useFeedAcks } from '../dashboard/FeedAck';
import { useFeedEventMap } from '../dashboard/FeedEventMap';
import { MobileFeedRows, MobileSection } from './MobilePrimitives';
import styles from './mobile.module.css';

export function MobileAlerts() {
  const ds = useDashboard();
  useViewScroll(`${ds.basePath}:${ds.portfolio.organizationId}:alerts:scroll`);
  const acks = useFeedAcks();
  const map = useFeedEventMap();
  const alarms = ds.portfolio.activeAlarms ?? [];
  const active = new Set(alarms.map((alarm) => `${alarm.propertyId}:${alarm.eventId}`));
  const feed = [...alarms, ...ds.portfolio.feed.filter((item) => !active.has(`${item.propertyId}:${item.eventId}`))];
  const vm = buildOverviewVM({ ...ds.portfolio, feed }, { ready: ds.ready, group: 'all', isSmsOn: ds.isSmsOn, isRuleOn: ds.isRuleOn });
  const feedCount = groupFeedRows(vm.feed).length;
  return <div className={styles.page}>
    <div className={styles.heading}>
      <div className={styles.date}>{ds.mode === 'demo' ? 'Demodata · ' : ''}Händelser från offentliga källor</div>
      <h1>Larm och händelser</h1>
      <DashboardLink className={styles.alertHistory} href={`${ds.basePath}/acknowledgements?via=alerts`}>Visa kvitteringar</DashboardLink>
    </div>
    <MobileSection title="Händelseflöde" subtitle={`${feedCount} ${feedCount === 1 ? 'händelse' : 'händelser'} i portföljen`} meta={<FeedAckCount n={acks.pending(vm.feed)} />}><div className={`${styles.surface} ${styles.list}`}><MobileFeedRows feed={vm.feed} basePath={ds.basePath} from="alerts" onMap={map.open} isUnread={map.isUnread} acks={acks} />{!feedCount && <div className={styles.empty}>Inga händelser att visa just nu.</div>}</div></MobileSection>
    {map.view}
  </div>;
}
