import { DashboardLink } from '../shell/DashboardLink';
import { propertyHref, type DashboardSection } from '@/lib/navigation/dashboard';
import { C } from '@/lib/design/tokens';
import { IconChevronRight } from '../ui/icons';
import type { OverviewVM } from '@/lib/view-models/overview';
import { FeedMapButton, FeedUpdatedBadge, type FeedMapTarget } from '../dashboard/FeedEventMap';
import { FeedAckButton, type FeedAcks } from '../dashboard/FeedAck';
import { FeedRows } from '../dashboard/FeedRows';
import { NightMoon } from '../dashboard/NightMoon';
import styles from './mobile.module.css';

export const shortStatus = (label: string) => label === 'Ingen aktiv varning' ? 'Utan varning' : label;

export function MobileSection({ title, subtitle, meta, children, id }: {
  title: string; subtitle?: string; meta?: React.ReactNode; children: React.ReactNode; id?: string;
}) {
  return <section className={styles.section} id={id} aria-label={title}>
    <div className={styles.sectionHeader}><div><h2 className={styles.sectionTitle}>{title}</h2>{subtitle && <div className={styles.sectionSub}>{subtitle}</div>}</div>{meta}</div>
    {children}
  </section>;
}

export function MobileStatusBadge({ label, color, background }: { label: string; color: string; background: string }) {
  return <span className={styles.badge} style={{ color, background }}><span className={styles.dot} style={{ width: 5, height: 5 }} />{shortStatus(label)}</span>;
}

export function MobileWeatherCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return <div className={styles.weatherCard}><span className={styles.weatherIcon}>{icon}</span><div><div className={styles.weatherLabel}>{label}</div><div className={styles.weatherValue}>{value}</div>{sub && <div className={styles.weatherSub} title={sub}>{sub}</div>}</div></div>;
}

/**
 * Feed rows link to the property. With `onMap`, a row whose event has a position also gets a map
 * button; with `acks`, a row that must be acknowledged gets "Kvittera" beside it, in the lower right corner.
 */
export function MobileFeedRows({ feed, basePath, from = 'overview', onMap, isUnread, acks }: { feed: OverviewVM['feed']; basePath: string; from?: DashboardSection; onMap?: (row: FeedMapTarget) => void; isUnread?: (row: FeedMapTarget) => boolean; acks?: FeedAcks }) {
  return <FeedRows mobile feed={feed} acks={acks} onMap={onMap} isUnread={isUnread} property={(row) => (
    onMap && row.opensTrafficDetails
      ? <button type="button" onClick={() => onMap(row)}>{row.prop}</button>
      : <DashboardLink href={propertyHref(basePath, row.propertyId, from)}>{row.prop}</DashboardLink>
  )}>{(f) => {
    const map = onMap && f.mapEventId;
    const ack = acks && f.ackRequired;
    const content = <>
      <span className={styles.feedIcon} style={{ background: f.bg }}><span className={styles.dot} style={{ background: f.c, width: 8, height: 8 }} /></span>
      <span className={styles.feedMain}><span className={styles.feedTitle}>{f.title}</span><span className={styles.feedMeta}><span className={styles.source}>{f.src}</span><span>{f.prop}</span></span></span>
      <span className={styles.feedTime}>
        {(f.acknowledgementUpdate || (isUnread?.(f) ?? !!f.unreadUpdateId)) && <FeedUpdatedBadge />}
        <span className={styles.time} style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 5 }}>{f.nightWork && <NightMoon label={f.nightWork} />}<time>{f.t}</time></span>
      </span>
    </>;
    return (
      <div key={f.rowKey} className={styles.feedItem} data-map-only={map && !ack ? '' : undefined} data-ack={ack && !acks.ackedAt(f) ? 'waiting' : undefined}>
        {map && f.opensTrafficDetails
          ? <button type="button" className={styles.feedRow} onClick={() => onMap(f)}>{content}</button>
          : <DashboardLink href={propertyHref(basePath, f.propertyId, from)} className={styles.feedRow}>{content}</DashboardLink>}
        {(map || ack) && <div className={styles.feedActions}>
          {ack && <FeedAckButton f={f} acks={acks} />}
          {map && <FeedMapButton title={f.title} ended={f.mapEnded} onClick={() => onMap(f)} />}
        </div>}
      </div>
    );
  }}</FeedRows>;
}

export function MobileStatusRows({ rows, basePath }: { rows: OverviewVM['rows']; basePath: string }) {
  return rows.map((r) => <DashboardLink key={r.id} href={propertyHref(basePath, r.id, 'overview')} className={styles.statusRow}>
    <div style={{ minWidth: 0 }}>
      <div className={styles.statusName}><span className={styles.name}>{r.name}</span><MobileStatusBadge label={r.status} color={r.c} background={r.bg} /></div>
      <div className={styles.statusWeather}><span>{r.temp}° · {r.rain} mm · {r.wind} m/s</span>{r.warn !== 'Ingen' && <span className={styles.warning} style={{ color: r.wFg, background: r.wBg }} title={r.warn}>{r.warn}</span>}</div>
      {r.nowcast.badge && <div className={styles.small} style={{ color: '#4A86C5', marginTop: 4 }} title={r.nowcast.source}>{r.nowcast.badge}</div>}
    </div>
    <div className={styles.statusRisk} title={r.riskTitle}><span>{r.risk}</span><div className={styles.riskTrack}><div style={{ background: r.riskC, width: r.riskW }} /></div></div>
    <IconChevronRight size={16} stroke={C.sep} />
  </DashboardLink>);
}
