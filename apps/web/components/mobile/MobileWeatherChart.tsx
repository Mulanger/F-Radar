'use client';

import { useId } from 'react';
import type { DetailVM } from '@/lib/view-models/detail';
import type { ChartMetric } from '@/lib/state/dashboard-state';
import { MobileSection } from './MobilePrimitives';
import styles from './mobile.module.css';

export function MobileWeatherChart({ d, onMetric }: { d: DetailVM; onMetric: (metric: ChartMetric) => void }) {
  const gradientId = useId();
  const ch = d.chart;
  const shortLabels: Record<ChartMetric, string> = { temp: 'Temperatur', rain: 'Regn', wind: 'Vind', hum: 'Luftfukt.' };
  return <MobileSection title="Prognos 24 h" subtitle={d.forecastSource}>
    <div className={`${styles.surface} ${styles.chart}`}>
      <div className={styles.chartTabs} role="tablist" aria-label="Prognosvärde">{d.tabs.map(t => <button key={t.key} role="tab" aria-selected={t.active} aria-label={t.label} onClick={() => onMetric(t.key)}>{shortLabels[t.key]}</button>)}</div>
      {!ch ? <div className={styles.empty}>Prognos otillgänglig för den här fastigheten.</div> : <>
        <div className={styles.chartStats}>{ch.stats.map(s => <div key={s.label}><div className={styles.small}>{s.label}</div><strong>{s.value}</strong></div>)}</div>
        <div className={styles.chartPlot}>
          <div className={styles.chartGrid}><span /><span /><span /></div>
          <svg width="100%" height="150" viewBox="0 0 640 196" preserveAspectRatio="none" className={styles.chartSvg} role="img" aria-label={`Prognosdiagram: ${d.tabs.find(t => t.active)?.label}`}>
            <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={ch.c} stopOpacity=".26" /><stop offset="1" stopColor={ch.c} stopOpacity="0" /></linearGradient></defs>
            <path d={ch.area} fill={`url(#${gradientId})`} /><path d={ch.line} fill="none" stroke={ch.c} strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {ch.precipitationTooltips.map((p, i) => <rect key={i} x={Math.max(0, p.x - 12)} y="0" width="24" height="196" fill="transparent"><title>{p.text}</title></rect>)}
          </svg>
          <div className={styles.chartPeak} style={{ left: ch.pL, top: ch.pT }}><span style={{ borderColor: ch.c }} /><div style={{ transform: parseFloat(ch.pL) < 30 ? 'translateX(0)' : parseFloat(ch.pL) > 70 ? 'translateX(-100%)' : 'translateX(-50%)' }}>{ch.pLabel}</div></div>
        </div>
        <div className={styles.chartTimes}>{ch.xLabels.map((label, i) => <span key={i}>{label}</span>)}</div>
      </>}
      {d.precipitationIntervals.length > 0 && d.tabs.find(t => t.active)?.key === 'rain' && <details className={styles.sectionSub}><summary>Osäkerhetsintervall för nederbörd</summary>{d.precipitationIntervals.map(p => <div key={p.at} style={{ marginTop: 8 }}>{p.at}: {p.text}</div>)}</details>}
    </div>
  </MobileSection>;
}
