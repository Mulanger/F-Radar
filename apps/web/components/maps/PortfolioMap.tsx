'use client';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import type { PropertySnapshot } from '@fastighetsradar/domain';
import { C, SEV, card, glass, type SeverityStyle } from '@/lib/design/tokens';
import { metricValue, riskScore, show } from '@/lib/view-models/snapshot';
import { buildMapMarkers, type MapMarker } from '@/lib/maps/cluster';
import { clusterIcon, esc, loadLeaflet, newMap, pinIcon } from './leaflet-utils';
import { addPortfolioFlood, watchPortfolioRadar } from './portfolio-live-layers';

interface Props {
  compact?: boolean;
  mobileControls?: boolean;
  list: PropertySnapshot[];
  legend: Array<{ key: string; label: string; c: string; n: number }>;
  layers: { weather: boolean; flood: boolean };
  onToggleLayer: (k: 'weather' | 'flood') => void;
  onOpen: (id: string) => void;
}

type Groups = { markers: Leaflet.LayerGroup; flood: Leaflet.LayerGroup; weather: Leaflet.LayerGroup };
type Ctx = { L: typeof Leaflet; map: Leaflet.Map; groups: Groups };
type Shown = { marker: Leaflet.Marker; sig: string };
type Cluster = Extract<MapMarker, { kind: 'cluster' }>;

/**
 * Pins closer than this on screen are drawn as one cluster (S-18): a pin's width (18 px) plus a small
 * gap, so only pins that crowd each other merge – the eight demo properties stay eight pins.
 */
const CLUSTER_RADIUS_PX = 24;

function tooltipHtml(s: PropertySnapshot, st: SeverityStyle) {
  const p = s.property;
  const rain = metricValue(s, 'weather.precipitation_24h');
  return `<div style="font-family:inherit;min-width:190px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><b style="font-size:13.5px;font-weight:600;color:#14171A">${esc(p.name)}</b><span style="font-size:11px;padding:2px 7px;border-radius:7px;background:${st.bg};color:${st.c}">${esc(st.label)}</span></div><div style="font-size:11.5px;color:#9AA1A8;margin:2px 0 8px">${esc(p.area)}</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:11px;color:#6B737B"><div>Temp<br><b style="font-size:13px;color:#14171A;font-weight:500">${esc(show(metricValue(s, 'weather.air_temperature')))}°</b></div><div>Nederbörd 24 h<br><b style="font-size:13px;color:#14171A;font-weight:500">${esc(show(rain))} mm</b></div><div>Risk<br><b style="font-size:13px;color:#14171A;font-weight:500">${esc(show(riskScore(s)))}</b></div></div></div>`;
}

function clusterTooltipHtml(m: Cluster, canZoom: boolean) {
  const rows = m.counts
    .map(({ status, n }) => {
      const st = SEV[status] ?? SEV.unknown;
      return `<div style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${st.hx}"></span>${esc(st.label)}<b style="margin-left:auto;color:#14171A;font-weight:600">${n}</b></div>`;
    })
    .join('');
  const hint = canZoom ? 'Klicka för att zooma in' : m.samePlace ? 'Samma adresspunkt – klicka för att välja' : 'Klicka för att välja fastighet';
  return `<div style="font-family:inherit;min-width:180px"><b style="font-size:13.5px;font-weight:600;color:#14171A">${m.members.length} fastigheter</b><div style="font-size:11.5px;color:#6B737B;margin:6px 0;display:flex;flex-direction:column;gap:3px">${rows}</div><div style="font-size:11px;color:#9AA1A8">${hint}</div></div>`;
}

