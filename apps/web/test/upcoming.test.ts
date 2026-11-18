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
    expect(events.every((e) => e.action.length > 0)).toBe(true);
    // Plain information: nothing to acknowledge any more.
    expect(events.some((e) => 'ackKey' in e)).toBe(false);
  });

  it('only keeps rows for the properties in view (property group filter)', () => {
    const one = demoPortfolio.properties.find((s) => s.property.name === 'Ulvsunda Lager')!.property.id;
    expect(buildUpcomingEvents(demoPortfolio, new Set([one])).map((e) => e.name)).toEqual(['Ulvsunda Lager', 'Ulvsunda Lager']);
  });

  it('groups per day, sums up in one sentence and places each row on the 48 h strip', () => {
    const v = upcomingView(events, demoPortfolio.generatedAt);
    expect(v.days.map((d) => d.label)).toEqual(['Idag', 'Imorgon']);
    expect(v.summary).toMatch(/^\d+ riskvarning(ar)?, frost ner till −3° och \d+ andra? händelser? de kommande 48 h$/);
    expect(v.dots).toHaveLength(events.length);
    expect(v.dots.every((d) => d.pos >= 0 && d.pos <= 1)).toBe(true);
    // Rows within a day by start time.
    for (const d of v.days) {
      const at = d.items.map((e) => e.at ?? 0);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    }
    // 14:32 reference: midnight in Stockholm is 9 h 28 min in, the next one 24 h later.
    expect(v.midnights).toHaveLength(2);
    expect(v.midnights[0]!).toBeCloseTo(9.5 / 48, 2);
    expect(upcomingView([], demoPortfolio.generatedAt)).toMatchObject({ empty: true, summary: 'Inget över tröskelvärdena de kommande 48 h.', dots: [] });
  });

  it('words the summary for a single row', () => {
    const frost = events.filter((e) => e.tmin !== null).slice(0, 1);
    expect(upcomingView(frost, demoPortfolio.generatedAt).summary).toBe('Frost ner till −3° de kommande 48 h');
    const one = events.filter((e) => e.hot).slice(0, 1);
    expect(upcomingView(one, demoPortfolio.generatedAt).summary).toBe('1 riskvarning de kommande 48 h');
  });
});
