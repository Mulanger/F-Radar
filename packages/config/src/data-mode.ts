/**
 * Dashboard data mode.
 *
 *  - `demo`: renders the approved design with clearly labelled fixture data
 *    (`@fastighetsradar/domain/fixtures`). Never presented as live.
 *  - `live`: reads from the FastighetsRadar API only. If the API has no data,
 *    the UI shows an explicit unavailable state — it never falls back to fixtures.
 */
export type DataMode = 'demo' | 'live';

export function resolveDataMode(value: string | undefined | null): DataMode {
  return value === 'live' ? 'live' : 'demo';
}
