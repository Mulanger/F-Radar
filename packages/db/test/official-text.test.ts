import { describe, expect, it } from 'vitest';
import { OFFICIAL_TEXT_LIMITS, SHORTENED_TEXT_MARKER, capOfficialText } from '../src';

describe('official text bounds', () => {
  it('stores realistic official texts unaltered', () => {
    const smhi = 'Vindbyar på 21–25 m/s längs kusten. Risk för nedfallna träd, lösa föremål och störd färjetrafik.';
    expect(capOfficialText(smhi, OFFICIAL_TEXT_LIMITS.description)).toBe(smhi);
    const exact = 'a'.repeat(OFFICIAL_TEXT_LIMITS.headline);
    expect(capOfficialText(exact, OFFICIAL_TEXT_LIMITS.headline)).toBe(exact);
  });

  it('bounds an abnormal payload and marks it visibly as shortened', () => {
    const capped = capOfficialText('x'.repeat(100_000), OFFICIAL_TEXT_LIMITS.description);
    expect(capped).toHaveLength(OFFICIAL_TEXT_LIMITS.description);
    expect(capped.endsWith(SHORTENED_TEXT_MARKER)).toBe(true);
  });
});
