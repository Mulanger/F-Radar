'use client';

import { useMemo } from 'react';
import type { DetailVM } from '@/lib/view-models/detail';
import { C, card, glass } from '@/lib/design/tokens';
import { ThreeScene } from '../three/ThreeScene';
import { detailSceneConfig } from '../three/property-scene';

/** Large per-property 3D illustration with decorative animated water. */
export function PropertyHero3D({ d, isDemo }: { d: DetailVM; isDemo: boolean }) {
  const config = useMemo(() => detailSceneConfig(d.floors, d.hex, d.floodExposure), [d.floors, d.hex, d.floodExposure]);
  const panel = (label: string, value: string, sub: string, subColor: string) => (
    <div style={{ padding: '12px 14px', borderRadius: 16, ...glass(0.62, 16), minWidth: 168 }}>
      <div style={{ fontSize: 11.5, color: C.text3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: subColor }}>{sub}</div>
    </div>
  );
  const stat = (label: string, value: string) => (
    <div style={{ position: 'relative' }}>
      <div style={{ fontSize: 11.5, color: C.text3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 500 }}>{value}</div>
    </div>
  );

  return (
    <div
      style={{
        ...card,
        flex: '1.7 1 640px',
        minHeight: 480,
        position: 'relative',
        overflow: 'hidden',
        background: 'radial-gradient(110% 100% at 50% 15%,#FFFFFF 0%,#EDF2F4 55%,#DCE6EA 100%)',
      }}
    >
      <ThreeScene config={config} />
      <div style={{ position: 'absolute', top: 20, left: 22, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 20, ...glass(0.6, 14), fontSize: 12, color: C.text2 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: d.c, animation: 'frBreath 2s infinite' }} />
        {isDemo ? 'Illustrative property twin' : 'Property twin (illustration)'} · {d.area}
      </div>
      <div style={{ position: 'absolute', top: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
        {panel(`Water level · ${d.water.body}`, d.water.level, d.water.trend, d.water.fc)}
        {panel('Alert radius 1 km', `${d.eventsN} events`, `${d.crisisN} crisis · ${d.trafficN} traffic`, C.text4)}
      </div>
      <div style={{ position: 'absolute', left: 20, bottom: 20, right: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div
          style={{
            display: 'flex', gap: 22, padding: '14px 18px', borderRadius: 18, background: 'rgba(255,255,255,0.62)',
            backdropFilter: 'blur(18px) saturate(1.4)', WebkitBackdropFilter: 'blur(18px) saturate(1.4)', border: '1px solid rgba(255,255,255,0.9)',
            boxShadow: '0 20px 40px -24px rgba(20,23,26,0.35)', position: 'relative', overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '30%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.7),transparent)', animation: 'frShimmer 7s ease-in-out infinite' }} />
          {stat('Temperature', `${d.temp}°C`)}
          {stat('Wind', `${d.wind} m/s`)}
          {stat('Humidity', `${d.hum}%`)}
          {stat('Rain 24 h', `${d.rain} mm`)}
        </div>
      </div>
    </div>
  );
}
