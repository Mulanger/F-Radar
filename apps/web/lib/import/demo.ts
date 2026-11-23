import { importAddressKey, type PropertyImportResult } from '@fastighetsradar/domain';
import type { SubmitBatch } from './run';

/**
 * Demo mode's stand-in for the import API: nothing is saved and no address is searched. Each address
 * gets a fixed outcome from its text – most hit a building, about one in ten only the street and a few
 * are not found – so the preview, progress and review list can be shown with any file.
 */

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const demoId = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export function createDemoImport(options: { msPerSearch?: number } = {}): SubmitBatch {
  const created = new Map<string, string>();
  let next = 1;
  return async ({ rows }, signal) => {
    const results: PropertyImportResult[] = [];
    for (const row of rows) {
      if (signal.aborted) break;
      const key = importAddressKey(row.address);
      const existing = created.get(key);
      if (existing) {
        results.push({ row: row.row, status: 'duplicate', propertyId: existing });
        continue;
      }
      if (!row.location) {
        await new Promise((r) => setTimeout(r, options.msPerSearch ?? 20));
        const h = hash(key) % 100;
        if (h < 3) {
          results.push({ row: row.row, status: 'not_found' });
          continue;
        }
        const precision = h < 13 || !/\d/.test(row.address) ? 'street' : 'building';
        const id = demoId(next++);
        created.set(key, id);
        results.push({ row: row.row, status: 'created', propertyId: id, match: { label: `${row.address}, Sverige`, precision }, needsReview: precision !== 'building' });
        continue;
      }
      const id = demoId(next++);
      created.set(key, id);
      results.push({ row: row.row, status: 'created', propertyId: id });
    }
    for (const row of rows.slice(results.length)) results.push({ row: row.row, status: 'pending' });
    return { results, remaining: 10_000 };
  };
}
