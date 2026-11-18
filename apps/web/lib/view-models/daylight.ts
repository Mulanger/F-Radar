/**
 * Darkness (sunset → sunrise) for the "Kommande förhållanden" timeline – the "Mörker" shading.
 * The sunrise equation (NOAA simplification, ±1–2 min): enough to shade hours on a 48 h strip.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const toJulian = (ms: number) => ms / DAY_MS + 2440587.5;
const fromJulian = (j: number) => (j - 2440587.5) * DAY_MS;

/**
 * Sunrise and sunset (ms) for the solar day around `noonMs`. `polar: 'night'` when the sun does not
 * rise, `'day'` when it does not set.
 */
export function sunTimes(noonMs: number, lat: number, lon: number): { rise: number; set: number } | { polar: 'night' | 'day' } {
  const n = Math.round(toJulian(noonMs) - 2451545.0 + 0.0008);
  const jStar = n - lon / 360;
  const m = (357.5291 + 0.98560028 * jStar) % 360;
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
  const lambda = (m + c + 180 + 102.9372) % 360;
  const transit = 2451545.0 + jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec);
  if (cosW > 1) return { polar: 'night' };
  if (cosW < -1) return { polar: 'day' };
  const w = Math.acos(cosW) / RAD;
  return { rise: fromJulian(transit - w / 360), set: fromJulian(transit + w / 360) };
}

/** Dark intervals inside [from, to], as fractions 0–1 of that window. */
export function darkSpans(from: number, to: number, lat: number, lon: number): Array<{ start: number; end: number }> {
  const span = to - from;
  const dark: Array<[number, number]> = [];
  // Solar days from the one before the window to the one after it.
  const firstNoon = Math.floor(from / DAY_MS) * DAY_MS + 12 * 3_600_000 - (lon / 360) * DAY_MS;
  for (let noon = firstNoon - DAY_MS; noon <= to + DAY_MS; noon += DAY_MS) {
    const today = sunTimes(noon, lat, lon);
    const next = sunTimes(noon + DAY_MS, lat, lon);
    if ('polar' in today) {
      if (today.polar === 'night') dark.push([noon - DAY_MS / 2, noon + DAY_MS / 2]);
      continue;
    }
    // Night after this day's sunset until the next sunrise.
    const rise = 'polar' in next ? (next.polar === 'night' ? noon + 1.5 * DAY_MS : null) : next.rise;
    if (rise !== null) dark.push([today.set, rise]);
  }
  const out: Array<{ start: number; end: number }> = [];
  for (const [a, b] of dark.sort((x, y) => x[0] - y[0])) {
    const s = Math.max(a, from), e = Math.min(b, to);
    if (e <= s) continue;
    const last = out.at(-1);
    const start = (s - from) / span, end = (e - from) / span;
    if (last && start <= last.end + 1e-6) last.end = Math.max(last.end, end);
    else out.push({ start, end });
  }
  return out;
}
