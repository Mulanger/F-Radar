import Link from 'next/link';
import { C } from '@/lib/design/tokens';
import { IconChevronRight } from '../ui/icons';
import type { OverviewVM } from '@/lib/view-models/overview';
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

export function MobileFeedRows({ feed, basePath }: { feed: OverviewVM['feed']; basePath: string }) {
  return feed.map((f) => <Link key={f.id} href={`${basePath}/properties/${encodeURIComponent(f.propertyId)}`} className={styles.feedRow}>
    <span className={styles.feedIcon} style={{ background: f.bg }}><span className={styles.dot} style={{ background: f.c, width: 8, height: 8 }} /></span>
    <div className={styles.feedMain}><div className={styles.feedTitle}>{f.title}</div><div className={styles.feedMeta}><span className={styles.source}>{f.src}</span><span>{f.prop}</span></div></div>
    <time className={styles.time}>{f.t}</time>
  </Link>);
}

export function MobileStatusRows({ rows, basePath }: { rows: OverviewVM['rows']; basePath: string }) {
  return rows.map((r) => <Link key={r.id} href={`${basePath}/properties/${encodeURIComponent(r.id)}`} className={styles.statusRow}>
    <div style={{ minWidth: 0 }}>
      <div className={styles.statusName}><span className={styles.name}>{r.name}</span><MobileStatusBadge label={r.status} color={r.c} background={r.bg} /></div>
      <div className={styles.statusWeather}><span>{r.temp}° · {r.rain} mm · {r.wind} m/s</span>{r.warn !== 'Ingen' && <span className={styles.warning} style={{ color: r.wFg, background: r.wBg }} title={r.warn}>{r.warn}</span>}</div>
      {r.nowcast.badge && <div className={styles.small} style={{ color: '#4A86C5', marginTop: 4 }} title={r.nowcast.source}>{r.nowcast.badge} · MET Norway</div>}
    </div>
    <div className={styles.statusRisk} title={r.riskTitle}><span>{r.risk}</span><div className={styles.riskTrack}><div style={{ background: r.riskC, width: r.riskW }} /></div></div>
    <IconChevronRight size={16} stroke={C.sep} />
  </Link>);
}
