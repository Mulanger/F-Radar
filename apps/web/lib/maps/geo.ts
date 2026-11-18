import type { EventMapGeometry } from '@fastighetsradar/domain';

/** [lat, lon] – Leaflet's order. */
export type LL = [number, number];

/** Local equirectangular projection around `a` in metres (accurate to well under 1 % within a few km). */
function proj(a: LL) {
  const kx = 111_320 * Math.cos((a[0] * Math.PI) / 180);
  const ky = 110_540;
  return {
    f: (p: LL): [number, number] => [(p[1] - a[1]) * kx, (p[0] - a[0]) * ky],
    b: (q: [number, number]): LL => [a[0] + q[1] / ky, a[1] + q[0] / kx],
  };
}

export function distM(p: LL, q: LL): number {
  const v = proj(p).f(q);
  return Math.hypot(v[0], v[1]);
}

export function runLength(run: LL[]): number {
  let s = 0;
  for (let i = 1; i < run.length; i++) s += distM(run[i - 1]!, run[i]!);
  return s;
}

/** The point `frac` (0–1) of the way along a polyline. */
export function alongRun(run: LL[], frac: number): LL {
  const total = runLength(run) * frac;
  let s = 0;
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1]!;
    const b = run[i]!;
    const d = distM(a, b);
    if (s + d >= total) {
      const t = d ? (total - s) / d : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    s += d;
  }
  return run[run.length - 1]!;
}

/** Closest point to `p` on any segment of the polylines. */
export function nearestOnRuns(runs: LL[][], p: LL): LL | null {
  const k = proj(p);
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (const run of runs) {
    if (run.length === 1) {
      const q = k.f(run[0]!);
      const d = q[0] * q[0] + q[1] * q[1];
      if (d < bd) [bd, best] = [d, q];
    }
    for (let i = 0; i < run.length - 1; i++) {
      const a = k.f(run[i]!);
      const b = k.f(run[i + 1]!);
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / l2));
      const x = a[0] + t * dx;
      const y = a[1] + t * dy;
      const d = x * x + y * y;
      if (d < bd) [bd, best] = [d, [x, y]];
    }
  }
  return best ? k.b(best) : null;
}

/** Point `m` metres from `c` towards bearing `deg` (0 = north). */
export function offsetLL(c: LL, deg: number, m: number): LL {
  const r = (deg * Math.PI) / 180;
  return proj(c).b([Math.sin(r) * m, Math.cos(r) * m]);
}

/** The geometry's polylines in Leaflet order (a Point is one single-point run, an area its outer rings). */
export function geometryRuns(g: EventMapGeometry): LL[][] {
  const ll = (p: [number, number]): LL => [p[1], p[0]];
  if (g.type === 'Point') return [[ll(g.coordinates)]];
  if (g.type === 'LineString') return [g.coordinates.map(ll)];
  if (g.type === 'MultiLineString') return g.coordinates.map((line) => line.map(ll));
  if (g.type === 'Polygon') return [g.coordinates[0]!.map(ll)];
  return g.coordinates.map((poly) => poly[0]!.map(ll));
}

/** Whether `p` lies inside any of the closed rings (even–odd rule). */
export function insideRings(rings: LL[][], p: LL): boolean {
  return rings.some((ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i]!;
      const [yj, xj] = ring[j]!;
      if (yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}
