/**
 * LIVE smoke tests against grid operators' public outage maps (network!). Not part of `npm test`:
 *   npm run test:live
 * One request per operator (Göteborg: 3). Assertions check that the feed answers, parses without
 * skipped records and only yields coordinates inside Sweden – an empty outage list is valid.
 */
import { describe, expect, it } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { fetchOperatorConcessions, fetchOperatorOutages, inSweden, UTILITY_OPERATORS, type AdapterContext } from '@fastighetsradar/integrations';

const ctx: AdapterContext = {
  env: loadServerEnv({}),
  fetch,
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  now: () => new Date(),
};

const points = (g: { type: string; coordinates: unknown }): Array<[number, number]> =>
  g.type === 'Point'
    ? [g.coordinates as [number, number]]
    : g.type === 'Polygon'
      ? (g.coordinates as Array<Array<[number, number]>>).flat()
      : (g.coordinates as Array<Array<Array<[number, number]>>>).flat(2);

describe('grid operator outage feeds (live)', () => {
  for (const op of UTILITY_OPERATORS) {
    it(`${op.id} (${op.name}) answers and parses`, async () => {
      const r = await fetchOperatorOutages(op, ctx);
      expect(r.ok, r.ok ? '' : `${r.error}: ${r.detail}`).toBe(true);
      if (!r.ok) return;
      expect(r.data.skipped).toBe(0);
      for (const o of r.data.outages) {
        expect(o.externalId.startsWith(`${op.id}:`)).toBe(true);
        expect(points(o.geometry as never).every(inSweden)).toBe(true);
        expect(['planned', 'unplanned', 'unknown']).toContain(o.kind);
      }
      // Surface unknown upstream codes so the mapping can be extended.
      expect(r.data.unknownStatusCodes ?? []).toEqual([]);
    });
  }

  it('Digpro concession areas parse where published', async () => {
    for (const op of UTILITY_OPERATORS.filter((o) => o.platform === 'digpro' && o.concessionUrl)) {
      const r = await fetchOperatorConcessions(op, ctx);
      expect(r.ok, `${op.id}: ${r.ok ? '' : r.error}`).toBe(true);
      if (r.ok) expect(r.data.length).toBeGreaterThan(0);
    }
  });
});
