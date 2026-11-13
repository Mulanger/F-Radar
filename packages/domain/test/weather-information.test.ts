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
});
