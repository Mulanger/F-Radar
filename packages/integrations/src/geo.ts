/** Great-circle distance on WGS84 coordinates; station search only (not parcel geometry). */
export function haversineMeters(lat: number, lon: number, otherLat: number, otherLon: number): number {
  const r = Math.PI / 180;
  const a = Math.sin((otherLat - lat) * r / 2) ** 2 + Math.cos(lat * r) * Math.cos(otherLat * r) * Math.sin((otherLon - lon) * r / 2) ** 2;
  return 6_371_008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}
