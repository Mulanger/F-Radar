import { DISPLAY_TIME_ZONE } from './format';

/**
 * Night work: roadworks and closures that only take place at night (Trafikverket's typical
 * 21:00–04:00 closures) rarely affect a property in daytime. Shown with a moon in the dashboard.
 *
 * Night = 18:00–07:00 Stockholm time. An event is night-only when its whole validity (1–14 h) lies
 * inside one night, or when its own text says it is night work ("nattetid", "nattarbete").
 */

const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: DISPLAY_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const NIGHT_TEXT = /nattetid|nattarbete|på natten|under natten|nattvägarbete/i;
const isNightHour = (h: number) => h >= 18 || h < 7;

/** "Nattarbete 21–04" (or "Nattarbete" from the text alone), or null when it is not night-only work. */
export function nightWorkLabel(validFrom: string | Date | null | undefined, validTo: string | Date | null | undefined, text?: string | null): string | null {
  const a = validFrom ? new Date(validFrom).getTime() : NaN;
  const b = validTo ? new Date(validTo).getTime() : NaN;
  if (Number.isFinite(a) && Number.isFinite(b)) {
    const hours = (b - a) / 3_600_000;
    if (hours >= 1 && hours <= 14) {
      let night = true;
      for (let t = a; t < b && night; t += 15 * 60_000) night = isNightHour(Number(hourFmt.format(new Date(t)).slice(0, 2)));
      if (night) return `Nattarbete ${hourFmt.format(new Date(a)).slice(0, 2)}–${hourFmt.format(new Date(b)).slice(0, 2)}`;
    }
  }
  return text && NIGHT_TEXT.test(text) ? 'Nattarbete' : null;
}
