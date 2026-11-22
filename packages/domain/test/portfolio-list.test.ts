import { describe, expect, it } from 'vitest';
import { LIST_METRIC_KEYS, PortfolioSchema, listPortfolio, listSnapshot, type PropertySnapshot } from '../src';
import { demoPortfolio } from '../src/fixtures';

describe('portfolio list (skalning Fas 3 / S-10)', () => {
  it('empties only the detail parts and keeps a valid portfolio', () => {
    const list = PortfolioSchema.parse(listPortfolio(demoPortfolio));
    list.properties.forEach((s, i) => {
      const full = demoPortfolio.properties[i]!;
      expect(s.property).toEqual(full.property);
      expect(s.warnings).toEqual(full.warnings);
      expect(s.events).toEqual(full.events);
      expect(s.nowcast).toEqual(full.nowcast);
      expect(s.riskIndex).toEqual(full.riskIndex);
      expect(s.alertRules).toEqual(full.alertRules);
      expect(s.forecast?.series).toEqual([]);
      expect(s.forecast?.days ?? []).toEqual([]);
      expect(s.forecast?.availability).toBe(full.forecast?.availability);
      expect(s.measuredRain ?? null).toBeNull();
      expect(s.metrics.map((m) => m.metricKey)).toEqual(full.metrics.filter((m) => LIST_METRIC_KEYS.includes(m.metricKey)).map((m) => m.metricKey));
    });
    expect(list.feed).toEqual(demoPortfolio.feed);
    expect(list.upcoming).toEqual(demoPortfolio.upcoming);
  });

  it('keeps the air quality index but not the nearby history of a live snapshot', () => {
    const live = {
      ...demoPortfolio.properties[0]!,
      monitoring: {
        county: { code: '01', name: 'Stockholms län' }, groundwater: null, flood: null, statistics: null, statusMethod: 'highest_official_warning',
        observations: [{} as never], airQuality: [{} as never], coverage: [{ sourceId: 'smhi_warnings', status: 'ok', note: null }],
        airIndex: { stationId: 's', stationName: 'Hornsgatan', distanceMeters: 900, observedAt: '2026-11-22T10:00:00Z', classification: 'good', band: 1, label: 'Bra', pollutants: [], missingPollutants: [], method: 'eea_hourly_2024_v1' },
      },
    } as PropertySnapshot;
    const s = listSnapshot(live);
    expect(s.monitoring).toMatchObject({ observations: [], airQuality: [], coverage: [], airIndex: { label: 'Bra' }, county: { name: 'Stockholms län' } });
    expect(live.monitoring!.observations).toHaveLength(1); // the input is not mutated
  });

  it('is much smaller per property', () => {
    const full = JSON.stringify(demoPortfolio.properties).length;
    const list = JSON.stringify(listPortfolio(demoPortfolio).properties).length;
    expect(list).toBeLessThan(full * 0.7);
  });
});
