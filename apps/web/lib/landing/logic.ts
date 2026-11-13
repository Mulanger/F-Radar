import { FORECAST, FORECAST_HOURS, type ForecastTab } from './content';

/** Swedish decimal formatting used in the landing illustrations ("5,6°"). */
export const fmtSv = (v: number, unit: string) => v.toFixed(1).replace('.', ',') + unit;

/** "gul, orange och röd" */
export function joinSv(items: string[]): string {
  if (items.length < 2) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} och ${items[items.length - 1]}`;
}

export interface ChartModel {
  line: string;
  area: string;
  color: string;
  now: string;
  min: string;
  max: string;
  avg: string;
  /** Peak marker position in % of the chart box. */
  peakX: string;
  peakY: string;
  peakLabel: string;
}

/** Smooth Catmull-Rom → Bézier path for the 24 h forecast chart (600×170 viewBox). */
export function chartModel(tab: ForecastTab, w = 600, h = 170, pad = 12): ChartModel {
  const s = FORECAST[tab];
  const vals = s.vals as readonly number[];
  const n = vals.length;
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const lo = s.zero ? 0 : mn - (mx - mn) * 0.1;
  const hi = mx + (mx - mn) * 0.1;
  const pts = vals.map((v, i) => [(i * w) / (n - 1), pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad)] as const);
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    d +=
      ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)}` +
      ` ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)}` +
      ` ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const pi = vals.indexOf(mx);
  return {
    line: d,
    area: `${d} L${w},${h} L0,${h} Z`,
    color: s.color,
    now: fmtSv(vals[0]!, s.unit),
    min: fmtSv(mn, s.unit),
    max: fmtSv(mx, s.unit),
    avg: fmtSv(vals.reduce((a, b) => a + b, 0) / n, s.unit),
    peakX: `${((pts[pi]![0] / w) * 100).toFixed(2)}%`,
    peakY: `${((pts[pi]![1] / h) * 100).toFixed(2)}%`,
    peakLabel: `Topp ${fmtSv(mx, s.unit)} · ${FORECAST_HOURS[pi]}`,
  };
}

export interface SmsLevels {
  gul: boolean;
  orange: boolean;
  rod: boolean;
}

/**
 * Preview for the interactive SMS-rule demo. In the illustrated situation there is one orange
 * (wind) and one yellow (rain) warning, and no red warning.
 */
export function smsPreview(l: SmsLevels): { body: string | null; empty: string | null; levelsText: string } {
  const names = ([['gul', 'gul'], ['orange', 'orange'], ['rod', 'röd']] as const).filter(([k]) => l[k]).map(([, n]) => n);
  const levelsText = names.length ? `Du får SMS vid ${joinSv(names)} varning.` : 'Välj minst en nivå.';
  if (l.orange) return { body: 'Orange varning: kraftig vind vid Augustendal Brygga. Byar upp till 25 m/s, ons 16:00–tors 10:00. Källa: SMHI', empty: null, levelsText };
  if (l.gul) return { body: 'Gul varning: kraftigt regn vid Sjöstaden Kaj. 20–30 mm inom 12 timmar, tors 06:00–20:00. Källa: SMHI', empty: null, levelsText };
  if (l.rod) return { body: null, empty: 'Inget SMS just nu — aktuella varningar ligger under vald nivå.', levelsText };
  return { body: null, empty: 'Inga nivåer valda. Inga SMS skickas.', levelsText };
}

/** Annotation timeline: opacity (0–1, eased) of card `i` at time `t` (s), and whether it is "active". */
export function annotationPhase(i: number, t: number, cardSeconds: number, count: number): { e: number; active: boolean } {
  const T = Math.max(1.2, cardSeconds);
  const D = T * 2.7;
  const cyc = T * count;
  const age = (((t - i * T) % cyc) + cyc) % cyc;
  const k = age < D ? Math.min(1, age / 0.6, (D - age) / 0.5) : 0;
  const e = 1 - Math.pow(1 - Math.max(0, k), 3);
  return { e, active: k > 0.5 };
}

export interface CardBox {
  left: number;
  top: number;
  w: number;
  h: number;
  /** Allowed vertical range for the card's top edge. */
  minTop: number;
  maxTop: number;
}

/**
 * Keeps hero annotation cards from covering each other. Boxes are given in priority order (the
 * card that has been on screen longest first) and keep their place; later cards are moved just
 * above or below a card they would cover, whichever is closer, if that fits inside the bounds.
 * Returns the resolved top edge per box and whether it is clear of the earlier cards (when there is
 * no room, e.g. in a narrow phone column, `clear` is false and the caller should hold the card back).
 */
export function stackCards(boxes: CardBox[], gap = 10): Array<{ top: number; clear: boolean }> {
  const placed: Array<{ left: number; top: number; w: number; h: number }> = [];
  return boxes.map((b) => {
    const others = placed.filter((p) => b.left < p.left + p.w + gap && p.left < b.left + b.w + gap);
    const free = (top: number) => others.every((p) => top >= p.top + p.h + gap || p.top >= top + b.h + gap);
    const candidates = [b.top, ...others.flatMap((p) => [p.top + p.h + gap, p.top - b.h - gap])]
      .filter((c) => c >= b.minTop && c <= b.maxTop && free(c))
      .sort((x, y) => Math.abs(x - b.top) - Math.abs(y - b.top));
    const top = candidates[0] ?? b.top;
    const clear = candidates.length > 0;
    // A held-back card does not block later ones.
    if (clear) placed.push({ left: b.left, top, w: b.w, h: b.h });
    return { top, clear };
  });
}
