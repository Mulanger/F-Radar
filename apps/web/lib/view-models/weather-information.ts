import type { PropertySnapshot } from '@fastighetsradar/domain';
import { formatDayLabel, formatNumber, formatWeekdayClock } from '@fastighetsradar/domain';

/** One compact card per Swedish calendar day ("Idag", "Imorgon", "Fredag 15 nov"). Missing values stay explicit. */
export function forecastDaysVM(s: PropertySnapshot, nowIso: string) {
  const f = s.forecast;
  if (!f || f.availability !== 'ok') return [];
  const mm = (v: number) => formatNumber(v, v >= 10 ? 0 : 1);
  return (f.days ?? []).map(d => ({
    key: d.from,
    label: formatDayLabel(d.from, nowIso),
    temperature: d.temperatureMin == null || d.temperatureMax == null ? 'Temperatur ej tillgänglig' : `${formatNumber(Math.round(d.temperatureMin))}° / ${formatNumber(Math.round(d.temperatureMax))}°`,
    rain: d.precipitationMean == null ? 'Nederbörd ej tillgänglig' : `${mm(d.precipitationMean)} mm`,
    /** Ensemble range, shown in brackets; omitted (never invented) when unavailable. */
    interval: d.precipitationMin == null || d.precipitationMax == null || d.precipitationMean == null ? null : `${mm(d.precipitationMin)}–${mm(d.precipitationMax)} mm`,
    gust: d.windGustMax == null ? 'Byar ej tillgängliga' : `Byar ${formatNumber(Math.round(d.windGustMax))} m/s`,
    /** Only shown when part of the precipitation is expected to fall as snow. */
    snow: d.snowPercent != null && d.snowPercent > 0 ? `${Math.round(d.snowPercent)} % som snö` : null,
  }));
}

export function precipitationIntervalsVM(s: PropertySnapshot) {
  if (s.forecast?.availability !== 'ok') return [];
  return (s.forecast.series.find(x => x.metricKey === 'weather.precipitation_1h')?.points ?? [])
    .filter(p => p.min != null && p.max != null)
    .map(p => ({ at: formatWeekdayClock(p.validAt), text: `Osäkerhetsintervall ${formatNumber(p.min!, 1)}–${formatNumber(p.max!, 1)} mm` }));
}
