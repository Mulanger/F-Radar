'use client';

import Link from 'next/link';
import { propertyHref } from '@/lib/navigation/dashboard';
import type { OverviewVM } from '@/lib/view-models/overview';
import { useDashboard } from '@/lib/state/dashboard-state';
import { C, FONT_MONO, card, cardSub, cardTitle } from '@/lib/design/tokens';
import styles from './PortfolioOverview.module.css';

export function MonitoringStatus({ vm, onOpen, expanded, onToggleFull }: {
  vm: OverviewVM;
  onOpen: (id: string) => void;
  expanded: boolean;
  onToggleFull: () => void;
}) {
  const { basePath } = useDashboard();
  return (
    <section className={styles.monitoring} style={card} aria-label="Bevakningsstatus">
      <div className={styles.monitorHeader}>
        <div>
          <div style={cardTitle}>Bevakningsstatus</div>
          <div style={cardSub}>Sorterat efter risk · uppdaterad {vm.updatedAt}</div>
        </div>
        <button type="button" className={styles.expand} aria-expanded={expanded} aria-controls="portfolio-full-status" onClick={onToggleFull}>
          {expanded ? 'Dölj tabell' : 'Hela tabellen'}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
        </button>
      </div>
      <div className={styles.table} role="table" aria-label="Kompakt bevakningsstatus per fastighet">
        <div className={styles.columns} role="row">
          <div role="columnheader">Fastighet</div><div role="columnheader">Risk</div>
        </div>
        <div className={styles.statusBody} role="rowgroup" tabIndex={0} aria-label="Fastigheter sorterade efter risk">
          {vm.rows.length === 0 && <p style={{ padding: 10, fontSize: 13, color: C.text3 }}>Inga fastigheter i vald grupp.</p>}
          {vm.rows.map((r) => (
            <div key={r.id} role="row" className={`${styles.statusRow} fr-hover-row`}>
              <div role="cell" style={{ minWidth: 0 }}>
                <Link href={propertyHref(basePath, r.id, 'overview')} className={styles.propertyLink} onClick={(e) => {
                  if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onOpen(r.id); }
                }}>
                  <div className={styles.propertyName}>
                    <span className={styles.name} title={r.name}>{r.name}</span>
                    <span className={styles.badge} style={{ background: r.bg, color: r.c }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />{r.status}</span>
                  </div>
                  <div className={styles.weather}>
                    <span className={styles.weatherValues}>{r.temp}° · {r.rain} mm · {r.wind} m/s</span>
                    {vm.avail.warnings && r.warn !== 'Ingen' && <span className={styles.warning} style={{ background: r.wBg, color: r.wFg }} title={r.warn}>{r.warn}</span>}
                  </div>
                  {r.nowcast.badge && <span style={{ fontSize: 11, color: '#4A86C5' }} title={r.nowcast.source}>{r.nowcast.badge} · MET Norway</span>}
                </Link>
              </div>
              <div role="cell" title={r.riskTitle} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 5, borderRadius: 3, background: C.chip, overflow: 'hidden' }}><div style={{ height: 5, borderRadius: 3, width: r.riskW, background: r.riskC, transition: 'width 1s' }} /></div>
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, width: 20, textAlign: 'right' }}>{r.risk}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {vm.rows.some((r) => r.nowcast.badge) && <div style={{ fontSize: 10, color: C.text3 }}>MET Norway · bearbetad av FastighetsRadar · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></div>}
    </section>
  );
}
