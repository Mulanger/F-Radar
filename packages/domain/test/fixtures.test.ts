import { describe, expect, it } from 'vitest';
import { PortfolioSchema, formatClock, formatDistance, formatWeekdayClock, isDisplayableValue } from '../src';
import { demoPortfolio, syntheticSeries } from '../src/fixtures';

describe('demo fixtures', () => {
  it('validate against the shared Portfolio schema', () => {
    const r = PortfolioSchema.safeParse(demoPortfolio);
    expect(r.success, JSON.stringify(!r.success && r.error.issues.slice(0, 3))).toBe(true);
  });

  it('contain the 8 properties from the approved design', () => {
    expect(demoPortfolio.properties.map((p) => p.property.name)).toEqual([
      'Sjöstaden Kaj', 'Strandhuset', 'Götgården', 'Odenplan Atrium',
      'Arenastaden Hus C', 'Augustendal Brygga', 'Torsviks Torg', 'Ulvsunda Lager',
    ]);
  });

  it('are tagged as demo fixtures everywhere (never live)', () => {
    const p = demoPortfolio;
    expect(p.origin).toBe('demo_fixture');
    for (const s of p.properties) {
      expect(s.property.origin).toBe('demo_fixture');
      expect(s.property.id.startsWith('demo-')).toBe(true);
      s.metrics.forEach((m) => expect(m.origin).toBe('demo_fixture'));
      s.warnings.forEach((w) => expect(w.origin).toBe('demo_fixture'));
      s.events.forEach((e) => expect(e.origin).toBe('demo_fixture'));
      expect(s.forecast?.origin).toBe('demo_fixture');
      expect(s.flood.mapped.origin).toBe('demo_fixture');
      expect(s.demoRisk?.method).toBe('unspecified_demo_value');
    }
    p.feed.forEach((f) => expect(f.origin).toBe('demo_fixture'));
    p.upcoming.forEach((u) => expect(u.origin).toBe('demo_fixture'));
    p.sources.forEach((s) => expect(s.status).toBe('demo'));
  });

  it('give every measurement value, unit, source, timestamps, freshness, availability and geo relevance', () => {
    for (const s of demoPortfolio.properties) {
      for (const m of s.metrics) {
        expect(m.value).not.toBeNull();
        expect(m.unit).toBeTruthy();
        expect(m.sourceId).toBeTruthy();
        expect(m.sourceTimestamp).toBeTruthy();
        expect(m.fetchedAt).toBeTruthy();
        expect(m.freshness).toBeTruthy();
        expect(m.availability).toBe('ok');
        expect(m.geo.match).toBeTruthy();
      }
    }
  });

  it('feed items reference existing properties', () => {
    const ids = new Set(demoPortfolio.properties.map((s) => s.property.id));
    demoPortfolio.feed.forEach((f) => expect(ids.has(f.propertyId)).toBe(true));
  });

  it('synthetic series reproduce the prototype generator deterministically', () => {
    const a = syntheticSeries({ seed: 6, temp: 3.9, rain24: 22.1, wind: 14.2, hum: 90 });
    const b = syntheticSeries({ seed: 6, temp: 3.9, rain24: 22.1, wind: 14.2, hum: 90 });
    expect(a).toEqual(b);
    expect(a.temp).toHaveLength(24);
    // rain distribution sums (within rounding) to the 24 h total
    expect(a.rain.reduce((x, y) => x + y, 0)).toBeCloseTo(22.1, 0);
  });
});

describe('format helpers', () => {
  it('display Europe/Stockholm local time', () => {
    expect(formatClock('2025-11-12T13:32:00Z')).toBe('14:32');
    expect(formatWeekdayClock('2025-11-13T05:00:00Z')).toBe('tors 06:00');
    expect(formatWeekdayClock(null)).toBe('Tills vidare');
    // Summer time (CEST, UTC+2)
    expect(formatClock('2025-07-01T10:00:00Z')).toBe('12:00');
  });
  it('format distances', () => {
    expect(formatDistance(610)).toBe('610 m');
    expect(formatDistance(1100)).toBe('1,1 km');
    expect(formatDistance(null)).toBe('Område');
  });
});

describe('isDisplayableValue', () => {
  it('never treats missing/unavailable data as a value', () => {
    expect(isDisplayableValue({ availability: 'ok', value: 0 })).toBe(true);
    expect(isDisplayableValue({ availability: 'no_coverage', value: 0 })).toBe(false);
    expect(isDisplayableValue({ availability: 'source_unavailable', value: 5 })).toBe(false);
    expect(isDisplayableValue({ availability: 'access_required', value: null })).toBe(false);
    expect(isDisplayableValue({ availability: 'ok', value: null })).toBe(false);
    expect(isDisplayableValue(undefined)).toBe(false);
  });
});
