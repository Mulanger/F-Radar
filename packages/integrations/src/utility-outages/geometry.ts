import type { GeoJsonGeometry } from '../types';

/**
 * Geometry helpers for outage feeds. Feeds disagree on axis order (Vattenfall and Ellevio publish
 * lat,lon; KML is lon,lat), so every coordinate is validated against Sweden's bounding box – a swapped
 * axis always fails this check instead of silently matching the wrong place.
 */
export const SWEDEN_BBOX = { minLat: 55.0, maxLat: 69.2, minLon: 10.5, maxLon: 24.3 } as const;

export type LonLat = [number, number];

export const inSweden = ([lon, lat]: LonLat) =>
  Number.isFinite(lon) && Number.isFinite(lat) && lat >= SWEDEN_BBOX.minLat && lat <= SWEDEN_BBOX.maxLat && lon >= SWEDEN_BBOX.minLon && lon <= SWEDEN_BBOX.maxLon;

/** Closes a ring and requires ≥ 4 positions (GeoJSON linear ring). Returns null when invalid. */
export function closeRing(ring: LonLat[]): LonLat[] | null {
  if (ring.length < 3 || !ring.every(inSweden)) return null;
  const [f, l] = [ring[0]!, ring[ring.length - 1]!];
  const closed = f[0] === l[0] && f[1] === l[1] ? ring : [...ring, f];
  return closed.length >= 4 ? closed : null;
}

/** Flat [lat, lon, lat, lon, …] (Vattenfall) → ring of [lon, lat]. */
export function ringFromFlatLatLon(flat: unknown): LonLat[] | null {
  if (!Array.isArray(flat) || flat.length < 6 || flat.length % 2 !== 0 || !flat.every((v) => typeof v === 'number')) return null;
  const ring: LonLat[] = [];
  for (let i = 0; i < flat.length; i += 2) ring.push([flat[i + 1] as number, flat[i] as number]);
  return closeRing(ring);
}

/** Polygons (each = [outer, ...holes]) → GeoJSON Polygon/MultiPolygon, or null. */
export function polygonsToGeoJson(polys: LonLat[][][]): GeoJsonGeometry | null {
  if (!polys.length) return null;
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}

/* ------------------------------------------------------------------ */
/* Minimal KML reader (Digpro outage KML + concession KML)              */
/* ------------------------------------------------------------------ */

export interface KmlPlacemark {
  styleUrl: string | null;
  data: Record<string, string>;
  /** Each polygon = [outer ring, ...inner rings] in lon/lat. Invalid rings make the polygon null-dropped. */
  polygons: LonLat[][][];
  points: LonLat[];
  /** Set when any coordinate of the placemark was invalid/outside Sweden. */
  invalidGeometry: boolean;
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITY[e.toLowerCase()] ?? m),
    );
}

function parseCoords(text: string): LonLat[] | null {
  const out: LonLat[] = [];
  for (const tuple of text.trim().split(/\s+/)) {
    if (!tuple) continue;
    const [lon, lat] = tuple.split(',').map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    out.push([lon!, lat!]);
  }
  return out;
}

/** True when the text looks like a KML document (has a <kml> root). */
export const looksLikeKml = (text: string) => /<kml[\s>]/i.test(text);

export function parseKmlPlacemarks(text: string): KmlPlacemark[] {
  const out: KmlPlacemark[] = [];
  const re = /<Placemark(?:\s[^>]*)?>([\s\S]*?)<\/Placemark>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const body = m[1]!;
    const styleUrl = /<styleUrl>\s*([^<]*?)\s*<\/styleUrl>/.exec(body)?.[1] ?? null;
    const data: Record<string, string> = {};
    const dre = /<Data\s+name="([^"]+)"\s*>([\s\S]*?)<\/Data>/g;
    let d: RegExpExecArray | null;
    while ((d = dre.exec(body))) {
      const v = /<value>([\s\S]*?)<\/value>/.exec(d[2]!);
      data[d[1]!] = v ? decodeXml(v[1]!).trim() : '';
    }
    let invalid = false;
    const polygons: LonLat[][][] = [];
    const pre = /<Polygon(?:\s[^>]*)?>([\s\S]*?)<\/Polygon>/g;
    let p: RegExpExecArray | null;
    while ((p = pre.exec(body))) {
      const outerTxt = /<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(p[1]!)?.[1];
      const outer = outerTxt ? parseCoords(outerTxt) : null;
      const ring = outer ? closeRing(outer) : null;
      if (!ring) {
        invalid = true;
        continue;
      }
      const holes: LonLat[][] = [];
      const hre = /<innerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g;
      let h: RegExpExecArray | null;
      while ((h = hre.exec(p[1]!))) {
        const hole = parseCoords(h[1]!);
        const closed = hole ? closeRing(hole) : null;
        if (closed) holes.push(closed);
        else invalid = true;
      }
      polygons.push([ring, ...holes]);
    }
    const points: LonLat[] = [];
    const ptre = /<Point(?:\s[^>]*)?>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Point>/g;
    let pt: RegExpExecArray | null;
    while ((pt = ptre.exec(body))) {
      const c = parseCoords(pt[1]!);
      if (c && c.length === 1 && inSweden(c[0]!)) points.push(c[0]!);
      else invalid = true;
    }
    out.push({ styleUrl, data, polygons, points, invalidGeometry: invalid });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* SWEREF 99 TM (EPSG:3006) → WGS84                                    */
