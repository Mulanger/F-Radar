import { describe, expect, it } from 'vitest';
import {
  HISTORY,
  HistoryQuerySchema,
  aggregateHistoryDay,
  frostWeeks,
  historyDates,
  historyKpis,
  historyMonths,
  historyPeriod,
  precipitationNormals,
  selectHistoryStation,
  shiftMonths,
  swedishMidnight,
  warningDays,
} from '../src';
import { buildDemoHistory, demoPortfolio } from '../src/fixtures';

const propertyId = demoPortfolio.properties[0].property.id;
const period = { from: '2025-10-01', to: '2025-10-31' };

describe('history calendar and aggregation', () => {
  it.each([
    ['2026-03-29', 23],
    ['2026-10-25', 25],
  ])('aggregates all intervals across DST on %s', (date, hours) => {
    const from = +swedishMidnight(new Date(date + 'T12:00:00Z'));
    const points = Array.from({ length: hours * 4 }, (_, i) => ({
      at: new Date(from + (i + 1) * 900_000).toISOString(),
      value: 1,
    }));
    expect(aggregateHistoryDay(points, date, 15, 'sum')).toMatchObject({ value: hours * 4, coverage: 1 });
    expect(aggregateHistoryDay(points.slice(1), date, 15, 'sum').value).toBeNull();
    expect(aggregateHistoryDay([...points, points[0]], date, 15, 'sum').value).toBe(hours * 4);
  });

  it('keeps a missing value distinct from measured zero and suppresses incomplete comparisons', () => {
    const h = buildDemoHistory(propertyId, period);
    const rain = h.daily.series[0];
    const normals = [{ month: 10, value: 50, years: 24 }];
    expect(historyMonths(h.daily.dates, rain, normals)[0].normal).toBe(50);
    const missing = { ...rain, values: [...rain.values] };
    missing.values[2] = null;
    expect(historyMonths(h.daily.dates, missing, normals)[0]).toMatchObject({
      value: null,
      complete: false,
      normal: null,
    });
    expect(historyKpis(h.daily.dates, [missing], [], []).rainMm).toBeNull();
    const zero = { ...rain, values: rain.values.map(() => 0) };
    expect(historyKpis(h.daily.dates, [zero], [], []).rainMm).toBe(0);
    expect(historyMonths(h.daily.dates.slice(1), rain, normals)[0].normal).toBeNull();
  });

  it('validates actual dates and at most 24 calendar months', () => {
    expect(shiftMonths('2024-02-29', -24)).toBe('2022-02-28');
    expect(
      HistoryQuerySchema.safeParse({ range: 'custom', from: '2026-02-30', to: '2026-03-01' }).success,
    ).toBe(false);
    expect(
      HistoryQuerySchema.safeParse({ range: 'custom', from: '2024-01-01', to: '2026-01-02' }).success,
    ).toBe(false);
    expect(HistoryQuerySchema.safeParse({ range: 'custom', from: period.to, to: period.from }).success).toBe(
      false,
    );
    expect(historyDates(historyPeriod({ range: '30d' }, new Date('2025-11-13T10:00:00Z')))).toHaveLength(30);
  });
});

describe('normal and station requirements', () => {
  it('requires 24 distinct complete monthly records in 1991–2020', () => {
    const rows = Array.from({ length: 24 }, (_, i) => ({ month: `${1991 + i}-10`, value: i + 1 }));
    expect(precipitationNormals(rows)).toEqual([{ month: 10, value: 12.5, years: 24 }]);
    expect(precipitationNormals([...rows.slice(1), rows[1], { month: '2021-10', value: 100 }])).toEqual([]);
    expect(precipitationNormals(rows.map((r, i) => (i === 0 ? { ...r, value: null } : r)))).toEqual([]);
  });

  it('tries a station with valid normals within the distance limit, then the nearest suitable series', () => {
    const nearest = { distanceMeters: 1000, historyDays: 365, normalMonths: 0 };
    const reference = { distanceMeters: 2000, historyDays: 365, normalMonths: 12 };
    expect(selectHistoryStation([nearest, reference], HISTORY.rainDistanceM)).toBe(reference);
    expect(
      selectHistoryStation([nearest, { ...reference, distanceMeters: 25001 }], HISTORY.rainDistanceM),
    ).toBe(nearest);
    expect(selectHistoryStation([{ ...nearest, historyDays: 12 }], HISTORY.rainDistanceM)).toBeNull();
  });
});

describe('history facts and versions', () => {
  it('keeps one event with two versions, clipping the upgrade to its actual day', () => {
    const h = buildDemoHistory(propertyId, { from: '2025-11-01', to: '2025-11-11' });
    const wind = h.events.find((e) => e.id === 'demo-wind')!;
    expect(wind.versions).toHaveLength(2);
    expect(warningDays(['2025-11-10'], [wind]).levels.Orange).toBe(0);
    const counts = warningDays(['2025-11-11', '2025-11-12'], [wind]);
    expect(counts.count).toBe(2);
    expect(counts.levels.Orange).toBe(2);
    expect(counts.levels.Yellow).toBe(1);
  });

  it('computes KPIs from complete readings and leaves gaps visible', () => {
    const h = buildDemoHistory(propertyId, period);
    const values = h.daily.series[0].values as number[];
    expect(h.kpis.wettest!.mm).toBe(Math.max(...values));
    expect(h.kpis.wetDays).toBe(values.filter((v) => v >= 10).length);
    expect(h.kpis.normalPercent).not.toBeNull();
    const gap = buildDemoHistory(propertyId, { from: '2025-11-01', to: '2025-11-11' }, 'gaps');
    expect(gap.gaps[0]).toMatchObject({ from: '2025-11-03', to: '2025-11-05' });
    expect(gap.kpis.rainMm).toBeNull();
    expect(frostWeeks(h.daily.dates, [])[0].crossings).toBeNull();
  });

  it('generates all eight demo properties deterministically within the payload budget', () => {
    const p = { from: '2024-11-12', to: '2025-11-11' };
    for (const property of demoPortfolio.properties) {
      const h = buildDemoHistory(property.property.id, p);
      expect(h).toEqual(buildDemoHistory(property.property.id, p));
      expect(h.origin).toBe('demo_fixture');
      expect(h.daily.dates).toHaveLength(365);
      expect(Buffer.byteLength(JSON.stringify(h))).toBeLessThan(50 * 1024);
    }
  });
});
