import { describe, expect, it } from 'vitest';
import { buildDemoHistory, demoPortfolio } from '@fastighetsradar/domain/fixtures';
import {
  contiguousHistory,
  groupHistoryEvents,
  historyCsv,
  historyWarnings,
  historyWarningBands,
  rainBars,
} from '../lib/view-models/history';

const id = demoPortfolio.properties.find((p) => p.property.id === 'demo-augustendal-brygga')!.property.id;
const period = { from: '2025-09-01', to: '2025-11-11' };

describe('history presentation', () => {
  it('groups versions inside one timeline row and filters regional information', () => {
    const h = buildDemoHistory(id, period);
    const groups = groupHistoryEvents(h.events, 'Weather');
    const wind = groups.flatMap((g) => g.events).filter((e) => e.id === 'demo-wind');
    expect(wind).toHaveLength(1);
    expect(wind[0].versions).toHaveLength(2);
    expect(groupHistoryEvents(h.events, 'CountyInfo').flatMap((g) => g.events)).toHaveLength(1);
  });

  it('aggregates mobile weeks without turning a gap into zero or a partial sum', () => {
    const h = buildDemoHistory(id, period, 'gaps');
    expect(rainBars(h, false, false)).toHaveLength(72);
    const bars = rainBars(h, false, true);
    expect(bars.length).toBeLessThan(60);
    expect(bars.some((b) => b.value === null && !b.complete)).toBe(true);
    expect(contiguousHistory([1, 2, null, 4]).map((s) => s.map((p) => p.index))).toEqual([[0, 1], [3]]);
    expect(historyWarnings(h.events, '2025-11-10', '2025-11-10').some((w) => w.level === 'Orange')).toBe(
      false,
    );
  });

  it('limits monthly warning bands to actual hours and aligns rain days at 06 UTC', () => {
    const h = buildDemoHistory(id, period);
    const wind = h.events.find((e) => e.id === 'demo-wind')!;
    const bands = historyWarningBands([wind], '2025-11-01', '2025-11-30', 'smhi_06_utc');
    expect(bands.reduce((sum, b) => sum + b.width, 0)).toBeLessThan(2 / 30);
    expect(historyWarnings([wind], '2025-11-10', '2025-11-10', 'smhi_06_utc')).toHaveLength(1);
  });

  it('exports station distances, source text, versions, definitions, licence and empty missing cells', () => {
    const h = buildDemoHistory(id, period, 'gaps');
    h.events[0].versions[0].text = '=SUM(A1)\n"Officiell text"; med semikolon';
    const csv = historyCsv(h);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('avstånd_m');
    expect(csv).toContain('SMHI-dygn kl 06–06 UTC');
    expect(csv).toContain('Stockholm-Observatoriekullen A');
    expect(csv).toContain('"\'=SUM(A1)\n""Officiell text""; med semikolon"');
    expect(csv).toContain('demo-wind');
    expect(csv).toContain('"2025-11-03";"precipitation";;;;"mm";"0"');
  });

  it('exports hourly detail as its own series with an independent station and UTC interval end', () => {
    const h = buildDemoHistory(id, { from: '2025-11-11', to: '2025-11-11' });
    expect(h.hourly!.values).toHaveLength(24);
    const csv = historyCsv(h);
    expect(csv).toContain('"timme";"2025-11-11T00:00:00.000Z"');
    expect(csv).toContain('Stockholm, kvartsmätning (demo)');
    expect(csv).toContain('Svensk tid. Datum och tid anger timmens slut; summerat kvartsregn.');
  });
});
