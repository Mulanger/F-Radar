import { describe, expect, it } from 'vitest';
import { FORECAST } from '@/lib/landing/content';
import { annotationPhase, chartModel, fmtSv, joinSv, smsPreview, stackCards } from '@/lib/landing/logic';

describe('landing formatting', () => {
  it('uses Swedish decimal commas', () => {
    expect(fmtSv(5.6, '°')).toBe('5,6°');
    expect(fmtSv(3, ' mm')).toBe('3,0 mm');
  });

  it('joins lists the Swedish way', () => {
    expect(joinSv([])).toBe('');
    expect(joinSv(['gul'])).toBe('gul');
    expect(joinSv(['gul', 'röd'])).toBe('gul och röd');
    expect(joinSv(['gul', 'orange', 'röd'])).toBe('gul, orange och röd');
  });
});

describe('chartModel', () => {
  it('summarises the temperature series', () => {
    const m = chartModel('t');
    expect(m.now).toBe('5,6°');
    expect(m.min).toBe('0,8°');
    expect(m.max).toBe('6,0°');
    expect(m.peakLabel).toBe('Topp 6,0° · 13:00');
    expect(m.color).toBe(FORECAST.t.color);
  });

  it('builds a path that spans the whole box and stays inside it', () => {
    for (const tab of ['t', 'r', 'w'] as const) {
      const m = chartModel(tab);
      expect(m.line.startsWith('M0.0,')).toBe(true);
      expect(m.line.trim().endsWith(`600.0,${m.line.trim().split(',').pop()}`)).toBe(true);
      expect(m.area.endsWith('L600,170 L0,170 Z')).toBe(true);
      const nums = [...m.line.matchAll(/(-?\d+\.\d),(-?\d+\.\d)/g)].map((x) => Number(x[2]));
      // Control points may overshoot slightly, the curve anchors must not leave the box.
      expect(Math.min(...nums)).toBeGreaterThan(-20);
      expect(Math.max(...nums)).toBeLessThan(190);
      expect(parseFloat(m.peakX)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(m.peakX)).toBeLessThanOrEqual(100);
    }
  });

  it('anchors precipitation at zero', () => {
    const m = chartModel('r');
    expect(m.max).toBe('3,1 mm');
    expect(m.peakLabel).toContain('Topp 3,1 mm');
  });
});

describe('smsPreview', () => {
  it('shows the orange wind warning when orange is selected', () => {
    const p = smsPreview({ gul: false, orange: true, rod: true });
    expect(p.body).toMatch(/^Orange varning: kraftig vind/);
    expect(p.empty).toBeNull();
    expect(p.levelsText).toBe('Du får SMS vid orange och röd varning.');
  });

  it('falls back to the yellow rain warning', () => {
    const p = smsPreview({ gul: true, orange: false, rod: false });
    expect(p.body).toMatch(/^Gul varning: kraftigt regn/);
  });

  it('stays silent when only red is selected', () => {
    const p = smsPreview({ gul: false, orange: false, rod: true });
    expect(p.body).toBeNull();
    expect(p.empty).toMatch(/under vald nivå/);
  });

  it('explains that nothing is sent without levels', () => {
    const p = smsPreview({ gul: false, orange: false, rod: false });
    expect(p.body).toBeNull();
    expect(p.levelsText).toBe('Välj minst en nivå.');
    expect(p.empty).toBe('Inga nivåer valda. Inga SMS skickas.');
  });
});

describe('annotationPhase', () => {
  it('fades each card in and out in turn', () => {
    const T = 2;
    expect(annotationPhase(0, 0, T, 6).e).toBe(0);
    expect(annotationPhase(0, 1, T, 6)).toEqual({ e: 1, active: true });
    expect(annotationPhase(0, T * 2.7 + 0.1, T, 6).e).toBe(0);
    // Card 1 starts one slot later and the cycle repeats.
    expect(annotationPhase(1, T + 1, T, 6).active).toBe(true);
    expect(annotationPhase(0, 1 + T * 6, T, 6).active).toBe(true);
  });

  it('never shows more than three cards at once', () => {
    for (let t = 0; t < 30; t += 0.25) {
      const active = Array.from({ length: 6 }, (_, i) => annotationPhase(i, t, 2, 6).active).filter(Boolean);
      expect(active.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('stackCards', () => {
  const tops = (b: Parameters<typeof stackCards>[0]) => stackCards(b).map((r) => r.top);
  const box = (left: number, top: number) => ({ left, top, w: 248, h: 100, minTop: 0, maxTop: 600 });

  it('leaves cards that do not touch alone', () => {
    expect(tops([box(0, 0), box(300, 0), box(0, 200)])).toEqual([0, 0, 200]);
  });

  it('moves a newer card next to the one it would cover', () => {
    expect(tops([box(0, 100), box(40, 140)])).toEqual([100, 210]);
    expect(tops([box(0, 150), box(40, 120)])).toEqual([150, 40]);
    expect(tops([box(0, 100), box(40, 70)])).toEqual([100, 210]); // above would leave the column
  });

  it('keeps every card inside the allowed range', () => {
    const tight = [box(0, 0), { ...box(0, 20), maxTop: 50 }];
    expect(stackCards(tight)).toEqual([{ top: 0, clear: true }, { top: 20, clear: false }]); // no room: held back, never pushed out of the column
    const t3 = tops([box(0, 250), box(10, 260), box(20, 270)]);
    for (let a = 0; a < t3.length; a++)
      for (let b = a + 1; b < t3.length; b++) expect(Math.abs(t3[a]! - t3[b]!)).toBeGreaterThanOrEqual(110);
  });
});
