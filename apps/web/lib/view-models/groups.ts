import type { Portfolio, PropertySnapshot } from '@fastighetsradar/domain';

/**
 * Property groups in the views (docs/plans/skalning.md, Fas 4 / S-20). A property may be in several
 * groups; 'all' is every property.
 */

export interface GroupOption {
  id: string;
  label: string;
  count: number;
}

export function inGroup(s: PropertySnapshot, group: string): boolean {
  return group === 'all' || s.property.groupIds.includes(group);
}

export function filterByGroup(p: Portfolio, group: string): PropertySnapshot[] {
  return group === 'all' ? p.properties : p.properties.filter((s) => s.property.groupIds.includes(group));
}

/** "Alla fastigheter" first, then the organization's groups by name, each with its number of properties. */
export function groupOptions(p: Portfolio): GroupOption[] {
  const counts = new Map<string, number>();
  for (const s of p.properties) for (const id of s.property.groupIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [
    { id: 'all', label: 'Alla fastigheter', count: p.properties.length },
    ...p.groups.map((g) => ({ id: g.id, label: g.label, count: counts.get(g.id) ?? 0 })),
  ];
}

/** The group's name for headings and reports ("Innerstad"), or null for every property. */
export function groupLabel(p: Portfolio, group: string): string | null {
  return group === 'all' ? null : (p.groups.find((g) => g.id === group)?.label ?? null);
}