/** The properties of a cluster that zooming cannot separate, as buttons that open each one. */
function clusterList(m: Cluster, open: (id: string) => void): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'font-family:inherit;min-width:220px';
  const head = document.createElement('div');
  head.style.cssText = 'font-size:13.5px;font-weight:600;color:#14171A';
  head.textContent = `${m.members.length} fastigheter${m.samePlace ? ' på samma adresspunkt' : ''}`;
  const ul = document.createElement('ul');
  ul.setAttribute('aria-label', 'Fastigheter här');
  ul.style.cssText = 'list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:2px;max-height:240px;overflow:auto';
  for (const s of m.members) {
    const st = SEV[s.property.status] ?? SEV.unknown;
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:6px 4px;border:none;border-radius:8px;background:transparent;font:inherit;font-size:12.5px;color:#14171A;text-align:left;cursor:pointer';
    const dot = document.createElement('span');
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${st.hx}`;
    const name = document.createElement('span');
    name.textContent = s.property.name;
    const status = document.createElement('span');
    status.style.cssText = 'margin-left:auto;color:#9AA1A8;font-size:11px;white-space:nowrap';
    status.textContent = st.label;
    button.append(dot, name, status);
    button.addEventListener('click', () => open(s.property.id));
    li.append(button);
    ul.append(li);
  }
  el.append(head, ul);
  return el;
}

/**
 * Draws the list at the map's zoom: one pin per lone property, one cluster where pins would overlap.
 * Pins and clusters are not tab stops (500 of them were); the property list beside the map is the
 * keyboard path (S-18).
 */
function syncMarkers(ctx: Ctx, list: PropertySnapshot[], markers: Map<string, Shown>, open: (id: string) => void) {
  const { L, map, groups } = ctx;
  const zoom = map.getZoom();
  const seen = new Set<string>();
  const place = (key: string, sig: string, create: () => Leaflet.Marker) => {
    seen.add(key);
    const current = markers.get(key);
    if (current?.sig === sig) return;
    if (current) groups.markers.removeLayer(current.marker);
    const marker = create();
    groups.markers.addLayer(marker);
    markers.set(key, { marker, sig });
  };
  for (const m of buildMapMarkers(list, (lat, lon) => map.project([lat, lon], zoom), CLUSTER_RADIUS_PX)) {
    if (m.kind === 'pin') {
      const p = m.snapshot.property;
      const st = SEV[p.status] ?? SEV.unknown;
      const { lat, lon } = p.location;
      const tooltip = tooltipHtml(m.snapshot, st);
      place(m.key, `${lat},${lon}|${st.hx}|${p.name}|${tooltip}`, () => {
        const mk = L.marker([lat, lon], { icon: pinIcon(L, st.hx), keyboard: false, title: p.name });
        mk.bindTooltip(tooltip, { direction: 'top', offset: [0, -12], opacity: 1 });
        mk.on('click', () => open(p.id));
        return mk;
      });
      continue;
    }
    const st = SEV[m.status] ?? SEV.unknown;
    const canZoom = !m.samePlace && zoom < map.getMaxZoom();
    const tooltip = clusterTooltipHtml(m, canZoom);
    place(m.key, `${m.lat},${m.lon}|${st.hx}|${tooltip}`, () => {
      const mk = L.marker([m.lat, m.lon], { icon: clusterIcon(L, st.hx, m.members.length), keyboard: false, title: `${m.members.length} fastigheter`, zIndexOffset: 500 });
      mk.bindTooltip(tooltip, { direction: 'top', offset: [0, -18], opacity: 1 });
      mk.on('click', () => {
        if (canZoom) {
          map.fitBounds(L.latLngBounds(m.members.map((s) => [s.property.location.lat, s.property.location.lon])), { padding: [60, 60] });
          return;
        }
        L.popup({ maxWidth: 320, offset: [0, -14] }).setLatLng([m.lat, m.lon]).setContent(clusterList(m, open)).openOn(map);
      });
      return mk;
    });
  }
  for (const [key, shown] of markers) {
    if (seen.has(key)) continue;
    groups.markers.removeLayer(shown.marker);
    markers.delete(key);
  }
}

export function PortfolioMap({ list, legend, layers, onToggleLayer, onOpen, compact = false, mobileControls = false }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Ctx | null>(null);
  const [loaded, setLoaded] = useState(false);
  const live = list.some((s) => s.property.origin === 'live');
  const radarVisible = live && !compact && layers.weather;
  const floodVisible = live && !compact && layers.flood;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const listRef = useRef(list);
  listRef.current = list;
  /** Pins and clusters by key with what they show, so a refresh only touches changed ones. */
  const markersRef = useRef(new Map<string, Shown>());
  /** Property set the view was last fitted to; a refresh with the same set keeps the user's zoom. */
  const fittedRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const el = elRef.current;
    const markers = markersRef.current;
    loadLeaflet().then((L) => {
      if (cancelled || !el || !el.isConnected || mapRef.current) return;
      const map = newMap(L, el, [59.338, 18.055], 11);
      const groups: Groups = { markers: L.layerGroup().addTo(map), flood: L.layerGroup(), weather: L.layerGroup() };
      mapRef.current = { L, map, groups };
      // Clusters depend on the zoom: re-draw when it changes (S-18).
      map.on('zoomend', () => {
        if (mapRef.current) syncMarkers(mapRef.current, listRef.current, markers, (id) => onOpenRef.current(id));
      });
      setLoaded(true);
    });
    return () => {
      cancelled = true;
      mapRef.current?.map.remove();
      mapRef.current = null;
      markers.clear();
      fittedRef.current = null;
    };
  }, []);

  // Sync markers with the list (docs/plans/skalning.md, S-13 and S-18): pins and clusters at the
  // current zoom, re-drawn on zoom; unchanged ones stay. Fit the view only on first draw and when the
  // SET of properties changes (group filter, property added/removed) – a live refresh keeps zoom and pan.
  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx) return;
    const { L, map, groups } = ctx;
    // Use the illustrative circles only for demo properties.
    groups.flood.clearLayers();
    groups.weather.clearLayers();
    list.forEach((s) => {
      const p = s.property;
      if (p.origin !== 'demo_fixture') return;
      const { lat, lon } = p.location;
      const exposure = s.flood.mapped.exposureClass;
      const rain = metricValue(s, 'weather.precipitation_24h');
      if (exposure === 'High' || exposure === 'Medium')
        groups.flood.addLayer(L.circle([lat + 0.0012, lon + 0.002], { radius: exposure === 'High' ? 650 : 380, stroke: false, fillColor: '#5494B0', fillOpacity: 0.22 }));
      if (rain !== null && rain > 9)
        groups.weather.addLayer(L.circle([lat, lon], { radius: rain * 150, stroke: false, fillColor: '#4A7FD0', fillOpacity: 0.08 + rain / 300 }));
    });
    const fitKey = list.map((s) => s.property.id).sort().join('|');
    if (list.length && fittedRef.current !== fitKey) {
      fittedRef.current = fitKey;
      map.fitBounds(L.latLngBounds(list.map((s) => [s.property.location.lat, s.property.location.lon])), { padding: [70, 70], maxZoom: 13 });
    }
    syncMarkers(ctx, list, markersRef.current, (id) => onOpenRef.current(id));
  }, [list, loaded]);

  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx) return;
    (['flood', 'weather'] as const).forEach((k) => {
      const g = ctx.groups[k];
      if (!live && layers[k]) g.addTo(ctx.map);
      else ctx.map.removeLayer(g);
    });
  }, [layers, live, loaded]);

  useEffect(() => {
    const ctx = mapRef.current;
    if (loaded && radarVisible && ctx) return watchPortfolioRadar(ctx.L, ctx.map);
  }, [loaded, radarVisible]);

  useEffect(() => {
    const ctx = mapRef.current;
    if (loaded && floodVisible && ctx) return addPortfolioFlood(ctx.L, ctx.map);
  }, [loaded, floodVisible]);

  const overlay = glass(0.82, 16);
  const footerLegend = compact || mobileControls;
  const layerBtn = (active: boolean): React.CSSProperties => ({
    height: mobileControls ? 44 : 32, padding: mobileControls ? '0 6px' : '0 12px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: mobileControls ? 12 : 12.5,
    ...(mobileControls ? { flex: 1, minWidth: 0 } : {}),
    background: active ? C.ink : 'transparent', color: active ? '#fff' : C.text2,
  });
  const zoomBtn: React.CSSProperties = { width: footerLegend ? 44 : 36, height: footerLegend ? 44 : 36, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, color: C.ink };

  return (
    <div style={{ ...card, flex: '1.5 1 620px', height: compact ? 300 : 460, position: 'relative', overflow: 'hidden', background: footerLegend ? C.white : C.mapBg }}>
      <div ref={elRef} style={{ position: 'absolute', inset: 0, bottom: footerLegend ? 80 : 0, zIndex: 0 }} role="region" aria-label="Portföljkarta" />
      {!compact && !mobileControls && <div className="fr-map-title" style={{ position: 'absolute', top: 16, left: 16, zIndex: 500, padding: '12px 16px', borderRadius: 16, ...overlay }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Portföljkarta</div>
        <div style={{ fontSize: 12, color: C.text3 }}>Klicka på en nål för att öppna fastigheten</div>
      </div>}
      {!compact && <div className={mobileControls ? undefined : 'fr-map-layers'} style={{ position: 'absolute', top: 16, right: 16, ...(mobileControls ? { left: 16 } : {}), zIndex: 500, display: 'flex', gap: 4, padding: 4, borderRadius: 16, ...overlay }}>
        <button onClick={() => onToggleLayer('weather')} aria-label="Nederbördslager" aria-pressed={layers.weather} style={layerBtn(layers.weather)}>{mobileControls ? 'Regn' : 'Nederbördslager'}</button>
        <button onClick={() => onToggleLayer('flood')} aria-label="Översvämningszoner" aria-pressed={layers.flood} style={layerBtn(layers.flood)}>{mobileControls ? 'Översvämning' : 'Översvämningszoner'}</button>
      </div>}
      <div className={footerLegend ? undefined : 'fr-map-legend'} style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 500, display: 'flex', gap: 14, padding: '10px 14px', borderRadius: 14, ...overlay, ...(footerLegend ? { right: 14, left: 14, bottom: 14, padding: 0, flexWrap: 'wrap', gap: '6px 14px', border: 'none', background: 'transparent' } : {}) }}>
        {legend.map((l) => (
          <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.text2 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.c }} />
            {footerLegend && l.label === 'Ingen aktiv varning' ? 'Utan varning' : l.label}
            <b style={{ fontWeight: 600, color: C.ink }}>{l.n}</b>
          </div>
        ))}
      </div>
      <div className={footerLegend ? undefined : 'fr-map-zoom'} style={{ position: 'absolute', bottom: footerLegend ? 100 : 16, right: 16, zIndex: 500, display: 'flex', flexDirection: 'column', borderRadius: 14, overflow: 'hidden', background: 'rgba(255,255,255,0.88)', border: '1px solid rgba(255,255,255,0.9)' }}>
        <button onClick={() => mapRef.current?.map.zoomIn()} aria-label="Zooma in" style={zoomBtn}>+</button>
        <div style={{ height: 1, background: 'rgba(20,23,26,0.08)' }} />
        <button onClick={() => mapRef.current?.map.zoomOut()} aria-label="Zooma ut" style={zoomBtn}>−</button>
      </div>
    </div>
  );
}
