import { describe, expect, it } from 'vitest';
import { feedNeedsAck, outageEffectiveSeverity, outageHeadline, outageMatchLevel, UtilityKindSchema, type UtilityKind } from '../src';

describe('supply presentation and conservative notice rules', () => {
  it('names every utility without claiming the property lacks delivery', () => {
    for (const utility of ['electricity', 'district_heating', 'district_cooling', 'gas', 'water'] as UtilityKind[]) {
      for (const state of ['upcoming', 'ongoing', 'restored', 'withdrawn', 'unknown'] as const) {
        const title = outageHeadline({ utility, state, kind: 'planned', plannedStart: null, plannedEnd: null }, 'Leverantören');
        expect(title).toContain('Leverantören');
        expect(title).not.toMatch(/saknar|kris|fara|akut/i);
      }
    }
    expect(outageHeadline({ utility: 'water', kind: 'planned', state: 'upcoming', plannedStart: null, plannedEnd: null }, 'VA-bolaget')).toBe('Planerad vattenavstängning – VA-bolaget');
  });
  it('boiling recommendations are red and acknowledged within the published area even without customer counts', () => {
    const level = outageMatchLevel('outage_area', true, null, 'boil_water');
    expect(level).toBe('area');
    expect(outageEffectiveSeverity({ kind: 'unplanned', state: 'ongoing', noticeKind: 'boil_water' }, level)).toBe('critical');
    expect(feedNeedsAck({ sourceId: 'utility_outages', changeType: 'new', severity: 'critical', eventActive: true })).toBe(true);
    expect(outageMatchLevel('outage_point', true, null, 'boil_water')).toBe('low');
    expect(outageEffectiveSeverity({ kind: 'unplanned', state: 'ongoing', noticeKind: 'boil_water' }, 'low')).toBeNull();
  });
  it('generic VA notices and restrictions are information only and never require acknowledgement', () => {
    for (const noticeKind of ['information', 'water_restriction'] as const) {
      expect(outageEffectiveSeverity({ kind: 'unknown', state: 'unknown', noticeKind }, 'area')).toBe('info');
      expect(feedNeedsAck({ sourceId: 'utility_outages', changeType: 'new', severity: 'info', eventActive: true })).toBe(false);
    }
    expect(outageHeadline({ utility: 'water', kind: 'unknown', state: 'unknown', plannedStart: null, plannedEnd: null, noticeKind: 'information' }, 'VA-bolaget')).not.toContain('vattenavbrott');
  });
  it('a vanished boiling recommendation never claims the recommendation has ended', () => {
    const title = outageHeadline({ utility: 'water', kind: 'unplanned', state: 'withdrawn', plannedStart: null, plannedEnd: null, noticeKind: 'boil_water' }, 'Kommunen');
    expect(title).toContain('inget besked om att den upphört');
    expect(outageEffectiveSeverity({ kind: 'unplanned', state: 'withdrawn', noticeKind: 'boil_water' }, 'area')).toBe('info');
  });
  it('telecom cannot enter this utility pipeline while Phase 7 is explicitly excluded', () => {
    expect(UtilityKindSchema.safeParse('broadband').success).toBe(false);
    expect(UtilityKindSchema.safeParse('mobile').success).toBe(false);
  });
});
