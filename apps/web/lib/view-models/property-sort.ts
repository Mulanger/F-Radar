import type { PropertySnapshot, PropertyStatus, WarningLevel } from '@fastighetsradar/domain';
import { isOfficialLevel, riskScore } from './snapshot';

/**
 * Sorting and the area filter of the property list (docs/plans/skalning.md, Fas 4 / S-19): any
 * column, both directions, missing values last whichever the direction.
 */

export type PropertySortKey = 'risk' | 'status' | 'name' | 'area' | 'warning' | 'alerts';
export type SortDir = 'asc' | 'desc';

export const SORT_LABELS: Record<PropertySortKey, string> = {
  risk: 'Risk',
  status: 'Status',
  name: 'Namn',
  area: 'Område',
  warning: 'Varning',
  alerts: 'Larm',
};

/** The first click on a column: the most serious, or A–Ö for text. */
export const DEFAULT_DIR: Record<PropertySortKey, SortDir> = { risk: 'desc', status: 'desc', name: 'asc', area: 'asc', warning: 'desc', alerts: 'desc' };

const STATUS_RANK: Record<PropertyStatus, number | null> = { critical: 4, warning: 3, monitor: 2, normal: 1, unknown: null };
const WARNING_RANK: Partial<Record<WarningLevel, number>> = { VMA: 4, Red: 3, Orange: 2, Yellow: 1 };

/** Kommun, or the area label where the address search gave none. */
export function propertyArea(s: PropertySnapshot): string {
  return s.property.municipality || s.property.area || '';
}

function value(s: PropertySnapshot, key: PropertySortKey): number | string | null {
  switch (key) {
    case 'risk':
      return riskScore(s);
    case 'status':
      return STATUS_RANK[s.property.status] ?? null;
    case 'name':
      return s.property.name;
    case 'area':
      return propertyArea(s) || null;
    case 'warning':
      return Math.max(0, ...s.warnings.filter((w) => isOfficialLevel(w.level)).map((w) => WARNING_RANK[w.level] ?? 0));
    case 'alerts':
      return s.activeAlertCount;
  }
}

// One collator for every comparison: `localeCompare(…, 'sv-SE')` builds a new one per call, which
// made sorting 500 properties by name take a noticeable fraction of a second.
const swedish = new Intl.Collator('sv-SE');
const byName = (a: PropertySnapshot, b: PropertySnapshot) => swedish.compare(a.property.name, b.property.name);
const byRiskDesc = (a: PropertySnapshot, b: PropertySnapshot) => (riskScore(b) ?? -1) - (riskScore(a) ?? -1);

/** A sorted copy. Ties: the higher risk first, then by name – a stable, readable order. */
export function sortProperties<T extends { snapshot: PropertySnapshot }>(rows: readonly T[], key: PropertySortKey, dir: SortDir = DEFAULT_DIR[key]): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, v: value(row.snapshot, key) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) {
        if (a.v !== b.v) return a.v === null ? 1 : -1;
      } else {
        const c = typeof a.v === 'string' ? swedish.compare(a.v, b.v as string) : a.v - (b.v as number);
        if (c) return c * sign;
      }
      return (key === 'name' || key === 'risk' ? 0 : byRiskDesc(a.row.snapshot, b.row.snapshot)) || byName(a.row.snapshot, b.row.snapshot) || a.index - b.index;
    })
    .map((x) => x.row);
}

/** The areas in the list with their number of properties, A–Ö; properties without one are left out. */
export function areaOptions(rows: readonly { snapshot: PropertySnapshot }[]): Array<{ area: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const area = propertyArea(r.snapshot);
    if (area) counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return [...counts].map(([area, count]) => ({ area, count })).sort((a, b) => swedish.compare(a.area, b.area));
}
