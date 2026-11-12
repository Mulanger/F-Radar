'use client';

import type { DetailVM } from '@/lib/view-models/detail';
import { C, smallCard } from '@/lib/design/tokens';
import { IconDrop, IconLeaf, IconRain, IconThermometer, IconWind } from '../ui/icons';

const instrument: React.CSSProperties = { ...smallCard, display: 'flex', flexDirection: 'column', gap: 6 };
const head: React.CSSProperties = { fontSize: 12.5, color: C.text3, display: 'flex', alignItems: 'center', gap: 6 };
const value: React.CSSProperties = { fontSize: 32, fontWeight: 500, letterSpacing: '-0.035em' };
const unit: React.CSSProperties = { fontSize: 15, color: C.text4 };
const foot: React.CSSProperties = { fontSize: 11.5, color: C.text4 };

/** Five instrument cards: temperature, rain 24 h, wind, humidity, air quality. */
export function EnvironmentalMetrics({ d, isDemo }: { d: DetailVM; isDemo: boolean }) {
  const src = (s: string) => (isDemo ? `${s} · demo fixture` : s);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
      <div style={instrument} title={src('SMHI point forecast')}>
        <div style={head}><IconThermometer />Current Temperature</div>
        <div style={value}>{d.temp}°</div>
        <svg width="100%" height="36" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
          {d.tempSpark && <path d={d.tempSpark} fill="none" stroke="oklch(0.66 0.14 55)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />}
        </svg>
        <div style={foot}>Feels like {d.feels}° · {d.tempRange}</div>
      </div>

      <div style={instrument} title={src('SMHI point forecast')}>
        <div style={head}><IconRain size={14} />Rain Forecast 24 h</div>
        <div style={value}>{d.rain}<span style={unit}> mm</span></div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 36 }} aria-hidden="true">
          {d.rainBars.map((b) => (
            <div key={b.key} style={{ flex: 1, borderRadius: 2, height: b.h, background: b.c, transition: 'height .8s' }} />
          ))}
        </div>
        <div style={foot}>{d.rainPeak}</div>
      </div>

      <div style={instrument} title={src('SMHI point forecast')}>
        <div style={head}><IconWind />Wind Speed</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={value}>{d.wind}<span style={unit}> m/s</span></div>
          <div style={{ width: 52, height: 52, borderRadius: '50%', border: '1.5px solid #E6E9E8', position: 'relative', display: 'grid', placeItems: 'center' }} aria-label={`Wind from ${d.windDir}`}>
            <span style={{ position: 'absolute', top: 2, fontSize: 8, color: C.text4 }}>N</span>
            <div style={{ width: 2, height: 34, transform: `rotate(${d.windRot})`, transition: 'transform 1s', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 0, left: -4, width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: `9px solid ${C.ink}` }} />
              <div style={{ position: 'absolute', top: 8, bottom: 6, left: 0, width: 2, background: C.ink, borderRadius: 1 }} />
            </div>
          </div>
        </div>
        <div style={{ height: 5, borderRadius: 3, background: C.chip, overflow: 'hidden', marginTop: 'auto' }}>
          <div style={{ height: 5, borderRadius: 3, width: d.windW, background: 'oklch(0.58 0.08 210)', transition: 'width 1s' }} />
        </div>
        <div style={foot}>Gusts {d.gust} m/s · from {d.windDir}</div>
      </div>

      <div style={instrument} title={src('SMHI point forecast')}>
        <div style={head}><IconDrop />Humidity</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
          <div style={value}>{d.hum}<span style={unit}>%</span></div>
          <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
            <circle cx="32" cy="32" r="26" fill="none" stroke={C.chip} strokeWidth="7" />
            <circle cx="32" cy="32" r="26" fill="none" stroke="oklch(0.6 0.1 265)" strokeWidth="7" strokeLinecap="round" strokeDasharray={d.humDash} style={{ transition: 'stroke-dasharray 1.2s' }} />
          </svg>
        </div>
        <div style={foot}>Dew point {d.dew}° · condensation risk {d.condens}</div>
      </div>

      <div style={instrument} title={src('Nearest air-quality station (not a building value)')}>
        <div style={head}><IconLeaf />Air Quality</div>
        <div style={value}>{d.aqi}<span style={{ fontSize: 15, color: d.aqC }}> {d.aq}</span></div>
        <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'linear-gradient(90deg,oklch(0.75 0.13 155),oklch(0.85 0.13 100),oklch(0.75 0.15 60),oklch(0.62 0.18 28))', marginTop: 'auto' }}>
          <div style={{ position: 'absolute', top: -4, left: d.aqLeft, width: 4, height: 16, marginLeft: -2, borderRadius: 2, background: C.ink, border: '2px solid #fff', transition: 'left 1s' }} />
        </div>
        <div style={foot}>PM2.5 {d.pm} µg/m³ · NO₂ {d.no2} µg/m³</div>
      </div>
    </div>
  );
}
