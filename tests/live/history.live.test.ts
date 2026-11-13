import { describe, expect, it } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import {
  HISTORY_PARAMETERS,
  fetchHistoryCatalog,
  fetchHistorySeries,
  type AdapterContext,
} from '@fastighetsradar/integrations';

const ctx: AdapterContext = {
  env: loadServerEnv(process.env),
  fetch,
  now: () => new Date(),
  logger: { debug() {}, info() {}, warn() {}, error() {} },
};

describe('live SMHI history archives', () => {
  it('lists daily rain stations and merges corrected and recent periods without changing day definition', async () => {
    const parameter = HISTORY_PARAMETERS.find((p) => p.key === 'precipitation')!;
    const catalog = await fetchHistoryCatalog(parameter, ctx);
    expect(catalog.ok, catalog.ok ? '' : catalog.detail).toBe(true);
    if (catalog.ok) expect(catalog.data.some((s) => s.stationId === '98230')).toBe(true);
    for (const period of ['corrected-archive', 'latest-months'] as const) {
      const r = await fetchHistorySeries(parameter, '98230', period, ctx);
      expect(r.ok, r.ok ? '' : r.detail).toBe(true);
      if (r.ok) expect(r.data.days.length).toBeGreaterThan(30);
    }
    const normals = await fetchHistorySeries(parameter, '98230', 'corrected-archive', ctx, true);
    expect(normals.ok, normals.ok ? '' : normals.detail).toBe(true);
  }, 240_000);

  it.each([
    ['temperature_crossings', '98230'],
    ['temperature_min', '98230'],
    ['temperature_max', '98230'],
    ['temperature_mean', '98230'],
    ['wind_gust', '97100'],
    ['water_flow', '1583'],
    ['sea_level', '33097'],
  ])(
    'reads corrected archive for %s',
    async (key, stationId) => {
      const parameter = HISTORY_PARAMETERS.find((p) => p.key === key)!;
      const r = await fetchHistorySeries(parameter, stationId, 'corrected-archive', ctx);
      expect(r.ok, r.ok ? '' : r.detail).toBe(true);
      if (r.ok) expect(r.data.days.some((d) => d.value !== null)).toBe(true);
    },
    240_000,
  );
});
