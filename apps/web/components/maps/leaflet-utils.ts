import type * as Leaflet from 'leaflet';

/**
 * Leaflet helpers ported from the prototype. Leaflet is bundled locally and loaded
 * lazily on the client (it touches `window` at import time).
 *
 * Tiles: the prototype used CARTO "light_all" raster tiles. The production tile
 * provider is an open decision (IMPLEMENTATION.md §24) and CARTO's public basemaps
 * now require a key/licence for this use. The URL is therefore configurable via
 * NEXT_PUBLIC_MAP_TILE_URL / NEXT_PUBLIC_MAP_TILE_ATTRIBUTION (public by design –
 * never put a secret there).
 */

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || '© OpenStreetMap © CARTO';

let leafletPromise: Promise<typeof Leaflet> | null = null;
export function loadLeaflet(): Promise<typeof Leaflet> {
  leafletPromise ??= import('leaflet').then((m) => (m as unknown as { default?: typeof Leaflet }).default ?? (m as typeof Leaflet));
  return leafletPromise;
}

export function newMap(L: typeof Leaflet, el: HTMLElement, center: [number, number], zoom: number) {
  const m = L.map(el, { zoomControl: false, scrollWheelZoom: false }).setView(center, zoom);
  m.attributionControl.setPrefix(false);
  L.tileLayer(TILE_URL, { subdomains: 'abcd', maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(m);
  return m;
}

export function pinIcon(L: typeof Leaflet, color: string, size = 18) {
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="position:relative;width:${size}px;height:${size}px"><span style="position:absolute;inset:0;border-radius:50%;background:${color};animation:frPulse 2.4s ease-out infinite"></span><span style="position:absolute;inset:0;border-radius:50%;background:${color};border:3px solid #fff;box-sizing:border-box;box-shadow:0 3px 10px rgba(20,23,26,.3)"></span></div>`,
  });
}

/** Escapes text interpolated into Leaflet tooltip HTML (data may come from external sources later). */
export function esc(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
