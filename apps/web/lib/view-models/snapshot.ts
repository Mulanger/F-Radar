import type { MetricKey, Portfolio, PropertySnapshot, SourceId } from '@fastighetsradar/domain';

/**
 * Whether any of the given sources currently delivers data. Demo fixtures count as
 * available (they are labelled demo). Live data is available only when a source reports `ok`;
 * otherwise panels must say "not connected" instead of showing empty-but-normal values.
 */
export function sourceAvailable(p: Portfolio, ids: SourceId[]): boolean {
  if (p.origin === 'demo_fixture') return true;
  // Stale/degraded sources still deliver their last successful data (shown with a freshness label).
  return p.sources.some((s) => ids.includes(s.sourceId) && (s.status === 'ok' || ((s.status === 'stale' || s.status === 'degraded') && !!s.lastSuccessAt)));
}

export function availability(p: Portfolio) {
  return {
    weather: sourceAvailable(p, ['smhi_forecast', 'smhi_observations']),
    warnings: sourceAvailable(p, ['smhi_warnings', 'krisinformation']),
    events: sourceAvailable(p, ['krisinformation', 'trafikverket']),
    air: sourceAvailable(p, ['air_quality']),
    flood: sourceAvailable(p, ['mcf_flood', 'smhi_oceanography']),
    /** Alert/rule engine + SMS (Phase 8). Only the labelled demo shows rule states. */
    alerts: p.origin === 'demo_fixture',
  };
}
export type Availability = ReturnType<typeof availability>;

const FRESH_SV: Record<string, string> = { fresh: 'aktuell', stale: 'inaktuell', expired: 'utgången', unknown: 'okänd' };

/** Swedish one-line source health, e.g. "SMHI varningar: hämtad 14:32 (aktuell)". */
export function sourceLine(p: Portfolio, id: SourceId, label: string, clock: (iso: string) => string): string {
  const s = p.sources.find((x) => x.sourceId === id);
  if (!s) return `${label}: okänd`;
  if (!s.lastSuccessAt) return `${label}: ${s.note ?? 'ej ansluten'}`;
  return `${label}: hämtad ${clock(s.lastSuccessAt)} (${FRESH_SV[s.freshness] ?? s.freshness})`;
}
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
