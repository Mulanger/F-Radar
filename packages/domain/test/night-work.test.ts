import { describe, expect, it } from 'vitest';
import { nightWorkLabel } from '../src';

describe('night-only work', () => {
  it('marks a closure that lies inside one night (Stockholm time)', () => {
    // Väg 75, 2026-11-19 21:00–04:00 UTC = 22:00–05:00 in Stockholm.
    expect(nightWorkLabel('2026-11-19T21:00:00Z', '2026-11-20T04:00:00Z')).toBe('Nattarbete 22–05');
    expect(nightWorkLabel('2026-11-19T18:00:00Z', '2026-11-20T05:00:00Z')).toBe('Nattarbete 19–06');
  });

  it('does not mark daytime, all-day, open-ended or very long work', () => {
    expect(nightWorkLabel('2026-11-19T08:00:00Z', '2026-11-19T15:00:00Z')).toBeNull();
    expect(nightWorkLabel('2026-11-19T20:00:00Z', '2026-11-20T09:00:00Z')).toBeNull(); // runs into the morning
    expect(nightWorkLabel('2026-10-07T08:31:00Z', '2026-11-20T15:00:00Z')).toBeNull();
    expect(nightWorkLabel('2026-11-19T21:00:00Z', null)).toBeNull();
    expect(nightWorkLabel(null, null)).toBeNull();
  });

  it('trusts the source text when it says night work', () => {
    expect(nightWorkLabel('2026-10-07T08:00:00Z', '2026-12-20T15:00:00Z', 'Arbete pågår nattetid kl 21-05.')).toBe('Nattarbete');
    expect(nightWorkLabel(null, null, 'Underhållsarbete. Vägen avstängd för trafik.')).toBeNull();
  });
});
