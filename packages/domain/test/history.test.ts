import { describe, expect, it } from 'vitest';
import {
  HISTORY,
  HistoryQuerySchema,
  aggregateHistoryDay,
  aggregateTemperatureCrossings,
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

const propertyId = 'demo-augustendal-brygga';
const period = { from: '2025-10-01', to: '2025-10-31' };

describe('history calendar and aggregation', () => {
  it('counts observed hourly sign changes across zeros and refuses gaps', () => {
    const date = '2026-03-29';
    const from = +swedishMidnight(new Date(date + 'T12:00:00Z'));
    const points = Array.from({ length: 24 }, (_, i) => ({
      at: new Date(from + i * HISTORY.hourMs).toISOString(),
      value: i === 0 ? -1 : i === 1 ? 0 : i < 12 ? 1 : -1,
    }));
    expect(aggregateTemperatureCrossings(points, date)).toMatchObject({ value: 2, coverage: 1 });
    expect(aggregateTemperatureCrossings(points.slice(1), date).value).toBeNull();
  });
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

describe('demo history story', () => {
  const augustendal = 'demo-augustendal-brygga';
  const year = { from: '2024-11-12', to: '2025-11-11' };

  it('matches the "Nu" demo: yesterday only a yellow wind warning, closed after 18 h', () => {
    const wind = buildDemoHistory(augustendal, year).events.find((e) => e.id === 'demo-wind')!;
    expect(wind.versions.map((v) => v.level)).toEqual(['Yellow']);
    expect(wind.versions[0]!.validTo).toBe('2025-11-11T17:00:00.000Z');
    expect(Date.parse(wind.versions[0]!.validTo!) - Date.parse(wind.versions[0]!.validFrom!)).toBe(18 * 3_600_000);
  });

  it('gives an irregular sea level around the yearly mean with the October storm surge near the top', () => {
    const sea = buildDemoHistory(augustendal, year).daily.series.find((s) => s.key === 'sea_level')!;
    const values = sea.values.filter((v): v is number => v !== null);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(Math.abs(mean)).toBeLessThan(5); // 0 RW = the year's mean
    const sorted = [...values].sort((a, b) => b - a);
    const storm = sea.values[buildDemoHistory(augustendal, year).daily.dates.indexOf('2025-10-04')]!;
    expect(storm).toBeGreaterThanOrEqual(sorted[Math.floor(values.length * 0.05)]!);
    // Not a fixed-period wave: day-to-day changes vary in size and direction.
    const steps = values.slice(1).map((v, i) => v - values[i]!);
    expect(new Set(steps.map((s) => Math.sign(s))).size).toBeGreaterThan(1);
    expect(Math.max(...steps) - Math.min(...steps)).toBeGreaterThan(10);
  });
});

describe('history facts and versions', () => {
  it('keeps one event with two versions, clipping the upgrade to its actual day', () => {
    const h = buildDemoHistory(propertyId, { from: '2025-10-01', to: '2025-10-11' });
    const storm = h.events.find((e) => e.id === 'demo-autumn')!;
    expect(storm.versions).toHaveLength(2);
    expect(warningDays(['2025-10-03'], [storm]).levels.Orange).toBe(0);
    const counts = warningDays(['2025-10-04', '2025-10-05'], [storm]);
    expect(counts.count).toBe(2);
    expect(counts.levels.Orange).toBe(2);
    expect(counts.levels.Yellow).toBe(1);
  });

  it('does not count a cancelled warning that ended before its valid start', () => {
    const h = buildDemoHistory(propertyId, { from: '2025-10-01', to: '2025-10-11' });
    const event = h.events.find((e) => e.id === 'demo-autumn')!;
    event.versions = event.versions
      .slice(0, 1)
      .map((v) => ({ ...v, endType: 'cancelled', endedAt: '2025-10-03T10:00:00.000Z' }));
    expect(warningDays(['2025-10-04'], [event]).count).toBe(0);
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
