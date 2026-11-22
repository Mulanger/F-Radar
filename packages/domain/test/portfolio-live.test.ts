import { describe, expect, it } from 'vitest';
import { UPCOMING_LIMIT, activeAlarmKeys, compareUpcoming, filterActiveAlarms, mergeUpcoming, topUpcoming, type UpcomingCondition } from '../src';
import { demoPortfolio } from '../src/fixtures';

/** Live row patches (docs/plans/skalning.md, Fas 3 / S-12): the portfolio-level parts rebuilt from patched rows. */
const cond = (id: string, propertyId: string, tone: UpcomingCondition['tone'], validAt: string, official = false): UpcomingCondition =>
  ({ id, label: id, where: propertyId, propertyId, when: validAt, value: '', tone, validAt, origin: 'live', ...(official ? { official } : {}) });

describe('upcoming conditions after a row patch', () => {
  const all = [
    cond('w1', 'a', 'warning', '2026-11-22T13:00:00Z', true),
    ...Array.from({ length: 10 }, (_, i) => cond(`f${i}`, `p${i}`, 'cold', `2026-11-22T${String(10 + i).padStart(2, '0')}:00:00Z`)),
    cond('g1', 'b', 'monitor', '2026-11-22T18:00:00Z'),
  ];
  const shown = topUpcoming(all);

  it('orders official first, then by tone, then by time', () => {
    expect(shown).toHaveLength(UPCOMING_LIMIT);
    expect(shown.map((u) => u.id).slice(0, 3)).toEqual(['w1', 'g1', 'f0']);
    expect([...shown].sort(compareUpcoming)).toEqual(shown);
  });

  it('gives exactly the shown list when the patched properties did not change', () => {
    const ids = ['p1', 'b'];
    expect(mergeUpcoming(shown, all.filter((u) => ids.includes(u.propertyId!)), ids)).toEqual(shown);
  });

  it('replaces the patched properties’ conditions and moves a new, more severe one up', () => {
    const next = mergeUpcoming(shown, [cond('g2', 'p3', 'critical', '2026-11-22T20:00:00Z')], ['p3']);
    expect(next.map((u) => u.id).slice(0, 2)).toEqual(['w1', 'g2']);
    expect(next.some((u) => u.id === 'f3')).toBe(false);
    expect(next).toHaveLength(UPCOMING_LIMIT);
  });
});

describe('active alarms after a row patch', () => {
  it('keeps the alarm rows whose warning is still active in the rows', () => {
    const s = demoPortfolio.properties.find((p) => p.warnings.some((w) => w.level !== 'Info'))!;
    const w = s.warnings.find((x) => x.level !== 'Info')!;
    expect(activeAlarmKeys(demoPortfolio.properties).has(`${s.property.id}:${w.id}`)).toBe(true);
    const item = { id: 'chg-1', publishedAt: demoPortfolio.generatedAt, title: 't', sourceLabel: 'SMHI', sourceId: 'smhi_warnings' as const, severity: 'warning' as const, propertyId: s.property.id, origin: 'live' as const };
    expect(filterActiveAlarms([{ ...item, eventId: w.id }, { ...item, id: 'chg-2', eventId: 'gone' }, { ...item, id: 'chg-3' }], demoPortfolio.properties).map((i) => i.id)).toEqual(['chg-1']);
  });
});
