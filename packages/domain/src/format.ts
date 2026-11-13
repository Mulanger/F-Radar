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
