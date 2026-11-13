import type * as Leaflet from 'leaflet';
import { TILE_ERROR_THRESHOLD, tileConfig, type TileConfig } from '@/lib/maps/tile-config';

/**
 * Leaflet helpers shared by every map (portfolio, local context, location picker).
 * Leaflet is bundled locally and loaded lazily on the client (it touches `window` at
 * import time). Tile provider settings come from `lib/maps/tile-config.ts` only.
 */

let leafletPromise: Promise<typeof Leaflet> | null = null;
export function loadLeaflet(): Promise<typeof Leaflet> {
  leafletPromise ??= import('leaflet').then((m) => (m as unknown as { default?: typeof Leaflet }).default ?? (m as typeof Leaflet));
  return leafletPromise;
}

/**
 * Adds the configured raster tile layer with credit-conscious options. After
 * TILE_ERROR_THRESHOLD consecutive tile errors (invalid/unauthorised key, 429 rate limit,
 * network) the layer is removed so no further paid requests are made, and the attribution
 * corner explains why. Markers and overlays keep working without tiles.
 */
export function addTileLayer(L: typeof Leaflet, map: Leaflet.Map, cfg: TileConfig = tileConfig): Leaflet.TileLayer | null {
  map.attributionControl.setPrefix(false);
  if (cfg.provider === 'none') {
    map.attributionControl.addAttribution(cfg.attribution);
    return null;
  }
  const layer = L.tileLayer(cfg.url, {
    minZoom: cfg.minZoom,
    maxZoom: cfg.maxZoom,
    attribution: cfg.attribution,
    // Cost control: fewer off-screen tiles, no requests while animating, only when idle.
    keepBuffer: 1,
    updateWhenZooming: false,
    updateWhenIdle: true,
  });
  let consecutiveErrors = 0;
  layer.on('tileload', () => {
    consecutiveErrors = 0;
  });
  layer.on('tileerror', () => {
    consecutiveErrors++;
    if (consecutiveErrors === TILE_ERROR_THRESHOLD) {
      map.removeLayer(layer);
      map.attributionControl.addAttribution('Map tiles unavailable');
      console.warn('[maps] tile provider failed repeatedly – tile layer disabled for this map');
    }
  });
  layer.addTo(map);
  return layer;
}

export function newMap(L: typeof Leaflet, el: HTMLElement, center: [number, number], zoom: number) {
  const m = L.map(el, {
    zoomControl: false,
    scrollWheelZoom: false,
    minZoom: tileConfig.minZoom,
    maxZoom: tileConfig.maxZoom,
  }).setView(center, zoom);
  addTileLayer(L, m);
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
