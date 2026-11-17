'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type * as Leaflet from 'leaflet';
import { tileConfig } from '@/lib/maps/tile-config';
import { alongRun, distM, nearestOnRuns, offsetLL, runLength, type LL } from '@/lib/maps/geo';
import { EVENT_MAP_ICON_PATH, type EventMapEntry } from '@/lib/view-models/event-map';
import { addTileLayer, esc, loadLeaflet } from './leaflet-utils';
import s from './EventMapView.module.css';

export interface EventMapViewProps {
  entries: EventMapEntry[];
  openId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  property: { name: string; address: string; lat: number; lon: number };
  live: boolean;
}

/** Wide layout: cards in a left column instead of top/bottom sheets. Keep in sync with the CSS module. */
const WIDE = 900;
const DOTS_MAX = 12;

const Svg = ({ d, size = 18, sw = 2 }: { d: string; size?: number; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const CHEV_L = 'm15 6-6 6 6 6';
const CHEV_R = 'm9 6 6 6-6 6';

function evMarker(L: typeof Leaflet, path: string, hx: string) {
  return L.divIcon({
    className: '',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `<div style="position:relative;width:44px;height:44px"><span style="position:absolute;inset:0;border-radius:15px;background:${hx};animation:frRing 2.2s ease-out infinite"></span><div style="position:absolute;inset:0;border-radius:15px;background:${hx};border:3px solid #fff;box-sizing:border-box;box-shadow:0 8px 18px -4px rgba(20,23,26,.45);display:grid;place-items:center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg></div></div>`,
  });
}
function propPin(L: typeof Leaflet, name: string) {
  return L.divIcon({
    className: '',
    iconSize: [36, 46],
    iconAnchor: [18, 43],
    html: `<div style="position:relative;width:36px;height:46px"><div style="position:absolute;left:0;top:0;width:36px;height:36px;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);background:#14171A;border:3px solid #fff;box-sizing:border-box;box-shadow:0 8px 18px -4px rgba(20,23,26,.45)"></div><svg style="position:absolute;left:10px;top:9px" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M3 21h18M9 21v-4h6v4"/></svg><div style="position:absolute;left:50%;bottom:50px;transform:translateX(-50%);white-space:nowrap;background:#14171A;color:#fff;font:600 11.5px var(--font-geist-sans),Geist,system-ui,sans-serif;padding:4px 9px;border-radius:9px;box-shadow:0 4px 12px rgba(20,23,26,.25)">${esc(name)}</div></div>`,
  });
}
function endPin(L: typeof Leaflet, hx: string, label: string) {
  return L.divIcon({
    className: '',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<div style="position:relative;width:14px;height:14px"><div style="width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid ${hx};box-sizing:border-box;box-shadow:0 2px 6px rgba(20,23,26,.3)"></div><div style="position:absolute;left:50%;bottom:19px;transform:translateX(-50%);white-space:nowrap;background:#fff;color:${hx};font:600 10.5px var(--font-geist-sans),Geist,system-ui,sans-serif;padding:3px 7px;border-radius:7px;box-shadow:0 3px 10px rgba(20,23,26,.2)">${label}</div></div>`,
  });
}
function tagIcon(L: typeof Leaflet, text: string) {
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html: `<div style="position:absolute;transform:translate(-50%,-50%);white-space:nowrap;background:#fff;color:#14171A;font:600 11.5px var(--font-geist-sans),Geist,system-ui,sans-serif;padding:4px 9px;border-radius:10px;box-shadow:0 4px 12px rgba(20,23,26,.2)">${esc(text)}</div>`,
  });
}

interface MapCtx {
  L: typeof Leaflet;
  map: Leaflet.Map;
  layer: Leaflet.LayerGroup;
  tags: Leaflet.LayerGroup;
}

/** Start/Slut labels only when the stretch is at least this long on screen (they cover the marker otherwise). */
const ENDS_MIN_PX = 120;

/**
 * Full-screen (mobile) / large modal (desktop) map for one local event: the affected stretch
 * highlighted in the event's colour with start and end, the property, and the distance between.
 */
export function EventMapView({ entries, openId, onSelect, onClose, property, live }: EventMapViewProps) {
  const mapEl = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const botRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const ctxRef = useRef<MapCtx | null>(null);
  const viewRef = useRef<{ pp: LL; ev: LL[]; dist: { near: LL; text: string } | null; ends: [LL, LL] | null; hx: string } | null>(null);
  const [ready, setReady] = useState(false);

  const idx = Math.max(0, entries.findIndex((e) => e.id === openId));
  const e = entries[idx]!;
  const n = entries.length;
  const pp: LL = [property.lat, property.lon];

  const fitTo = (pts: LL[], animate: boolean, maxZoom = 17) => {
    const ctx = ctxRef.current;
    const el = mapEl.current;
    if (!ctx || !el || !pts.length) return;
    const r = el.getBoundingClientRect();
    const top = topRef.current?.getBoundingClientRect();
    const bot = botRef.current?.getBoundingClientRect();
    // Room for the pins' name labels (centred on the pin) and the zoom buttons on the right.
    let tl: [number, number];
    let br: [number, number];
    if (r.width >= WIDE) {
      tl = [Math.max(80, (top ? top.right - r.left : 0) + 70), 90];
      br = [110, 50];
    } else {
      // The property's name label sits ~75 px above its pin.
      tl = [72, top ? Math.max(90, top.bottom - r.top + 84) : 320];
      br = [76, bot ? Math.max(36, r.bottom - bot.top + 22) : 240];
    }
    ctx.map.invalidateSize(false);
    ctx.map.fitBounds(ctx.L.latLngBounds(pts), { paddingTopLeft: tl, paddingBottomRight: br, maxZoom, animate, duration: 0.6 });
  };

  /** Zoom-dependent labels: Start/Slut when the stretch is long enough on screen, and the distance halfway. */
  const placeTag = () => {
    const ctx = ctxRef.current;
    const v = viewRef.current;
    if (!ctx) return;
    ctx.tags.clearLayers();
    if (v?.ends) {
      const p0 = ctx.map.latLngToContainerPoint(v.ends[0]);
      const p1 = ctx.map.latLngToContainerPoint(v.ends[1]);
      if (Math.hypot(p0.x - p1.x, p0.y - p1.y) >= ENDS_MIN_PX) {
        ctx.tags.addLayer(ctx.L.marker(v.ends[0], { icon: endPin(ctx.L, v.hx, 'Start'), interactive: false, keyboard: false }));
        ctx.tags.addLayer(ctx.L.marker(v.ends[1], { icon: endPin(ctx.L, v.hx, 'Slut'), interactive: false, keyboard: false }));
      }
    }
    if (!v?.dist) return;
    const a = ctx.map.latLngToContainerPoint(v.pp);
    const b = ctx.map.latLngToContainerPoint(v.dist.near);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 110) return;
    const at = ctx.map.containerPointToLatLng([a.x + (b.x - a.x) * 0.55, a.y + (b.y - a.y) * 0.55]);
    ctx.tags.addLayer(ctx.L.marker(at, { icon: tagIcon(ctx.L, v.dist.text), interactive: false, keyboard: false }));
  };

  // One Leaflet map for the lifetime of the view.
  useEffect(() => {
    let cancelled = false;
    const el = mapEl.current;
    loadLeaflet().then((L) => {
      if (cancelled || !el || !el.isConnected || ctxRef.current) return;
      const map = L.map(el, { zoomControl: false, zoomSnap: 0.25, minZoom: tileConfig.minZoom, maxZoom: tileConfig.maxZoom }).setView(pp, 15);
      addTileLayer(L, map);
      ctxRef.current = { L, map, layer: L.layerGroup().addTo(map), tags: L.layerGroup().addTo(map) };
      map.on('zoomend moveend', placeTag);
      setReady(true);
    });
    return () => {
      cancelled = true;
      ctxRef.current?.map.remove();
      ctxRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Draw the selected event.
  const drawKey = `${e.id}|${e.exact}|${e.runs.length}|${e.runs[0]?.length ?? 0}|${property.lat},${property.lon}`;
  useLayoutEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { L, layer } = ctx;
    layer.clearLayers();
    layer.addLayer(L.marker(pp, { icon: propPin(L, property.name), interactive: false, keyboard: false, zIndexOffset: 1000 }));
    let pts: LL[] = [];
    let ends: [LL, LL] | null = null;
    let mid: LL;
    let near: LL | null;
    const lines = e.runs.filter((r) => r.length > 1);
    if (e.shape === 'line' && lines.length) {
      for (const run of lines) {
        layer.addLayer(L.polyline(run, { color: e.hx, weight: 26, opacity: 0.16, lineCap: 'round', lineJoin: 'round', interactive: false }));
        layer.addLayer(L.polyline(run, { color: e.hx, weight: 11, opacity: 0.5, lineCap: 'round', lineJoin: 'round', interactive: false }));
        layer.addLayer(L.polyline(run, { color: '#fff', weight: 2, opacity: 0.95, dashArray: '3 7', lineCap: 'round', interactive: false }));
        pts = pts.concat(run);
      }
      const main = [...lines].sort((a, b) => runLength(b) - runLength(a))[0]!;
      ends = [main[0]!, main[main.length - 1]!];
      mid = alongRun(main, 0.5);
      near = nearestOnRuns(lines, pp);
    } else if (e.shape === 'area' && e.radiusM) {
      const c = e.runs[0]![0]!;
      layer.addLayer(L.circle(c, { radius: e.radiusM, color: e.hx, weight: 1.5, dashArray: '6 6', opacity: 0.8, fillColor: e.hx, fillOpacity: 0.16, interactive: false }));
      layer.addLayer(L.circle(c, { radius: e.radiusM * 0.5, stroke: false, fillColor: e.hx, fillOpacity: 0.2, interactive: false }));
      pts = [0, 90, 180, 270].map((deg) => offsetLL(c, deg, e.radiusM!));
      mid = c;
      const d = distM(pp, c);
      near = d > e.radiusM ? offsetLL(c, (Math.atan2((pp[1] - c[1]) * Math.cos((c[0] * Math.PI) / 180), pp[0] - c[0]) * 180) / Math.PI, e.radiusM) : null;
    } else {
      const c = e.runs[0]![0]!;
      layer.addLayer(L.circle(c, { radius: 45, stroke: false, fillColor: e.hx, fillOpacity: 0.22, interactive: false }));
      pts = [c];
      mid = c;
      near = c;
    }
    const dist = near && distM(pp, near) > 25 ? { near, text: e.dist } : null;
    if (dist) layer.addLayer(L.polyline([pp, dist.near], { color: '#14171A', weight: 2, opacity: 0.55, dashArray: '2 6', lineCap: 'round', interactive: false }));
    layer.addLayer(L.marker(mid, { icon: evMarker(L, EVENT_MAP_ICON_PATH[e.icon], e.hx), interactive: false, keyboard: false, zIndexOffset: 900 }));
    viewRef.current = { pp, ev: pts.length ? pts : [mid], dist, ends, hx: e.hx };
    fitTo([pp, ...viewRef.current.ev], false);
    placeTag();
  }, [drawKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes, arrows step between events; focus and scroll are restored on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    backRef.current?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      prev?.focus?.({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
      // Arrow keys pan the map when it has focus; elsewhere they step between events.
      else if (n > 1 && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && !(ev.target instanceof Node && mapEl.current?.contains(ev.target))) {
        onSelect(entries[(idx + (ev.key === 'ArrowLeft' ? n - 1 : 1)) % n]!.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entries, idx, n, onClose, onSelect]);

  const step = (k: number) => onSelect(entries[(idx + k + n) % n]!.id);
  const zoom = (k: 1 | -1) => (k > 0 ? ctxRef.current?.map.zoomIn() : ctxRef.current?.map.zoomOut());
  const v = () => viewRef.current;

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className={s.root} role="dialog" aria-modal="true" aria-label={`Karta: ${e.label}, ${e.where}`}>
      <div className={s.backdrop} onClick={onClose} />
      <div className={s.frame}>
        <div ref={mapEl} className={s.map} role="region" aria-label={`Karta över ${e.where} och ${property.name}`} />

        <div ref={topRef} className={s.top}>
          <div className={s.topBar}>
            <button ref={backRef} type="button" className={s.back} onClick={onClose} aria-label={`Stäng kartan och gå tillbaka till ${property.name}`}>
              <Svg d={CHEV_L} size={20} />
              <span className={s.ellipsis}>{property.name}</span>
            </button>
            <span className={`${s.live} ${live ? '' : s.demo}`}>
              <span className={s.liveDot} />
              {live ? 'Live' : 'Demo'}
            </span>
          </div>
          <div className={s.card} aria-live="polite">
            <div className={s.cardHead}>
              <span className={s.iconTile} style={{ background: e.bg, color: e.c }}>
                <Svg d={EVENT_MAP_ICON_PATH[e.icon]} size={21} sw={1.8} />
              </span>
              <div className={s.cardMain}>
                <div className={s.badges}>
                  <span className={s.label} style={{ background: e.bg, color: e.fg }}>{e.label}</span>
                  <span className={s.src}>{e.src}</span>
                </div>
                <div className={s.title}>{e.title}</div>
              </div>
            </div>
            {e.description && <div className={s.desc}>{e.description}</div>}
            <div className={s.facts}>
              <div><div className={s.factLabel}>Tid</div><div className={s.factValue}>{e.time}</div></div>
              <div><div className={s.factLabel}>Avstånd</div><div className={s.factValue}>{e.dist}</div></div>
              <div><div className={s.factLabel}>Påverkan</div><div className={s.factValue}>{e.impact}</div></div>
            </div>
          </div>
        </div>

        <div className={s.bottom}>
          <div className={s.controls}>
            <div className={s.zoom}>
              <button type="button" onClick={() => zoom(1)} aria-label="Zooma in"><Svg d="M12 5v14M5 12h14" /></button>
              <span className={s.zoomSep} />
              <button type="button" onClick={() => zoom(-1)} aria-label="Zooma ut"><Svg d="M5 12h14" /></button>
            </div>
            <button type="button" className={s.fit} onClick={() => v() && fitTo([v()!.pp, ...v()!.ev], true)} aria-label="Visa fastighet och händelse">
              <Svg d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />
            </button>
          </div>
          <div ref={botRef} className={s.sheet}>
            <button type="button" className={s.row} onClick={() => v() && fitTo([v()!.pp], true, 17)}>
              <span className={s.propDot}><Svg d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M3 21h18M9 21v-4h6v4" size={16} /></span>
              <span className={s.rowMain}>
                <span className={s.rowTitle}>{property.name}</span>
                <span className={s.rowSub}>Er fastighet · {property.address}</span>
              </span>
              <span className={s.chev}><Svg d={CHEV_R} size={16} /></span>
            </button>
            <div className={s.sep} />
            <button type="button" className={s.row} onClick={() => v() && fitTo(v()!.ev, true, 17)}>
              <span className={s.evTile} style={{ background: e.bg }}>
                {e.shape === 'line' && e.exact ? <span className={s.symLine} style={{ background: e.c }} /> : e.shape === 'area' ? <span className={s.symArea} style={{ borderColor: e.c }} /> : <span className={s.symPoint} style={{ background: e.c }} />}
              </span>
              <span className={s.rowMain}>
                <span className={s.rowTitle}>{e.where}</span>
                <span className={s.rowSub}>{e.extent}</span>
              </span>
              <span className={s.chev}><Svg d={CHEV_R} size={16} /></span>
            </button>
            {n > 1 && (
              <div className={s.pager}>
                <button type="button" onClick={() => step(-1)} aria-label="Föregående händelse"><Svg d={CHEV_L} size={20} /></button>
                <div className={s.pos}>
                  <span>Händelse {idx + 1} av {n}</span>
                  {n <= DOTS_MAX && (
                    <span className={s.dots} aria-hidden="true">
                      {entries.map((x, k) => <span key={x.id} style={{ width: k === idx ? 16 : 5, background: k === idx ? '#14171A' : '#DDE1E0' }} />)}
                    </span>
                  )}
                </div>
                <button type="button" onClick={() => step(1)} aria-label="Nästa händelse"><Svg d={CHEV_R} size={20} /></button>
              </div>
            )}
            <div className={s.attr}>
              <span dangerouslySetInnerHTML={{ __html: tileConfig.attribution }} />
              {live && <span> · Händelser: Trafikverket (CC0)</span>}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
