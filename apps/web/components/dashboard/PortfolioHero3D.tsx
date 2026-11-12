'use client';

import { useMemo } from 'react';
import type { OverviewVM } from '@/lib/view-models/overview';
import { C, card, glass } from '@/lib/design/tokens';
import { ThreeScene } from '../three/ThreeScene';
import { portfolioSceneConfig } from '../three/property-scene';

export function PortfolioHero3D({ vm, isDemo }: { vm: OverviewVM; isDemo: boolean }) {
  const config = useMemo(() => portfolioSceneConfig(), []);
  const h = vm.hero;
  const stat = (label: string, value: string, sub?: string) => (
    <div style={{ padding: '10px 14px', borderRadius: 16, ...glass(0.62, 16), minWidth: 150 }}>
      <div style={{ fontSize: 11.5, color: C.text3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.02em' }}>{value}</div>
      {sub !== undefined && <div style={{ fontSize: 11.5, color: C.text4 }}>{sub}</div>}
    </div>
  );

  return (
    <div
      style={{
        ...card,
        flex: '1.5 1 620px',
        minHeight: 420,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 26,
        background: 'radial-gradient(120% 100% at 70% 20%,#FFFFFF 0%,#EEF3F4 50%,#E1EAED 100%)',
      }}
    >
      <ThreeScene config={config} />
      <div style={{ position: 'absolute', top: 22, left: 24, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 300 }}>
        <div style={{ display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 20, ...glass(0.6, 14), fontSize: 12, color: C.text2 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: isDemo ? C.demo : C.live, animation: 'frBreath 2.4s ease-in-out infinite' }} />
          {isDemo ? 'Demo portfolio twin' : 'Portfolio illustration'} · {h.count} properties
        </div>
        {vm.narrative && (
          <>
            <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1.15, textWrap: 'pretty' }}>{vm.narrative.headline}</div>
            <div style={{ fontSize: 13.5, color: C.text3, lineHeight: 1.5 }}>{vm.narrative.detail}</div>
          </>
        )}
      </div>
      <div
        style={{
          position: 'absolute', left: 24, bottom: 22, width: 260, padding: 16, borderRadius: 20,
          background: 'rgba(255,255,255,0.62)', backdropFilter: 'blur(18px) saturate(1.4)', WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
          border: '1px solid rgba(255,255,255,0.9)', boxShadow: '0 20px 40px -24px rgba(20,23,26,0.35)',
          display: 'flex', alignItems: 'center', gap: 14, overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '40%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.7),transparent)', animation: 'frShimmer 6s ease-in-out infinite' }} />
        <svg width="68" height="68" viewBox="0 0 68 68" style={{ flexShrink: 0, transform: 'rotate(-90deg)' }} aria-hidden="true">
          <circle cx="34" cy="34" r="28" fill="none" stroke="rgba(20,23,26,0.07)" strokeWidth="6" />
          <circle cx="34" cy="34" r="28" fill="none" stroke={h.riskC} strokeWidth="6" strokeLinecap="round" strokeDasharray={h.riskDash} style={{ transition: 'stroke-dasharray 1.4s cubic-bezier(.2,.8,.2,1)' }} />
        </svg>
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 12, color: C.text3 }} title={isDemo ? 'Demo value – no risk methodology has been approved yet' : undefined}>
            Portfolio risk score
          </div>
          <div style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-0.03em' }}>
            {h.risk}
            <span style={{ fontSize: 14, color: C.text4 }}> / 100</span>
          </div>
          <div style={{ fontSize: 12, color: h.riskC }}>
            {h.riskLabel}
            {h.riskDelta ? ` · ${h.riskDelta}` : ''}
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', right: 20, top: 20, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
        {stat('Avg temperature', `${h.avgTemp}°C`)}
        {stat('Max rain next 24 h', `${h.maxRain} mm`, h.maxRainAt)}
        {stat('Peak gust', `${h.gust} m/s`, h.gustAt)}
      </div>
    </div>
  );
}
