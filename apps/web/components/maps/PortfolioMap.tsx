'use client';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import type { PropertySnapshot } from '@fastighetsradar/domain';
import { C, SEV, card, glass } from '@/lib/design/tokens';
import { metricValue, show } from '@/lib/view-models/snapshot';
import { esc, loadLeaflet, newMap, pinIcon } from './leaflet-utils';

interface Props {
  list: PropertySnapshot[];
  legend: Array<{ key: string; label: string; c: string; n: number }>;
  layers: { weather: boolean; flood: boolean };
  onToggleLayer: (k: 'weather' | 'flood') => void;
  onOpen: (id: string) => void;
}

type Groups = { markers: Leaflet.LayerGroup; flood: Leaflet.LayerGroup; weather: Leaflet.LayerGroup };

export function PortfolioMap({ list, legend, layers, onToggleLayer, onOpen }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ L: typeof Leaflet; map: Leaflet.Map; groups: Groups } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    let cancelled = false;
    const el = elRef.current;
    loadLeaflet().then((L) => {
      if (cancelled || !el || !el.isConnected || mapRef.current) return;
      const map = newMap(L, el, [59.338, 18.055], 11);
      const groups: Groups = { markers: L.layerGroup().addTo(map), flood: L.layerGroup(), weather: L.layerGroup() };
      mapRef.current = { L, map, groups };
      setLoaded(true);
    });
    return () => {
      cancelled = true;
      mapRef.current?.map.remove();
      mapRef.current = null;
    };
  }, []);

  // Draw markers + decorative layers whenever the filtered list changes.
  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx) return;
    const { L, map, groups } = ctx;
    Object.values(groups).forEach((g) => g.clearLayers());
    list.forEach((s) => {
      const p = s.property;
      const st = SEV[p.status] ?? SEV.unknown;
      const { lat, lon } = p.location;
      const rain = metricValue(s, 'weather.precipitation_24h');
      const mk = L.marker([lat, lon], { icon: pinIcon(L, st.hx), keyboard: true, title: p.name });
      mk.bindTooltip(
        `<div style="font-family:inherit;min-width:190px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><b style="font-size:13.5px;font-weight:600;color:#14171A">${esc(p.name)}</b><span style="font-size:11px;padding:2px 7px;border-radius:7px;background:${st.bg};color:${st.c}">${esc(st.label)}</span></div><div style="font-size:11.5px;color:#9AA1A8;margin:2px 0 8px">${esc(p.area)}</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:11px;color:#6B737B"><div>Temp<br><b style="font-size:13px;color:#14171A;font-weight:500">${esc(show(metricValue(s, 'weather.air_temperature')))}°</b></div><div>Rain 24h<br><b style="font-size:13px;color:#14171A;font-weight:500">${esc(show(rain))} mm</b></div><div>Risk<br><b style="font-size:13px;color:#14171A;font-weight:500">${esc(show(s.demoRisk?.score))}</b></div></div></div>`,
        { direction: 'top', offset: [0, -12], opacity: 1 },
      );
      mk.on('click', () => onOpenRef.current(p.id));
      groups.markers.addLayer(mk);
      const exposure = s.flood.mapped.exposureClass;
      // Decorative indications only – not a mapped flood polygon (MCF layers are not imported yet).
      if (exposure === 'High' || exposure === 'Medium')
        groups.flood.addLayer(L.circle([lat + 0.0012, lon + 0.002], { radius: exposure === 'High' ? 650 : 380, stroke: false, fillColor: '#5494B0', fillOpacity: 0.22 }));
      if (rain !== null && rain > 9)
        groups.weather.addLayer(L.circle([lat, lon], { radius: rain * 150, stroke: false, fillColor: '#4A7FD0', fillOpacity: 0.08 + rain / 300 }));
    });
    if (list.length) map.fitBounds(L.latLngBounds(list.map((s) => [s.property.location.lat, s.property.location.lon])), { padding: [70, 70], maxZoom: 13 });
  }, [list, loaded]);

  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx) return;
    (['flood', 'weather'] as const).forEach((k) => {
      const g = ctx.groups[k];
      if (layers[k]) g.addTo(ctx.map);
      else ctx.map.removeLayer(g);
    });
  }, [layers, loaded]);

  const overlay = glass(0.82, 16);
  const layerBtn = (active: boolean): React.CSSProperties => ({
    height: 32, padding: '0 12px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 12.5,
    background: active ? C.ink : 'transparent', color: active ? '#fff' : C.text2,
  });
  const zoomBtn: React.CSSProperties = { width: 36, height: 36, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, color: C.ink };

  return (
    <div style={{ ...card, flex: '1.5 1 620px', height: 460, position: 'relative', overflow: 'hidden', background: C.mapBg }}>
      <div ref={elRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }} role="region" aria-label="Portfolio map" />
      <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 500, padding: '12px 16px', borderRadius: 16, ...overlay }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Portfolio Map</div>
        <div style={{ fontSize: 12, color: C.text3 }}>Click a pin to open property detail</div>
      </div>
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 500, display: 'flex', gap: 4, padding: 4, borderRadius: 16, ...overlay }}>
        <button onClick={() => onToggleLayer('weather')} aria-pressed={layers.weather} style={layerBtn(layers.weather)}>Rain overlay</button>
        <button onClick={() => onToggleLayer('flood')} aria-pressed={layers.flood} style={layerBtn(layers.flood)}>Flood zones</button>
      </div>
      <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 500, display: 'flex', gap: 14, padding: '10px 14px', borderRadius: 14, ...overlay }}>
        {legend.map((l) => (
          <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.text2 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.c }} />
            {l.label}
            <b style={{ fontWeight: 600, color: C.ink }}>{l.n}</b>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', bottom: 16, right: 16, zIndex: 500, display: 'flex', flexDirection: 'column', borderRadius: 14, overflow: 'hidden', background: 'rgba(255,255,255,0.88)', border: '1px solid rgba(255,255,255,0.9)' }}>
        <button onClick={() => mapRef.current?.map.zoomIn()} aria-label="Zoom in" style={zoomBtn}>+</button>
        <div style={{ height: 1, background: 'rgba(20,23,26,0.08)' }} />
        <button onClick={() => mapRef.current?.map.zoomOut()} aria-label="Zoom out" style={zoomBtn}>−</button>
      </div>
    </div>
  );
}
