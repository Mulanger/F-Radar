import { describe, expect, it } from 'vitest';
import { forecastInformation, type InformationStep } from '../src';
const now = new Date('2026-11-13T00:00:00Z');
const steps = (over: Partial<InformationStep> = {}) => Array.from({ length: 48 }, (_, i) => ({
  time: new Date(+now + (i+1)*3_600_000).toISOString(), intervalStart: new Date(+now+i*3_600_000).toISOString(),
  airTemperature: 5, precipitationMean: 0, frozenPartPercent: 0, thunderProbability: 0, ...over,
}));
const find = (s: InformationStep[], key: string) => forecastInformation(s, now).find(x => x.key === key);
describe('informational forecast thresholds', () => {
  it.each([[4.99, undefined], [5, 'monitor'], [14.99, 'monitor'], [15, 'warning']] as const)('hourly mean %s', (value, tone) => {
    const s = steps(); s[0]!.precipitationMean = value;
    expect(find(s, 'intense-rain')?.tone).toBe(tone);
    s[0]!.intervalStart = new Date(+now-5*3_600_000).toISOString();
    expect(find(s, 'intense-rain')).toBeUndefined(); // a six-hour total is not hourly intensity
  });
  it.each([[29.99, false], [30, true]])('thunder %s', (value, expected) => expect(!!find(steps({ thunderProbability: value }), 'thunder')).toBe(expected));
  it.each([[4.99, false], [5, true]])('snow water %s', (value, expected) => {
    const s = steps({ frozenPartPercent: 100 }); s[0]!.precipitationMean = value;
    expect(!!find(s, 'snow')).toBe(expected);
    s.splice(1, 1); expect(find(s, 'snow')).toBeUndefined();
  });
  it.each([[-2.01, 0.2, false], [-2, 0.2, true], [1, 0.2, true], [1.01, 0.2, false], [0, 0.199, false]])('ice at %s C and %s mm', (airTemperature, precipitationMean, expected) => expect(!!find(steps({ airTemperature, precipitationMean }), 'ice')).toBe(expected));
  it('finds rain after frost, but never across a gap', () => {
    const s = steps(); s[0]!.airTemperature = -3; s[1]!.precipitationMean = 0.2;
    expect(find(s,'ice')).toBeDefined(); s.splice(0,1); expect(find(s,'ice')).toBeUndefined();
  });
  it('counts crossings without counting an exact zero twice or bridging missing data', () => {
    const s = steps(); [-1,0,1,-1].forEach((v,i) => s[i]!.airTemperature=v);
    expect(find(s, 'freeze-thaw')?.value).toBe('3 gånger');
    s.forEach(x=>x.airTemperature=null); expect(find(s,'freeze-thaw')).toBeUndefined();
  });
  it('never derives conditions from missing values', () => expect(forecastInformation(steps({ airTemperature:null, precipitationMean:null, frozenPartPercent:null, thunderProbability:null }), now)).toEqual([]));

  it('finds intense rain, thunder, ice and snow during the second day', () => {
    const s = steps();
    Object.assign(s[42]!, { precipitationMean: 8, thunderProbability: 45, frozenPartPercent: 100, airTemperature: -1 });
    const conditions = forecastInformation(s, now);
    for (const key of ['intense-rain', 'thunder', 'ice']) {
      expect(conditions.find((x) => x.key === key)).toMatchObject({ at: s[42]!.intervalStart, until: s[42]!.time });
    }
    expect(conditions.find((x) => x.key === 'snow')).toMatchObject({ value: 'ca 8 cm', at: s[19]!.intervalStart, until: s[42]!.time });
  });

  it('places heavy precipitation over the wettest complete 24 hours, including prorated intervals', () => {
    const s = steps();
    const last = { ...s[47]!, time: new Date(+now + 53 * 3_600_000).toISOString(), precipitationMean: 12 };
    s[47] = last;
    for (const step of s.slice(24, 47)) step.precipitationMean = 1;
    expect(find(s, 'rain')).toMatchObject({ value: '25 mm', at: s[24]!.intervalStart, until: new Date(+now + 48 * 3_600_000).toISOString() });
    s[36]!.precipitationMean = null;
    expect(find(s, 'rain')).toBeUndefined();
  });

  it('finds the wettest complete window starting between forecast samples', () => {
    const s = steps();
    const half = 30 * 60_000;
    for (const interval of s) {
      interval.time = new Date(Date.parse(interval.time) + half).toISOString();
      interval.intervalStart = new Date(Date.parse(interval.intervalStart!) + half).toISOString();
    }
    for (const interval of s.slice(24, 48)) interval.precipitationMean = 1;
    expect(find(s, 'rain')).toMatchObject({ value: '24 mm', at: new Date(+now + 24 * 3_600_000).toISOString(), until: new Date(+now + 48 * 3_600_000).toISOString() });
  });
});
