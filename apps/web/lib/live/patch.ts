import {
  DETAIL_ONLY_SOURCES,
  FULL_RELOAD_SOURCES,
  ROWS_PATCH_MAX,
  filterActiveAlarms,
  mergeUpcoming,
  type DataSourceStatus,
  type Portfolio,
  type PortfolioNowcastPatch,
  type PortfolioRowsPatch,
  type PropertySnapshot,
  type StreamUpdate,
} from '@fastighetsradar/domain';

/**
 * Live updates by row (docs/plans/skalning.md, Fas 3 / S-12) – the pure part.
 *
 * Hints from the live stream are collected into ONE pending update per flush:
 *  - `rows`: properties whose data or events changed → `/v1/portfolio/rows?ids=…` (with the feed);
 *  - `nowcast`: properties whose radar nowcast was refreshed → `/v1/portfolio/nowcast`;
 *  - `detail`: a source only the property page shows → reload the open property only;
 *  - `full`: anything a row patch cannot rebuild → reload the whole portfolio (`router.refresh()`).
 */
export interface LivePending {
  full: boolean;
  rows: Set<string>;
  nowcast: Set<string> | 'all' | null;
  detail: boolean;
}

export const emptyPending = (): LivePending => ({ full: false, rows: new Set(), nowcast: null, detail: false });

export const hasPending = (p: LivePending) => p.full || p.rows.size > 0 || p.nowcast !== null || p.detail;

export function addUpdate(p: LivePending, u: StreamUpdate): void {
  if (u.all) {
    // A central source: every row may have changed – unless the list never shows it.
    if (u.sources.length && u.sources.every((s) => DETAIL_ONLY_SOURCES.includes(s))) p.detail = true;
    else p.full = true;
    return;
  }
  // No property named (a property was added, moved or removed) or a portfolio-level part changed.
  if (!u.propertyIds.length || u.sources.some((s) => FULL_RELOAD_SOURCES.includes(s))) {
    p.full = true;
    return;
  }
  if (u.changes === 0 && u.sources.every((s) => s === 'met_nowcast')) {
    if (p.nowcast === 'all') return;
    p.nowcast ??= new Set();
    for (const id of u.propertyIds) p.nowcast.add(id);
    if (p.nowcast.size > ROWS_PATCH_MAX) p.nowcast = 'all';
    return;
  }
  for (const id of u.propertyIds) p.rows.add(id);
  if (p.rows.size > ROWS_PATCH_MAX) p.full = true;
}

/** Puts back work that could not be done (a failed request), to be retried with the next flush. */
export function mergePending(into: LivePending, from: LivePending): void {
  into.full ||= from.full;
  into.detail ||= from.detail;
  for (const id of from.rows) into.rows.add(id);
  if (into.rows.size > ROWS_PATCH_MAX) into.full = true;
  if (from.nowcast === 'all' || into.nowcast === 'all') into.nowcast = 'all';
  else if (from.nowcast) {
    into.nowcast ??= new Set();
    for (const id of from.nowcast) into.nowcast.add(id);
  }
}

/** True when a source's status changed: every row's status/freshness may then differ (full reload). */
export function sourcesChanged(before: DataSourceStatus[], after: DataSourceStatus[]): boolean {
  const was = new Map(before.map((s) => [s.sourceId, s.status]));
  return after.length !== before.length || after.some((s) => was.get(s.sourceId) !== s.status);
}

/**
 * The portfolio with the patched rows, feed, active alarms and upcoming conditions; null when the
 * patch cannot be applied (a property was added or removed) and the portfolio must be reloaded.
 */
export function applyRowsPatch(p: Portfolio, patch: PortfolioRowsPatch, ids: Iterable<string>): Portfolio | null {
  if (patch.missing.length) return null;
  const rows = new Map(patch.properties.map((s) => [s.property.id, s]));
  const known = new Set(p.properties.map((s) => s.property.id));
  for (const id of rows.keys()) if (!known.has(id)) return null;
  const properties = p.properties.map((s) => rows.get(s.property.id) ?? s);
  return {
    ...p,
    generatedAt: patch.generatedAt,
    sources: patch.sources,
    properties,
    feed: patch.feed,
    activeAlarms: filterActiveAlarms(patch.alarmCandidates, properties),
    upcoming: mergeUpcoming(p.upcoming, patch.upcoming, ids),
  };
}

export function applyNowcastPatch(p: Portfolio, patch: PortfolioNowcastPatch): Portfolio {
  const byId = new Map(patch.nowcasts.map((n) => [n.propertyId, n.nowcast]));
  return {
    ...p,
    generatedAt: patch.generatedAt,
    sources: patch.sources,
    properties: p.properties.map((s) => (byId.has(s.property.id) ? { ...s, nowcast: byId.get(s.property.id)! } : s)),
  };
}

/** The open property's full snapshot with a refreshed nowcast (same data as its list row). */
export function nowcastForDetail(s: PropertySnapshot, patch: PortfolioNowcastPatch): PropertySnapshot | null {
  const hit = patch.nowcasts.find((n) => n.propertyId === s.property.id);
  return hit ? { ...s, nowcast: hit.nowcast } : null;
}
