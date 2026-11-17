import { describe, expect, it } from 'vitest';
import {
  outageVanished,
  PLATFORMS_REPORTING_RESTORED,
  formatOutageWindow,
  isPositionConfirmed,
  NotificationRuleInputSchema,
  outageEffectiveSeverity,
  outageFeedTitle,
  outageHeadline,
  outageMatchLevel,
  outagePrecisionLabel,
} from '../src';

describe('outage precision → severity (docs/plans/stromavbrott.md §5.3)', () => {
  it('confirmed position inside the polygon is high; unconfirmed is medium', () => {
    expect(outageMatchLevel('outage_polygon', true)).toBe('high');
    expect(outageMatchLevel('outage_polygon', false)).toBe('medium');
    expect(outageMatchLevel('outage_adjacent', true)).toBe('low');
    expect(outageMatchLevel('outage_postal_area', true)).toBe('area');
    // Area matches need at least 25 affected customers to reach the feed; unknown size stays panel-only.
    expect(outageMatchLevel('outage_postal_area', true, 25)).toBe('area');
    expect(outageMatchLevel('outage_postal_area', true, 24)).toBe('low');
    expect(outageMatchLevel('outage_area', true, null)).toBe('low');
    expect(outageMatchLevel('outage_polygon', true, 1)).toBe('high');
  });

  it('red only for an unplanned ongoing outage with high precision', () => {
    expect(outageEffectiveSeverity({ kind: 'unplanned', state: 'ongoing' }, 'high')).toBe('critical');
    expect(outageEffectiveSeverity({ kind: 'unplanned', state: 'ongoing' }, 'medium')).toBe('warning');
    // Area level (e.g. Ellevio postal areas): blue, never orange/red.
    expect(outageEffectiveSeverity({ kind: 'unplanned', state: 'ongoing' }, 'area')).toBe('monitor');
    expect(outageEffectiveSeverity({ kind: 'unplanned', state: 'restored' }, 'area')).toBe('info');
    expect(outageEffectiveSeverity({ kind: 'planned', state: 'ongoing' }, 'area')).toBeNull();
    expect(outageEffectiveSeverity({ kind: 'planned', state: 'ongoing' }, 'high')).toBe('warning');
    expect(outageEffectiveSeverity({ kind: 'planned', state: 'upcoming' }, 'high')).toBe('monitor');
    expect(outageEffectiveSeverity({ kind: 'unknown', state: 'ongoing' }, 'high')).toBe('warning');
  });

  it('near/point matches and planned area matches never create feed rows', () => {
    expect(outageEffectiveSeverity({ kind: 'unplanned', state: 'ongoing' }, 'low')).toBeNull();
    expect(outageEffectiveSeverity({ kind: 'planned', state: 'upcoming' }, 'area')).toBeNull();
    expect(outageEffectiveSeverity({ kind: 'planned', state: 'unknown' }, 'high')).toBeNull();
  });

  it('restored/withdrawn are informational (green in the feed)', () => {
    expect(outageEffectiveSeverity({ kind: 'unplanned', state: 'restored' }, 'high')).toBe('info');
    expect(outageEffectiveSeverity({ kind: 'planned', state: 'withdrawn' }, 'medium')).toBe('info');
  });

  it('position is confirmed by building geocode or a manual pin', () => {
    expect(isPositionConfirmed('building', 'geocoded')).toBe(true);
    expect(isPositionConfirmed('street', 'geocoded')).toBe(false);
    expect(isPositionConfirmed('approximate', 'manual_adjusted')).toBe(true);
    expect(isPositionConfirmed(null, 'manual_pin')).toBe(true);
  });
});

