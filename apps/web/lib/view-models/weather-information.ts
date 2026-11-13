import type { PropertySnapshot } from '@fastighetsradar/domain';
import { formatNumber, formatWeekdayClock } from '@fastighetsradar/domain';

export function forecastDaysVM(s: PropertySnapshot) {
  const f = s.forecast;
  if (!f || f.availability !== 'ok') return [];
  const show = (v: number | null, unit: string) => v == null ? 'Ej tillgänglig' : `${formatNumber(v, 1)}${unit}`;
  return (f.days ?? []).map(d => ({
    label: `${formatWeekdayClock(d.from)}–${formatWeekdayClock(d.to)}`,
    temperature: d.temperatureMin == null || d.temperatureMax == null ? 'Ej tillgänglig' : `${show(d.temperatureMin, '°')}–${show(d.temperatureMax, '°')}`,
    rain: show(d.precipitationMean, ' mm'),
    interval: d.precipitationMin == null || d.precipitationMax == null ? 'Osäkerhetsintervall ej tillgängligt' : `Osäkerhetsintervall ${show(d.precipitationMin, '')}–${show(d.precipitationMax, ' mm')}`,
    gust: show(d.windGustMax, ' m/s'), snow: show(d.snowPercent, ' %'),
  }));
}

export function precipitationIntervalsVM(s: PropertySnapshot) {
  if (s.forecast?.availability !== 'ok') return [];
  return (s.forecast.series.find(x => x.metricKey === 'weather.precipitation_1h')?.points ?? [])
    .filter(p => p.min != null && p.max != null)
    .map(p => ({ at: formatWeekdayClock(p.validAt), text: `Osäkerhetsintervall ${formatNumber(p.min!, 1)}–${formatNumber(p.max!, 1)} mm` }));
}
