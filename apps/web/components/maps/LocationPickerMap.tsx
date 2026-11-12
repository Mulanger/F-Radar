'use client';

import { useEffect, useRef } from 'react';
import type * as Leaflet from 'leaflet';
import { loadLeaflet, newMap, pinIcon } from './leaflet-utils';

/**
 * Small Leaflet map with a draggable pin for confirming / correcting a property position.
 * Clicking the map or dragging the pin reports the new point via `onChange`.
 */
export function LocationPickerMap({
  point,
  onChange,
  zoom = 16,
}: {
  point: { lat: number; lon: number };
  onChange: (p: { lat: number; lon: number }) => void;
  zoom?: number;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ map: Leaflet.Map; marker: Leaflet.Marker } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pointRef = useRef(point);
  pointRef.current = point;

  useEffect(() => {
    let cancelled = false;
    const el = elRef.current;
    loadLeaflet().then((L) => {
      if (cancelled || !el || ctx.current) return;
      const p = pointRef.current;
      const map = newMap(L, el, [p.lat, p.lon], zoom);
      map.scrollWheelZoom.enable();
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      const marker = L.marker([p.lat, p.lon], { draggable: true, icon: pinIcon(L, '#14171A', 22), keyboard: true, title: 'Property position – drag to adjust' }).addTo(map);
      const report = (ll: Leaflet.LatLng) => onChangeRef.current({ lat: +ll.lat.toFixed(7), lon: +ll.lng.toFixed(7) });
      marker.on('dragend', () => report(marker.getLatLng()));
      map.on('click', (e: Leaflet.LeafletMouseEvent) => {
        marker.setLatLng(e.latlng);
        report(e.latlng);
      });
      ctx.current = { map, marker };
    });
    return () => {
      cancelled = true;
      ctx.current?.map.remove();
      ctx.current = null;
    };
  }, [zoom]);

  // External point changes (new suggestion selected) → move pin and recentre.
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const cur = c.marker.getLatLng();
    if (Math.abs(cur.lat - point.lat) < 1e-7 && Math.abs(cur.lng - point.lon) < 1e-7) return;
    c.marker.setLatLng([point.lat, point.lon]);
    c.map.setView([point.lat, point.lon], Math.max(c.map.getZoom(), 15));
  }, [point.lat, point.lon]);

  return <div ref={elRef} role="region" aria-label="Confirm property position on map" style={{ position: 'absolute', inset: 0 }} />;
}
