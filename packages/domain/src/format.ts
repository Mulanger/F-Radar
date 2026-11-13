/**
 * Presentation helpers shared by web and API. All timestamps are stored in UTC
 * and displayed in Europe/Stockholm (IMPLEMENTATION.md §8).
 *
 * The product is Swedish: dates use sv-SE ("tors 13 nov", "torsdag 13 november") and
 * decimals use a comma ("2,6"). Coordinates are NOT passed through these helpers (they keep a dot).
 */
export const DISPLAY_TIME_ZONE = 'Europe/Stockholm';
export const DISPLAY_LOCALE = 'sv-SE';

const hhmm = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: DISPLAY_TIME_ZONE,
});
const weekdayShort = new Intl.DateTimeFormat(DISPLAY_LOCALE, { weekday: 'short', timeZone: DISPLAY_TIME_ZONE });
const longDate = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: DISPLAY_TIME_ZONE,
});
const shortDate = new Intl.DateTimeFormat(DISPLAY_LOCALE, { day: 'numeric', month: 'short', timeZone: DISPLAY_TIME_ZONE });

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** "14:32" */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  return hhmm.format(new Date(iso));
}

/** "tors 06:00" */
export function formatWeekdayClock(iso: string | null | undefined, nullLabel = 'Tills vidare'): string {
  if (!iso) return nullLabel;
  const d = new Date(iso);
  return `${weekdayShort.format(d).replace('.', '')} ${hhmm.format(d)}`;
}

/** "Torsdag 13 november" */
export function formatLongDate(iso: string): string {
  return cap(longDate.format(new Date(iso)).replace(',', ''));
}

/** "13 nov." */
export function formatShortDate(iso: string): string {
  return shortDate.format(new Date(iso));
}

/* ------------------------------------------------------------------ */
/* Swedish calendar days (DST-safe)                                    */
/* ------------------------------------------------------------------ */

const dateKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: DISPLAY_TIME_ZONE });
const zoneParts = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const weekdayLong = new Intl.DateTimeFormat(DISPLAY_LOCALE, { weekday: 'long', timeZone: DISPLAY_TIME_ZONE });

/** Calendar date in Swedish time, e.g. "2026-11-13". */
export function swedishDateKey(at: Date | string): string {
  return dateKey.format(new Date(at));
}

/** Milliseconds Swedish local time is ahead of UTC at `at` (3 600 000 in winter, 7 200 000 in summer). */
function zoneOffsetMs(at: number): number {
  const p = Object.fromEntries(zoneParts.formatToParts(at).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second)) - at;
}

/** Start (00:00 Swedish time) of the calendar day `offsetDays` after the day that contains `at`. */
export function swedishMidnight(at: Date, offsetDays = 0): Date {
  const [y, m, d] = swedishDateKey(at).split('-').map(Number);
  const wall = Date.UTC(y!, m! - 1, d! + offsetDays);
  // Two passes so a day that starts on the other side of a DST change gets its own offset.
  const first = wall - zoneOffsetMs(wall);
  return new Date(wall - zoneOffsetMs(first));
}

/**
 * Calendar-day windows in Swedish time: the rest of today (only when at least `minHoursToday`
 * remain, so late evenings do not show a stub day), then whole days. DST days are 23 or 25 h.
 */
export function swedishDayWindows(now: Date, count = 5, minHoursToday = 6): Array<{ from: Date; to: Date }> {
  const out: Array<{ from: Date; to: Date }> = [];
  const endOfToday = swedishMidnight(now, 1);
  if (endOfToday.getTime() - now.getTime() >= minHoursToday * 3_600_000) out.push({ from: now, to: endOfToday });
  for (let k = 1; out.length < count; k++) out.push({ from: swedishMidnight(now, k), to: swedishMidnight(now, k + 1) });
  return out;
}

/** "Idag" / "Imorgon" / "Fredag 15 nov" for the day that contains `iso`, relative to `nowIso`. */
export function formatDayLabel(iso: string, nowIso: string): string {
  const key = swedishDateKey(iso);
  if (key === swedishDateKey(nowIso)) return 'Idag';
  if (key === swedishDateKey(swedishMidnight(new Date(nowIso), 1))) return 'Imorgon';
  const d = new Date(iso);
  return `${cap(weekdayLong.format(d))} ${shortDate.format(d).replace(/\.$/, '')}`;
}

/** Swedish decimal formatting: 2.6 → "2,6"; `digits` fixes the number of decimals. Null → "—". */
export function formatNumber(v: number | null | undefined, digits?: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const s = digits === undefined ? String(v) : v.toFixed(digits);
  return s.replace('.', ',').replace(/^-/, '−');
}

/** "610 m" / "1,1 km" / area label when distance is unknown. */
export function formatDistance(meters: number | null | undefined, unknownLabel = 'Område'): string {
  if (meters === null || meters === undefined) return unknownLabel;
  return meters >= 1000 ? `${formatNumber(meters / 1000, 1)} km` : `${Math.round(meters)} m`;
}