/* ------------------------------------------------------------------ */

/**
 * Inverse Gauss–Krüger projection for SWEREF 99 TM with Lantmäteriet's published series
 * ("Gauss Krügers projektion", GRS 80, central meridian 15°, scale 0.9996, false easting 500 000).
 * Accuracy is well below a metre inside Sweden. Returns [lon, lat].
 */
export function sweref99tmToWgs84(northing: number, easting: number): LonLat {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const lambda0 = (15 * Math.PI) / 180;
  const e2 = f * (2 - f);
  const n = f / (2 - f);
  const aRoof = (a / (1 + n)) * (1 + (n * n) / 4 + (n ** 4) / 64);
  const d1 = n / 2 - (2 * n * n) / 3 + (37 * n ** 3) / 96 - n ** 4 / 360;
  const d2 = (n * n) / 48 + n ** 3 / 15 - (437 * n ** 4) / 1440;
  const d3 = (17 * n ** 3) / 480 - (37 * n ** 4) / 840;
  const d4 = (4397 * n ** 4) / 161280;
  const As = e2 + e2 ** 2 + e2 ** 3 + e2 ** 4;
  const Bs = -(7 * e2 ** 2 + 17 * e2 ** 3 + 30 * e2 ** 4) / 6;
  const Cs = (224 * e2 ** 3 + 889 * e2 ** 4) / 120;
  const Ds = -(4279 * e2 ** 4) / 1260;
  const xi = northing / (k0 * aRoof);
  const eta = (easting - 500000) / (k0 * aRoof);
  const xiP =
    xi -
    d1 * Math.sin(2 * xi) * Math.cosh(2 * eta) -
    d2 * Math.sin(4 * xi) * Math.cosh(4 * eta) -
    d3 * Math.sin(6 * xi) * Math.cosh(6 * eta) -
    d4 * Math.sin(8 * xi) * Math.cosh(8 * eta);
  const etaP =
    eta -
    d1 * Math.cos(2 * xi) * Math.sinh(2 * eta) -
    d2 * Math.cos(4 * xi) * Math.sinh(4 * eta) -
    d3 * Math.cos(6 * xi) * Math.sinh(6 * eta) -
    d4 * Math.cos(8 * xi) * Math.sinh(8 * eta);
  const phiStar = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  const dLambda = Math.atan(Math.sinh(etaP) / Math.cos(xiP));
  const s = Math.sin(phiStar) ** 2;
  const phi = phiStar + Math.sin(phiStar) * Math.cos(phiStar) * (As + Bs * s + Cs * s * s + Ds * s * s * s);
  return [((lambda0 + dLambda) * 180) / Math.PI, (phi * 180) / Math.PI];
}

/** GeoJSON (Multi)Polygon coordinates in SWEREF 99 TM [E, N] → polygons in lon/lat; null if invalid. */
export function swerefPolygonsToLonLat(g: { type?: string; coordinates?: unknown } | null | undefined): LonLat[][][] | null {
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return null;
  const polys = (g.type === 'Polygon' ? [g.coordinates] : (g.coordinates as unknown[])) as unknown[];
  const out: LonLat[][][] = [];
  for (const poly of polys) {
    if (!Array.isArray(poly)) return null;
    const rings: LonLat[][] = [];
    for (const ring of poly) {
      if (!Array.isArray(ring)) return null;
      const closed = closeRing(ring.map((p) => (Array.isArray(p) ? sweref99tmToWgs84(Number(p[1]), Number(p[0])) : ([NaN, NaN] as LonLat))));
      if (!closed) return null;
      rings.push(closed);
    }
    out.push(rings);
  }
  return out.length ? out : null;
}

/** Circle (centre lon/lat, radius m) as a 32-gon ring – for operators that publish point + radius areas. */
export function circleRing([lon, lat]: LonLat, radiusM: number, sides = 32): LonLat[] | null {
  if (!inSweden([lon, lat]) || !(radiusM > 0) || radiusM > 50_000) return null;
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const ring: LonLat[] = [];
  for (let i = 0; i < sides; i++) {
    const t = (2 * Math.PI * i) / sides;
    ring.push([lon + dLon * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return closeRing(ring);
}
