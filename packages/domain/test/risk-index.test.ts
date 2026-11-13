import { readFileSync } from 'node:fs';
import { forecastInformation } from '../src';
import { describe, expect, it } from 'vitest';
import {
  assessPropertyRisk,
  classifySmhiWarning,
  combineFactorPoints,
  portfolioRisk,
  riskLevelOf,
  RiskIndexSchema,
  type OfficialWarning,
  type PropertySnapshot,
  type SourceId,
} from '../src';
import { demoPortfolio } from '../src/fixtures/demo-portfolio';

const base = demoPortfolio.properties.find((s) => s.property.name === 'Götgården')!;
const all = () => true;

function snap(over: Partial<PropertySnapshot> = {}): PropertySnapshot {
  return {
    ...base,
    warnings: [],
    events: [],
    metrics: [],
    forecast: null,
    flood: { ...base.flood, mapped: { ...base.flood.mapped, exposureClass: 'unknown', distanceToZoneMeters: null, availability: 'ok' } },
    monitoring: null,
    ...over,
  };
}

function warning(level: OfficialWarning['level'], type: string, over: Partial<OfficialWarning> = {}): OfficialWarning {
  return {
    id: `${level}-${type}`,
    sourceId: level === 'VMA' ? 'krisinformation' : 'smhi_warnings',
    sourceLabel: level === 'VMA' ? 'Krisinformation.se (VMA)' : 'SMHI',
    externalId: null,
    level,
    type,
    summary: '',
    region: '',
    validFrom: null,
    validTo: null,
    issuedAt: null,
    sourceUrl: null,
    geo: { match: level === 'VMA' ? 'municipality' : 'polygon_intersection', note: '' },
    origin: 'live',
    ...over,
  } as OfficialWarning;
}

const inZone = (exposureClass: 'High' | 'Medium' | 'Low') => ({ ...base.flood, mapped: { ...base.flood.mapped, exposureClass, distanceToZoneMeters: 0, availability: 'ok' as const } });
const f = (r: ReturnType<typeof assessPropertyRisk>, key: string) => r.factors.find((x) => x.key === key)!;

describe('levels and combination', () => {
  it('uses the documented bands', () => {
    expect([0, 24, 25, 49, 50, 74, 75, 100].map(riskLevelOf)).toEqual(['low', 'low', 'watch', 'watch', 'elevated', 'elevated', 'high', 'high']);
  });

  it('lets many small signals add up only within the band of the largest one', () => {
    expect(combineFactorPoints([20, 20, 20, 10])).toBe(24); // never reaches "Bevaka"
    expect(combineFactorPoints([35, 20, 20, 10])).toBe(40);
    expect(combineFactorPoints([60, 95, 0])).toBe(100);
    expect(combineFactorPoints([0, 0, 0, 0, 0])).toBe(0);
  });
});

describe('SMHI warning classification', () => {
  it.each([
    ['Vind', 'weather', 'direct'],
    ['WIND', 'weather', 'direct'],
    ['Snöfall', 'weather', 'direct'],
    ['Åskoväder', 'weather', 'direct'],
    ['Regn', 'water', 'direct'],
    ['Höga flöden', 'water', 'direct'],
    ['Högt vattenstånd', 'water', 'direct'],
    ['Isbeläggning', 'weather', 'indirect'],
    ['Höga temperaturer', 'weather', 'indirect'],
    ['Brandrisk', 'weather', 'indirect'],
    ['Vind på kalfjället', 'weather', 'none'],
    ['Medelvind till havs', 'weather', 'none'],
    ['Lågt vattenstånd', 'weather', 'none'],
    ['Risk för vattenbrist', 'weather', 'none'],
    ['Något nytt', 'weather', 'indirect'],
  ])('%s → %s / %s', (type, factor, impact) => {
    expect(classifySmhiWarning(type)).toMatchObject({ factor, impact });
  });
});

