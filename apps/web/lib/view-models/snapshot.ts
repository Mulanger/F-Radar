import type { MetricKey, PropertySnapshot } from '@fastighetsradar/domain';
import { isDisplayableValue } from '@fastighetsradar/domain';

/**
 * Accessors that read typed measurements. A value is returned only when it is
 * displayable (status ok/stale with a value). Anything else yields `null`, which the
 * UI renders as "—" – missing data is never shown as 0 or "normal".
 */
export function metricValue(s: PropertySnapshot, key: MetricKey): number | null {
  const m = s.metrics.find((x) => x.metricKey === key);
  return isDisplayableValue(m) && typeof m.value === 'number' ? m.value : null;
}

/** Number or em dash for display. */
export function show(v: number | null | undefined, digits?: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return digits === undefined ? String(v) : v.toFixed(digits);
}

export const n0 = (v: number | null) => v ?? 0;

export function forecastValues(s: PropertySnapshot, key: MetricKey): number[] {
  const series = s.forecast?.availability === 'ok' ? s.forecast.series.find((x) => x.metricKey === key) : undefined;
  return series ? series.points.map((p) => p.value).filter((v): v is number => v !== null) : [];
}

export const isOfficialLevel = (level: string) => level !== 'Info';

export function riskSeverity(v: number): 'critical' | 'warning' | 'monitor' | 'normal' {
  return v >= 70 ? 'critical' : v >= 50 ? 'warning' : v >= 30 ? 'monitor' : 'normal';
}
