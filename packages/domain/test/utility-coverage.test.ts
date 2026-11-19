import { describe, expect, it } from 'vitest';
import { buildUtilityCoverageReport, utilityCoverageLogEntries, UtilityCoverageReportSchema, type PropertyUtilityStatus } from '../src';

const status = (coverage: PropertyUtilityStatus['coverage'], name = 'Testnät'): PropertyUtilityStatus => ({
  utility: 'electricity', coverage, operator: { id: name, name, mapUrl: null }, updatedAt: null,
  current: [], upcoming: [], recentlyRestored: [], nearby: [],
});
describe('utility coverage reports', () => {
  it('partitions every property exactly once; approximate position overlaps and manual pins are confirmed', () => {
    const r = buildUtilityCoverageReport([
      { id: 'private-property-A', geocodePrecision: 'building', positionSource: 'geocoded', statuses: [status('monitored')] },
      { id: 'private-property-B', geocodePrecision: 'approximate', positionSource: 'geocoded', statuses: [status('not_monitored', 'Missing')] },
      { id: 'private-property-C', geocodePrecision: 'street', positionSource: 'geocoded', statuses: [status('stale', 'Broken')] },
      { id: 'private-property-D', geocodePrecision: 'unknown', positionSource: 'manual_pin', statuses: [] },
      { id: 'private-property-E', geocodePrecision: 'building', positionSource: 'geocoded', statuses: [status('not_monitored', 'Missing')] },
    ], 'electricity');
    expect(UtilityCoverageReportSchema.parse(r)).toMatchObject({ total: 5, monitored: 1, notMonitored: 2, unavailable: 1, unknown: 1, approximatePosition: 2 });
    expect(r.gaps).toEqual([{ operatorId: 'Missing', operatorName: 'Missing', reason: 'not_monitored', count: 2 }, { operatorId: 'Broken', operatorName: 'Broken', reason: 'stale', count: 1 }]);
    const entries = utilityCoverageLogEntries([r]);
    expect(JSON.stringify(entries)).not.toContain('private-property');
    expect(Object.keys(entries[0]!).sort()).toEqual(['count', 'operatorId', 'operatorName', 'reason', 'utility']);
  });
  it('an empty portfolio gives zero addresses, not an invented coverage percentage', () => {
    expect(buildUtilityCoverageReport([], 'electricity')).toMatchObject({ total: 0, monitored: 0, properties: [], gaps: [] });
  });
});