describe('assessPropertyRisk', () => {
  it('is "Låg" with no warnings and valid against the schema', () => {
    const r = assessPropertyRisk(snap(), all);
    expect(RiskIndexSchema.parse(r)).toBeTruthy();
    expect(r).toMatchObject({ score: 0, level: 'low' });
    expect(r.summary).toBe('Inga aktuella varningar som bedöms påverka byggnaden.');
  });

  it('maps direct SMHI warnings to their level', () => {
    expect(assessPropertyRisk(snap({ warnings: [warning('Yellow', 'Vind')] }), all).level).toBe('watch');
    expect(assessPropertyRisk(snap({ warnings: [warning('Orange', 'Vind')] }), all).level).toBe('elevated');
    expect(assessPropertyRisk(snap({ warnings: [warning('Red', 'Snöfall')] }), all).level).toBe('high');
  });

  it('moves indirect warnings one level down and ignores irrelevant ones', () => {
    expect(assessPropertyRisk(snap({ warnings: [warning('Yellow', 'Isbeläggning')] }), all).level).toBe('low');
    expect(assessPropertyRisk(snap({ warnings: [warning('Red', 'Höga temperaturer')] }), all).level).toBe('elevated');
    const r = assessPropertyRisk(snap({ warnings: [warning('Red', 'Vind på kalfjället')] }), all);
    expect(r.score).toBe(0);
    expect(f(r, 'weather').reason).toMatch(/bedöms inte påverka byggnader/);
  });

  it('never lets static flood mapping or groundwater go above "Låg"', () => {
    const monitoring = { ...(base.monitoring ?? {}), groundwater: { areaId: '1', date: '2026-11-10', fillSmall: 99, fillLarge: 99, situationSmall: 99, situationLarge: 99, note: '', provenance: {} } } as unknown as PropertySnapshot['monitoring'];
    const r = assessPropertyRisk(snap({ flood: inZone('High'), monitoring }), all);
    expect(r.level).toBe('low');
    expect(f(r, 'water').points).toBeLessThanOrEqual(20);
    expect(f(r, 'water').reason).toMatch(/statiskt scenario/);
  });

  it('does not count a property merely near a mapped area as inside it', () => {
    const near = { ...base.flood, mapped: { ...base.flood.mapped, exposureClass: 'Low' as const, distanceToZoneMeters: 400, availability: 'ok' as const } };
    expect(f(assessPropertyRisk(snap({ flood: near }), all), 'water').points).toBe(0);
  });

  it('weighs high-flow warnings by whether the address lies in a mapped area', () => {
    const w = [warning('Orange', 'Höga flöden')];
    const outside = assessPropertyRisk(snap({ warnings: w }), all);
    const inside = assessPropertyRisk(snap({ warnings: w, flood: inZone('High') }), all);
    expect(outside.level).toBe('watch');
    expect(f(outside, 'water').reason).toMatch(/inte i karterat översvämningsområde/);
    expect(inside.level).toBe('elevated');
    expect(inside.score!).toBeGreaterThan(outside.score!);
  });

  it('treats a VMA for other municipalities in the county as "Bevaka", not crisis', () => {
    const local = assessPropertyRisk(snap({ warnings: [warning('VMA', 'Brand')] }), all);
    const county = assessPropertyRisk(snap({ warnings: [warning('VMA', 'Brand', { geo: { match: 'county', note: '' } })] }), all);
    expect(local.level).toBe('high');
    expect(county.level).toBe('watch');
    expect(f(county, 'vma').reason).toMatch(/andra kommuner i länet/);
  });

  it('keeps Krisinformation news, traffic and outdoor air at "Låg"', () => {
    const events = [
      { ...base.events[0]!, sourceId: 'krisinformation' as SourceId, category: 'Crisis' as const, severity: 'info' as const, geo: { match: 'county' as const, note: '' } },
      { ...base.events[0]!, sourceId: 'trafikverket' as SourceId, category: 'Traffic' as const, severity: 'warning' as const, title: 'Vägen avstängd', geo: { match: 'within_radius' as const, distanceMeters: 40, note: '' } },
    ];
    const metrics = [{ ...base.metrics[0]!, metricKey: 'air_quality.no2', value: 140, availability: 'ok' } as PropertySnapshot['metrics'][number]];
    const r = assessPropertyRisk(snap({ events, metrics }), all);
    expect(r.level).toBe('low');
    expect(f(r, 'vma').points).toBe(0);
    expect(f(r, 'vma').reason).toMatch(/regionala meddelanden/);
    expect(f(r, 'access').points).toBe(20);
    expect(f(r, 'air').points).toBe(10);
  });

  it('is "Ej bedömd" when warning sources are not current – never 0', () => {
    const down = (id: SourceId) => id !== 'smhi_warnings';
    const r = assessPropertyRisk(snap(), down);
    expect(r.score).toBeNull();
    expect(r.level).toBeNull();
    expect(f(r, 'weather')).toMatchObject({ assessed: false, points: null, short: 'Ej bedömd' });
    const noTraffic = assessPropertyRisk(snap(), (id) => id !== 'trafikverket');
    expect(noTraffic.score).toBe(0);
    expect(f(noTraffic, 'access').assessed).toBe(false);
    expect(noTraffic.assessedFactors).toBe(3); // air has no station either
  });

  it('checks all new weather and water presentation texts for prohibited wording', () => {
    for(const path of [
      'packages/domain/src/weather-information.ts','packages/domain/src/water-information.ts','packages/domain/src/nowcast.ts',
      'apps/web/lib/view-models/weather-information.ts','apps/web/lib/view-models/nowcast.ts','apps/web/lib/view-models/detail.ts',
      'apps/web/components/properties/ForecastDays.tsx','apps/web/components/properties/NowcastPanel.tsx','apps/web/components/properties/MeasuredRainPanel.tsx',
    ]) {
      const own=readFileSync(new URL('../../../'+path,import.meta.url),'utf8').replace(/Krisinformation(\.se)?/gi,'');
      expect(own,path).not.toMatch(/\bkris|fara|akut|katastrof|allvarlig|kritisk/i);
    }
  });

  it('never uses alarming words of its own', () => {
    const samples = [
      snap({ warnings: [warning('Red', 'Vind'), warning('Orange', 'Höga flöden'), warning('Yellow', 'Isbeläggning'), warning('VMA', 'X', { geo: { match: 'county', note: '' } })], flood: inZone('High') }),
      snap(),
      ...demoPortfolio.properties,
    ];
    const conditions = forecastInformation(Array.from({ length: 48 }, (_, i) => ({ time: new Date(Date.UTC(2026, 10, 13, i+1)).toISOString(), intervalStart: new Date(Date.UTC(2026, 10, 13, i)).toISOString(), precipitationMean: 16, frozenPartPercent: 100, thunderProbability: 40, airTemperature: i % 2 ? -1 : 1 })), new Date('2026-11-13T00:00:00Z'));
    expect(conditions.flatMap(x => [x.label, x.value, x.explanation]).join(' ')).not.toMatch(/\bkris|fara|akut|katastrof|allvarlig|kritisk/i);
    for (const s of samples) {
      const r = assessPropertyRisk(s, all);
      const own = [r.summary, ...r.factors.flatMap((x) => [x.short, x.reason])].join(' ')
        // Source names and quoted warning types are allowed.
        .replace(/Krisinformation(\.se)?/g, '')
        .replace(/Viktigt meddelande till allmänheten[^.]*/g, '');
      expect(own).not.toMatch(/\bkris|fara|akut|katastrof|allvarlig|kritisk/i);
    }
  });
});

describe('portfolioRisk', () => {
  it('averages assessed properties and names the highest', () => {
    const p = portfolioRisk(demoPortfolio.properties.map((s) => ({ name: s.property.name, risk: s.riskIndex })));
    expect(p.assessed).toBe(demoPortfolio.properties.length);
    expect(p.highest?.name).toBe('Ulvsunda Lager');
    expect(p.level).toBe(riskLevelOf(p.score!));
    expect(portfolioRisk([{ name: 'x', risk: null }])).toEqual({ score: null, level: null, highest: null, assessed: 0 });
  });
});
