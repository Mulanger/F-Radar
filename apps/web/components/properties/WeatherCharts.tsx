'use client';

import type { ChartMetric } from '@/lib/state/dashboard-state';
import type { DetailVM } from '@/lib/view-models/detail';
import { C, FONT_MONO, card, cardSub, cardTitle } from '@/lib/design/tokens';

/** "Environmental Conditions" – 24 h forecast chart with metric tabs. */
export function WeatherCharts({ d, isDemo, onMetric }: { d: DetailVM; isDemo: boolean; onMetric: (m: ChartMetric) => void }) {
  const ch = d.chart;
  return (
    <div style={{ ...card, flex: '1.7 1 600px', padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={cardTitle}>Väderförhållanden</div>
          <div style={cardSub}>{isDemo ? 'SMHI punktprognos · kommande 24 h · syntetisk demoserie' : 'SMHI punktprognos · kommande 24 h'}</div>
        </div>
        <div role="tablist" aria-label="Prognosvärde" className="fr-tabs" style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 16, background: C.page }}>
          {d.tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={t.active}
              onClick={() => onMetric(t.key)}
              style={{
                height: 30, padding: '0 12px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 12.5, transition: 'all .2s',
                background: t.active ? C.white : 'transparent', color: t.active ? C.ink : C.text3, boxShadow: t.active ? '0 1px 3px rgba(20,23,26,0.1)' : 'none',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {d.precipitationIntervals.length > 0 && d.tabs.find(t => t.active)?.key === 'rain' && <details style={{ fontSize: 12, color: C.text3 }}>
        <summary>Osäkerhetsintervall för nederbörd · {d.forecastSource}</summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 10 }}>{d.precipitationIntervals.map(p => <span key={p.at}>{p.at}: {p.text}</span>)}</div>
      </details>}
      {!ch ? (
        <div style={{ height: 220, display: 'grid', placeItems: 'center', fontSize: 13, color: C.text3, borderRadius: 16, background: '#F8F9F8' }}>
          Prognos otillgänglig för den här fastigheten
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            {ch.stats.map((s) => (
              <div key={s.label}>
                <div style={{ fontSize: 11.5, color: C.text4 }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.02em' }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ position: 'relative', height: 220, paddingLeft: 44 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontFamily: FONT_MONO, fontSize: 10.5, color: C.text4 }}>
              <span>{ch.yMax}</span>
              <span>{ch.yMid}</span>
              <span>{ch.yMin}</span>
            </div>
            <div style={{ position: 'relative', height: 196 }}>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div style={{ borderTop: '1px dashed rgba(20,23,26,0.08)' }} />
                <div style={{ borderTop: '1px dashed rgba(20,23,26,0.08)' }} />
                <div style={{ borderTop: '1px dashed rgba(20,23,26,0.08)' }} />
              </div>
              <svg width="100%" height="196" viewBox="0 0 640 196" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, overflow: 'visible' }} role="img" aria-label={`Prognosdiagram: ${d.tabs.find((t) => t.active)?.label}`}>
                <defs>
                  <linearGradient id="envGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={ch.c} stopOpacity="0.28" />
                    <stop offset="1" stopColor={ch.c} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={ch.area} fill="url(#envGrad)" />
                <path d={ch.line} fill="none" stroke={ch.c} strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
              <div style={{ position: 'absolute', left: ch.pL, top: ch.pT, transform: 'translate(-50%,-50%)', transition: 'all .6s' }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#fff', border: `3px solid ${ch.c}`, boxSizing: 'border-box' }} />
                <div style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: 11.5, fontWeight: 500, padding: '4px 8px', borderRadius: 8, background: C.ink, color: '#fff' }}>
                  {ch.pLabel}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FONT_MONO, fontSize: 10.5, color: C.text4, marginTop: 8 }}>
              {ch.xLabels.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
