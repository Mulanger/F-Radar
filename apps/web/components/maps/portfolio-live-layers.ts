import { formatClock } from '@fastighetsradar/domain';
import type * as Leaflet from 'leaflet';
import { RADAR_BOUNDS, RADAR_MAX_AGE_MS } from '@/lib/maps/portfolio-radar';

const SMHI_RADAR_LINK = 'https://www.smhi.se/data/nederbord-och-fuktighet/nederbord/radarbilder-aktuella-och-historiska';
const MCF_FLOOD_LINK = 'https://www.mcf.se/sv/verktyg--tjanster/oversvamningskartering---visningstjanst-fran-och-med-2013/';

export function addPortfolioFlood(L: typeof Leaflet, map: Leaflet.Map) {
  const pane = 'portfolio-flood';
  const element = map.getPane(pane) ?? map.createPane(pane);
  element.style.zIndex = '350';
  element.style.pointerEvents = 'none';
  const layer = L.tileLayer.wms('https://inspire.mcf.se/oversvamning/wms', {
    version: '1.1.1',
    layers: 'NZ_Oversvamning_BHF,NZ_Oversvamning_200,NZ_Oversvamning_100',
    format: 'image/png',
    transparent: true,
    attribution: `<a href="${MCF_FLOOD_LINK}">Översvämningsscenarier · MCF</a>`,
    uppercase: true,
    noWrap: true,
    bounds: L.latLngBounds([55, 10], [70, 25]),
    maxNativeZoom: 14,
    keepBuffer: 1,
    updateWhenZooming: false,
    updateWhenIdle: true,
    referrerPolicy: 'no-referrer',
    opacity: 0.6,
    pane,
  }).addTo(map);
  return () => { layer.remove(); };
}

export function watchPortfolioRadar(L: typeof Leaflet, map: Leaflet.Map) {
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
        attribution: `<a href="${SMHI_RADAR_LINK}">Radar ${formatClock(measuredAt)} · SMHI</a>`,
      }).addTo(map);
      displayed = { measuredAt, overlay, url: pendingUrl };
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
