import { describe, expect, it } from 'vitest';
import { formatDayLabel, swedishDayWindows, swedishMidnight } from '../src';

const iso = (d: Date) => d.toISOString();

describe('Swedish calendar days', () => {
  it('finds local midnight in winter and summer time', () => {
    expect(iso(swedishMidnight(new Date('2026-11-13T08:00:00Z')))).toBe('2026-11-12T23:00:00.000Z');
    expect(iso(swedishMidnight(new Date('2026-07-01T08:00:00Z')))).toBe('2026-06-30T22:00:00.000Z');
    // 00:30 Swedish time belongs to the new day, not yesterday.
    expect(iso(swedishMidnight(new Date('2026-11-12T23:30:00Z')))).toBe('2026-11-12T23:00:00.000Z');
  });

  it('gives 25 h and 23 h days around the DST changes', () => {
    const autumn = swedishDayWindows(new Date('2026-10-24T08:00:00Z'), 3); // DST ends Sunday 25 Oct
    expect(autumn.map((w) => [iso(w.from), iso(w.to)])).toEqual([
      ['2026-10-24T08:00:00.000Z', '2026-10-24T22:00:00.000Z'],
      ['2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z'],
      ['2026-10-25T23:00:00.000Z', '2026-10-26T23:00:00.000Z'],
    ]);
    const spring = swedishDayWindows(new Date('2026-03-28T08:00:00Z'), 2); // DST starts Sunday 29 Mar
    expect(spring[1]!.to.getTime() - spring[1]!.from.getTime()).toBe(23 * 3_600_000);
  });

  it('skips a short remainder of today and always returns the requested number of days', () => {
    const late = swedishDayWindows(new Date('2026-11-13T20:00:00Z'), 5); // 21:00 Swedish time
    expect(late).toHaveLength(5);
    expect(iso(late[0]!.from)).toBe('2026-11-13T23:00:00.000Z');
  });

  it('labels days relative to now', () => {
    const now = '2026-11-13T08:00:00Z';
    expect(formatDayLabel(now, now)).toBe('Idag');
    expect(formatDayLabel('2026-11-13T23:00:00Z', now)).toBe('Imorgon');
    expect(formatDayLabel('2026-11-14T23:00:00Z', now)).toBe('Söndag 15 nov');
  });
});
