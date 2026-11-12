/** SVG path helpers ported verbatim from the prototype (`smooth`, `chartOf`). */

export type Pt = [number, number];

export function smooth(pts: Pt[]): string {
  if (!pts.length) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export interface ChartGeometry {
  line: string;
  area: string;
  pts: Pt[];
  mn: number;
  mx: number;
}

export function chartOf(vals: number[], W: number, H: number, pad = 0.12, zero = false): ChartGeometry {
  if (!vals.length) return { line: '', area: '', pts: [], mn: 0, mx: 0 };
  let mn = Math.min(...vals);
  let mx = Math.max(...vals);
  if (zero) mn = 0;
  if (mx - mn < 1e-6) mx = mn + 1;
  const denom = Math.max(1, vals.length - 1);
  const pts: Pt[] = vals.map((v, i) => [(i / denom) * W, H - pad * H - ((v - mn) / (mx - mn)) * H * (1 - 2 * pad)]);
  const line = smooth(pts);
  return { line, area: line + ` L${W},${H} L0,${H} Z`, pts, mn, mx };
}
