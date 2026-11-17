import { describe, expect, it } from 'vitest';
import type { Portfolio } from '@fastighetsradar/domain';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import { buildUpcomingEvents, upcomingView } from '../lib/view-models/upcoming';

const ids = (p: Portfolio) => new Set(p.properties.map((s) => s.property.id));

describe('upcoming conditions view model', () => {
  const events = buildUpcomingEvents(demoPortfolio, ids(demoPortfolio));

  it('derives category, short value + unit and guidance per row kind', () => {
    const byId = (prefix: string) => events.find((e) => e.id.startsWith(prefix))!;
    expect(byId('frost-')).toMatchObject({ cat: 'temp', value: '-3°', unit: 'lägsta temp', tmin: -3, hot: false, tag: 'prognos' });
    expect(byId('intense-rain-')).toMatchObject({ cat: 'rain', value: '9 mm', unit: 'på en timme', hot: true });
    expect(byId('freeze-thaw-')).toMatchObject({ title: 'Växlande plus- och minusgrader', hint: 'Kan ge is och istappar på tak' });
    const wind = events.find((e) => e.official && e.cat === 'wind')!;
    expect(wind).toMatchObject({ value: 'Orange', unit: 'varning', tag: 'officiell varning', hint: null });
    expect(events.every((e) => e.action.length > 0 && e.ackKey.includes('@'))).toBe(true);
  });

  it('only keeps rows for the properties in view (property group filter)', () => {
    const one = demoPortfolio.properties.find((s) => s.property.name === 'Ulvsunda Lager')!.property.id;
    expect(buildUpcomingEvents(demoPortfolio, new Set([one])).map((e) => e.name)).toEqual(['Ulvsunda Lager', 'Ulvsunda Lager']);
  });

  it('groups per day, summarises and counts acknowledgements', () => {
    const v = upcomingView(events, {}, 'all', demoPortfolio.generatedAt);
    expect(v.days.map((d) => d.label)).toEqual(['Idag', 'Imorgon']);
    expect(v.sum).toMatchObject({ risk: 2, tmin: '−3°', ack: 0, total: events.length });
    expect(v.chips[0]).toMatchObject({ k: 'all', active: true, count: events.length });

    const first = v.days[0]!.items[0]!;
    const acked = upcomingView(events, { [first.ackKey]: '2025-11-12T13:40:00Z' }, 'all', demoPortfolio.generatedAt);
    expect(acked.sum.ack).toBe(1);
    // Acknowledged cards move to the end of their day.
    expect(acked.days[0]!.items.at(-1)!.id).toBe(first.id);

    const temp = upcomingView(events, {}, 'temp', demoPortfolio.generatedAt);
    expect(temp.days.flatMap((d) => d.items).every((e) => e.cat === 'temp')).toBe(true);
    expect(upcomingView([], {}, 'all', demoPortfolio.generatedAt)).toMatchObject({ empty: true, sum: { risk: 0, tmin: '—', total: 0 } });
  });
});
