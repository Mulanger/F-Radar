/**
 * Presentation helpers shared by web and API. All timestamps are stored in UTC
 * and displayed in Europe/Stockholm (IMPLEMENTATION.md §8).
 */
export const DISPLAY_TIME_ZONE = 'Europe/Stockholm';

const hhmm = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: DISPLAY_TIME_ZONE,
});
const weekdayHhmm = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: DISPLAY_TIME_ZONE,
});
const longDate = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: DISPLAY_TIME_ZONE,
});

/** "14:32" */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  return hhmm.format(new Date(iso));
}

/** "Thu 06:00" */
export function formatWeekdayClock(iso: string | null | undefined, nullLabel = 'Until further notice'): string {
  if (!iso) return nullLabel;
  return weekdayHhmm.format(new Date(iso)).replace(',', '');
}

/** "Wednesday 12 November" */
export function formatLongDate(iso: string): string {
  return longDate.format(new Date(iso)).replace(',', '');
}

/** "610 m" / "1.1 km" / area label when distance is unknown. */
export function formatDistance(meters: number | null | undefined, unknownLabel = 'Area'): string {
  if (meters === null || meters === undefined) return unknownLabel;
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}