describe('Swedish wording (ADR 0003)', () => {
  const base = { utility: 'electricity' as const, plannedStart: '2026-11-30T08:00:00.000Z', plannedEnd: '2026-11-30T13:00:00.000Z' };
  it('formats outage windows in Stockholm time', () => {
    expect(formatOutageWindow(base.plannedStart, base.plannedEnd)).toBe('30/11 09:00–14:00');
    expect(formatOutageWindow('2026-11-30T21:00:00.000Z', '2026-12-01T01:00:00.000Z')).toBe('30/11 22:00–1/12 02:00');
    expect(formatOutageWindow(base.plannedStart, null)).toBe('från 30/11 09:00');
    expect(formatOutageWindow(null, null)).toBe('');
  });

  it('headlines are descriptive and never alarmist', () => {
    const op = 'Vattenfall Eldistribution';
    const all = [
      outageHeadline({ ...base, kind: 'unplanned', state: 'ongoing' }, op),
      outageHeadline({ ...base, kind: 'planned', state: 'upcoming' }, op),
      outageHeadline({ ...base, kind: 'planned', state: 'ongoing' }, op),
      outageHeadline({ ...base, kind: 'planned', state: 'restored' }, op),
      outageHeadline({ ...base, kind: 'planned', state: 'withdrawn' }, op),
      outageHeadline({ ...base, kind: 'unknown', state: 'ongoing' }, op),
    ];
    expect(all).toEqual([
      'Oplanerat strömavbrott – Vattenfall Eldistribution',
      'Planerat strömavbrott 30/11 09:00–14:00 – Vattenfall Eldistribution',
      'Planerat strömavbrott pågår – Vattenfall Eldistribution',
      'Strömmen är tillbaka enligt Vattenfall Eldistribution',
      'Planerat strömavbrott visas inte längre hos Vattenfall Eldistribution',
      'Strömavbrott registrerat – Vattenfall Eldistribution',
    ]);
    for (const h of all) expect(h).not.toMatch(/kris|fara|akut/i);
  });

  it('a vanished outage is never "tillbaka enligt" the operator (Ellevio 2026-11-17)', () => {
    const op = 'Ellevio';
    // Operator reports restoration itself: vanished = merged/removed, not over.
    expect(outageHeadline({ ...base, kind: 'unplanned', state: 'withdrawn' }, op)).toBe('Strömavbrott visas inte längre hos Ellevio – inget besked om att det är åtgärdat');
    expect(outageVanished({ kind: 'unplanned', state: 'withdrawn' })).toBe(true);
    expect(outageVanished({ kind: 'planned', state: 'withdrawn' })).toBe(false);
    expect(outageVanished({ kind: 'unplanned', state: 'restored' })).toBe(false);
    // Operator that only removes outages from its map: our inference, worded as such.
    expect(outageHeadline({ ...base, kind: 'unplanned', state: 'restored', restoredInferred: true }, 'Vattenfall Eldistribution')).toBe(
      'Strömmen är troligen tillbaka – avbrottet visas inte längre hos Vattenfall Eldistribution',
    );
    expect(outageHeadline({ ...base, kind: 'unplanned', state: 'restored', restoredInferred: true }, 'X')).not.toMatch(/enligt/);
    expect(PLATFORMS_REPORTING_RESTORED).toEqual(expect.arrayContaining(['ellevio', 'goteborg_energi', 'digpro', 'tekniskaverken']));
    expect(PLATFORMS_REPORTING_RESTORED).not.toContain('vattenfall');
    expect(PLATFORMS_REPORTING_RESTORED).not.toContain('eon');
  });

  it('feed titles carry the precision caveat for anything below high precision', () => {
    expect(outageFeedTitle('X', 'high', 'outage_polygon')).toBe('X');
    expect(outageFeedTitle('X', 'area', 'outage_postal_area')).toBe('X – i fastighetens postnummerområde');
    expect(outageFeedTitle('X', 'area', 'outage_area', 'Östersund')).toBe('X – i nätbolagets driftområde Östersund');
    expect(outageFeedTitle('X', 'medium', 'outage_polygon')).toBe('X – fastighetens position är ungefärlig');
    expect(outagePrecisionLabel('outage_adjacent', true)).toMatch(/inte bekräftat/);
  });
});

describe('power_outage notification rule', () => {
  const rule = (condition: unknown) =>
    NotificationRuleInputSchema.safeParse({
      name: 'El',
      enabled: true,
      scope: 'all_current',
      propertyIds: [],
      recipientIds: ['00000000-0000-4000-8000-000000000001'],
      condition,
      quietHours: { enabled: false, start: '22:00', end: '07:00', emergencyException: true },
    });
  const ok = { category: 'power_outage', utilities: ['electricity'], unplanned: true, planned: true, plannedReminder: true, restored: true, changes: true };
  it('accepts the default condition', () => expect(rule(ok).success).toBe(true));
  it('requires at least one outage type; electricity, district heating and cooling are selectable', () => {
    expect(rule({ ...ok, unplanned: false, planned: false, plannedReminder: false }).success).toBe(false);
    expect(rule({ ...ok, utilities: ['district_heating', 'district_cooling'] }).success).toBe(true);
    expect(rule({ ...ok, utilities: ['gas'] }).success).toBe(false);
    expect(rule({ ...ok, utilities: [] }).success).toBe(false);
    expect(rule({ ...ok, extra: 1 }).success).toBe(false);
  });
});
