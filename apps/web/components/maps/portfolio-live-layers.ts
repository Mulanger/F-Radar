import type * as Leaflet from 'leaflet';
import { RADAR_BOUNDS, RADAR_MAX_AGE_MS } from '@/lib/maps/portfolio-radar';

const SMHI_RADAR_LINK = 'https://www.smhi.se/data/nederbord-och-fuktighet/nederbord/radarbilder-aktuella-och-historiska';

/** Shows SMHI's latest radar frame on the map and reports its time (null while none is shown). */
export function watchPortfolioRadar(L: typeof Leaflet, map: Leaflet.Map, onFrame: (measuredAt: string | null) => void = () => {}) {
  const controller = new AbortController();
  const unavailable = 'Radar tillfälligt otillgänglig';
  let displayed: { measuredAt: string; overlay: Leaflet.ImageOverlay; url: string } | undefined;
  let nextRefresh: ReturnType<typeof setTimeout>;
  let expiry: ReturnType<typeof setTimeout>;
  let unavailableShown = false;

  function showUnavailable(show: boolean) {
    if (show === unavailableShown) return;
    unavailableShown = show;
    if (show) map.attributionControl.addAttribution(unavailable);
    else map.attributionControl.removeAttribution(unavailable);
  }

  function clearFrame() {
    if (!displayed) return;
    displayed.overlay.remove();
    URL.revokeObjectURL(displayed.url);
    displayed = undefined;
    onFrame(null);
  }

  async function refresh() {
    let pendingUrl: string | undefined;
    try {
      const response = await fetch('/api/map/radar', { signal: controller.signal });
      const measuredAt = response.headers.get('x-radar-measured-at');
      const age = measuredAt ? Date.now() - Date.parse(measuredAt) : Infinity;
      if (!response.ok || !measuredAt || !(age >= 0 && age < RADAR_MAX_AGE_MS)) throw new Error('Radar frame unavailable');
      if (displayed?.measuredAt === measuredAt) return;

      pendingUrl = URL.createObjectURL(await response.blob());
      const img = new Image();
      img.src = pendingUrl;
      await img.decode();
      const remaining = RADAR_MAX_AGE_MS - (Date.now() - Date.parse(measuredAt));
      if (controller.signal.aborted || remaining <= 0) return;
      clearFrame();
      clearTimeout(expiry);
      showUnavailable(false);
      const overlay = L.imageOverlay(pendingUrl, RADAR_BOUNDS, {
        alt: 'Nederbörd från SMHI:s radar',
        attribution: `<a href="${SMHI_RADAR_LINK}">Radar · SMHI</a>`,
      }).addTo(map);
      displayed = { measuredAt, overlay, url: pendingUrl };
      onFrame(measuredAt);
      pendingUrl = undefined;
      expiry = setTimeout(() => {
        clearFrame();
        showUnavailable(true);
      }, remaining);
    } catch {
      if (!controller.signal.aborted && !displayed) showUnavailable(true);
    } finally {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
      if (!controller.signal.aborted) nextRefresh = setTimeout(refresh, 60_000);
    }
  }

  void refresh();
  return () => {
    controller.abort();
    clearTimeout(nextRefresh);
    clearTimeout(expiry);
    clearFrame();
    showUnavailable(false);
  };
}
