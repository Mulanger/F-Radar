import type { MetricKey, Portfolio, PropertySnapshot } from './entities';

/**
 * Portfolio LIST vs property DETAIL (docs/plans/skalning.md, Fas 3 / S-10).
 *
 * Every dashboard page loads the portfolio, but only the property page reads the forecast series,
 * measured rain, nearby observation/air-quality history and the less common metrics. Measured with
 * 500 properties in the test database, those were ~16 of 28.7 KB per property. The list keeps the
 * snapshot shape (so every list view and view model works unchanged) with those parts emptied;
 * the property page loads the full snapshot of ONE property (`/v1/properties/:id/snapshot`).
 */

/** Metrics a list view reads (overview, property list, map, mobile, KPI pills). */
export const LIST_METRIC_KEYS: readonly MetricKey[] = [
  'weather.air_temperature',
  'weather.apparent_temperature',
  'weather.precipitation_24h',
  'weather.wind_speed',
  'weather.wind_gust',
  'weather.wind_direction',
  'weather.relative_humidity',
  'air_quality.index',
  'air_quality.pm25',
  'air_quality.no2',
];
const LIST_METRICS = new Set<string>(LIST_METRIC_KEYS);

/** The snapshot as list views need it: detail-only parts emptied, shape unchanged. */
export function listSnapshot(s: PropertySnapshot): PropertySnapshot {
  const out: PropertySnapshot = {
    ...s,
    metrics: s.metrics.filter((m) => LIST_METRICS.has(m.metricKey)),
    forecast: s.forecast ? { ...s.forecast, series: [], days: [] } : s.forecast,
  };
  if (s.measuredRain !== undefined) out.measuredRain = null;
  if (s.monitoring) out.monitoring = { ...s.monitoring, observations: [], airQuality: [], coverage: [] };
  return out;
}

export function listPortfolio(p: Portfolio): Portfolio {
  return { ...p, properties: p.properties.map(listSnapshot) };
}
