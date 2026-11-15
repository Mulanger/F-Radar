'use client';

import type { SceneConfig } from '../three/property-scene';
import { ThreeScene } from '../three/ThreeScene';
import styles from './mobile.module.css';

export function MobileRiskGauge({ score, color, label, config, ready }: {
  score: string; color: string; label: string; config: SceneConfig; ready: boolean;
}) {
  const circumference = 2 * Math.PI * 138;
  const arc = circumference * .75;
  const value = Number(score.replace(',', '.'));
  const length = ready && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) / 100 * arc : 0;
  return (
    <div className={styles.gauge} role="img" aria-label={`${label}: ${score} av 100. 3D-illustration.`}>
      <svg className={styles.gaugeSvg} viewBox="0 0 300 300" aria-hidden="true">
        <circle cx="150" cy="150" r="138" fill="none" stroke="rgba(20,23,26,.07)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${arc} ${circumference}`} transform="rotate(135 150 150)" />
        <circle cx="150" cy="150" r="138" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${length} ${circumference}`} transform="rotate(135 150 150)" style={{ transition: 'stroke-dasharray 1.4s cubic-bezier(.2,.8,.2,1),stroke .6s' }} />
      </svg>
      <div className={styles.gaugeScene}><ThreeScene config={config} /></div>
      <div className={styles.gaugeScore} aria-hidden="true">
        <div className={styles.gaugeLabel}>{label}</div>
        <div className={styles.gaugeValue}><strong>{score}</strong><span>/ 100</span></div>
      </div>
      <span className={styles.gaugeMin} aria-hidden="true">0</span><span className={styles.gaugeMax} aria-hidden="true">100</span>
    </div>
  );
}
