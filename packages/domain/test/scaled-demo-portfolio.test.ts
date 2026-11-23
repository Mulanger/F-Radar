import { describe, expect, it } from 'vitest';
import { PortfolioSchema } from '../src';
import { DEMO_COUNTY_WARNING_EVENT_ID, DEMO_SCALE_MAX, demoPortfolio, demoScaleSize, scaleDemoPortfolio } from '../src/fixtures';

describe('scaleDemoPortfolio (Fas 0 test portfolio)', () => {
  const base = demoPortfolio.properties.length;

  it('returns the original portfolio for sizes up to the base size', () => {
    expect(scaleDemoPortfolio(demoPortfolio, 0)).toBe(demoPortfolio);
    expect(scaleDemoPortfolio(demoPortfolio, base)).toBe(demoPortfolio);
  });

  it('normalizes requested sizes', () => {
    expect(demoScaleSize('500', base)).toBe(500);
    expect(demoScaleSize(500, base)).toBe(500);
    expect(demoScaleSize('99999', base)).toBe(DEMO_SCALE_MAX);
    for (const bad of ['', 'abc', '-5', '1e3', '3', null, undefined, 12.5]) expect(demoScaleSize(bad, base)).toBeNull();
  });

  it('builds a valid, deterministic portfolio with unique ids and the originals first', () => {
    const p = scaleDemoPortfolio(demoPortfolio, 500);
    expect(PortfolioSchema.safeParse(p).success).toBe(true);
    expect(p.properties).toHaveLength(500);
    expect(p.properties.slice(0, base)).toEqual(demoPortfolio.properties);
    expect(new Set(p.properties.map((s) => s.property.id)).size).toBe(500);
    expect(new Set(p.feed.map((f) => f.id)).size).toBe(p.feed.length);
    expect(JSON.stringify(scaleDemoPortfolio(demoPortfolio, 500))).toBe(JSON.stringify(p));
  });

  it('rewrites nested ids so every clone references only itself', () => {
    const p = scaleDemoPortfolio(demoPortfolio, 40);
    for (const s of p.properties.slice(base)) {
      const id = s.property.id;
      for (const w of s.warnings) expect(w.id.startsWith(`${id}-`)).toBe(true);
      for (const r of s.alertRules) expect(r.propertyId).toBe(id);
      expect(s.flood.propertyId).toBe(id);
    }
  });

  it('spreads clones over Stockholm County with names, areas and segments', () => {
    const p = scaleDemoPortfolio(demoPortfolio, 500);
    const clones = p.properties.slice(base);
    for (const s of clones) {
      expect(s.property.location.lat).toBeGreaterThan(58.7);
      expect(s.property.location.lat).toBeLessThan(60.0);
      expect(s.property.location.lon).toBeGreaterThan(16.9);
      expect(s.property.location.lon).toBeLessThan(19.4);
      expect(s.property.area).toBe(s.property.municipality);
    }
    expect(new Set(clones.map((s) => s.property.area)).size).toBeGreaterThan(10);
    expect(new Set(clones.flatMap((s) => s.property.groupIds))).toEqual(new Set(['inner', 'outer']));
    expect(new Set(p.properties.map((s) => s.property.name)).size).toBe(500);
  });

  it('turns the acknowledgeable SMHI warning into one county-wide event for every property', () => {
    const p = scaleDemoPortfolio(demoPortfolio, 500);
    const county = p.feed.filter((f) => f.eventId === DEMO_COUNTY_WARNING_EVENT_ID);
    expect(county).toHaveLength(500);
    expect(new Set(county.map((f) => f.propertyId)).size).toBe(500);
    expect(county.every((f) => f.ackRequired && f.eventGroupId === DEMO_COUNTY_WARNING_EVENT_ID)).toBe(true);
    // Other rows follow their property: one per original row and clone of that property.
    const even = scaleDemoPortfolio(demoPortfolio, base * 50);
    const evenCounty = even.feed.filter((f) => f.eventId === DEMO_COUNTY_WARNING_EVENT_ID).length;
    expect(even.feed.length - evenCounty).toBe((demoPortfolio.feed.length - 1) * 50);
  });

  it('copies "Kommande" rows to clones with the clone name', () => {
    const p = scaleDemoPortfolio(demoPortfolio, 16);
    const original = demoPortfolio.upcoming[0]!;
    const copies = p.upcoming.filter((u) => u.label === original.label && u.propertyId?.startsWith(original.propertyId!));
    expect(copies).toHaveLength(2);
    const clone = p.properties.find((s) => s.property.id === copies[1]!.propertyId)!;
    expect(copies[1]!.where).toBe(clone.property.name);
  });
});
