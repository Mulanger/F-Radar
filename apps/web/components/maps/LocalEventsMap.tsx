'use client';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { formatTrafficRadius } from '@fastighetsradar/domain';
import type { DetailVM } from '@/lib/view-models/detail';
import { C, card, glass } from '@/lib/design/tokens';
import { esc, loadLeaflet, newMap, pinIcon } from './leaflet-utils';

/**
 * "Local Context" map on Property Detail. Keeps one Leaflet instance alive while the
 * user switches properties and flies to the new location (prototype behaviour).
 */
export function LocalEventsMap({ d, onOpen }: { d: DetailVM; onOpen?: () => void }) {
  const elRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<{ L: typeof Leaflet; map: Leaflet.Map; group: Leaflet.LayerGroup } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const dRef = useRef(d);
  dRef.current = d;

  useEffect(() => {
    let cancelled = false;
    const el = elRef.current;
    loadLeaflet().then((L) => {
      if (cancelled || !el || !el.isConnected || ctxRef.current) return;
      const { lat, lon } = dRef.current.location;
      const map = newMap(L, el, [lat, lon], 14);
      ctxRef.current = { L, map, group: L.layerGroup().addTo(map) };
      setLoaded(true);
    });
    return () => {
      cancelled = true;
      ctxRef.current?.map.remove();
      ctxRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { L, map, group } = ctx;
    const { lat, lon } = d.location;
    const sevHx = `#${d.hex.toString(16).padStart(6, '0')}`;
    group.clearLayers();
    // Decorative exposure indication – not an MCF polygon.
    if (d.floodExposure === 'High' || d.floodExposure === 'Medium')
      group.addLayer(L.circle([lat + 0.0015, lon + 0.0025], { radius: d.floodExposure === 'High' ? 420 : 260, stroke: false, fillColor: '#5494B0', fillOpacity: 0.3 }));
    // Live: the organization's Trafikverket distance (Inställningar); demo: the design's 1 km.
    group.addLayer(L.circle([lat, lon], { radius: d.trafficRadiusM ?? 1000, color: sevHx, weight: 1.5, dashArray: '6 6', fillColor: sevHx, fillOpacity: 0.04 }));
    // Grid operator outage areas matched to this property (real published geometry only).
    d.outageShapes.forEach((o) => {
      group.addLayer(
        L.geoJSON(o.geometry as GeoJSON.GeoJsonObject, {
          style: { color: o.color, weight: 1.5, dashArray: o.dashed ? '5 5' : undefined, fillColor: o.color, fillOpacity: 0.15 },
          pointToLayer: (_f, ll) => L.circleMarker(ll, { radius: 6, color: '#fff', weight: 2, fillColor: o.color, fillOpacity: 1 }),
        }).bindTooltip(`<div style="font-family:inherit;font-size:12px;max-width:220px;white-space:normal">${esc(o.label)}</div>`, { sticky: true }),
      );
    });
    d.events.forEach((e) => {
      if (!e.location) return;
      group.addLayer(
        L.marker([e.location.lat, e.location.lon], {
          icon: L.divIcon({
            className: '',
            iconSize: [14, 14],
            html: `<div style="width:14px;height:14px;border-radius:4px;background:${e.hx};border:2px solid #fff;box-sizing:border-box;box-shadow:0 2px 6px rgba(0,0,0,.25)"></div>`,
          }),
        }).bindTooltip(`<div style="font-family:inherit;font-size:12px;max-width:200px;white-space:normal">${esc(e.title)}</div>`, { direction: 'top', offset: [0, -8] }),
      );
    });
    group.addLayer(L.marker([lat, lon], { icon: pinIcon(L, sevHx, 22), title: d.name }));
    map.flyTo([lat, lon], 14, { duration: 0.8 });
    // Redraw only when the property (or its data) changes.
  }, [d.id, d.name, d.lat, d.lon, d.trafficRadiusM, d.events.length, d.hex, d.floodExposure, d.outageShapes.map((o) => o.id + o.color).join(), loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ ...card, flex: '1.3 1 460px', minHeight: 420, position: 'relative', overflow: 'hidden', background: C.mapBg }}>
      <div ref={elRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }} role="region" aria-label={`Karta över närområdet för ${d.name}`} />
      <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 500, padding: '12px 16px', borderRadius: 16, ...glass(0.82, 16) }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Närområde</div>
        <div style={{ fontSize: 12, color: C.text3 }}>{d.trafficRadiusM ? `Trafikavstånd ${formatTrafficRadius(d.trafficRadiusM)}` : 'Larmradie 1 km'} · händelser · översvämningszon{d.outageShapes.length ? ' · avbrottsområden' : ''}</div>
      </div>
      <div className="fr-map-legend" style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 500, display: 'flex', gap: 14, padding: '10px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(16px)', fontSize: 12, color: C.text2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: '50%', border: `1.5px dashed ${d.c}` }} />{d.trafficRadiusM ? 'Trafikavstånd' : 'Larmradie'}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'oklch(0.65 0.15 55)' }} />Händelse</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(84,148,176,0.45)' }} />Översvämningszon</span>
      </div>
      {onOpen && (
        <button type="button" className="fr-map-open" onClick={onOpen} style={{ position: 'absolute', right: 12, bottom: 34, zIndex: 500, height: 40, padding: '0 14px 0 12px', borderRadius: 20, border: 'none', background: '#FFFFFF', boxShadow: '0 6px 16px -6px rgba(20,23,26,0.35)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, color: C.ink, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" /></svg>
          Öppna karta
        </button>
      )}
    </div>
  );
}
