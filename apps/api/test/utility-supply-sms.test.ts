import { describe, expect, it } from 'vitest';
import { NotificationConditionSchema, type OutageNotificationCondition } from '@fastighetsradar/domain';
import { estimateSmsParts } from '@fastighetsradar/integrations';
import { inQuietHours, outageSmsPhase, supplySmsText, type OutageCandidate } from '../src/notifications/engine';
const now = new Date('2026-11-19T10:00:00Z'), activated = new Date('2026-11-19T08:00:00Z');
const rule: OutageNotificationCondition = { category: 'water_outage', utilities: ['water'], unplanned: true, planned: true, plannedReminder: true, restored: true, changes: true };
const candidate = (overrides: Partial<OutageCandidate> = {}): OutageCandidate => ({ utility: 'water', notice_kind: 'outage', kind: 'unplanned', state: 'ongoing', planned_start: null, change_type: 'new', created_at: now, last_seen_at: now, reported_at: now, first_seen_at: now, source_updated_at: now, match_method: 'outage_polygon', position_source: 'manual_pin', geocode_precision: 'unknown', ...overrides });
describe('supply SMS is exact, current, explicit and one part', () => {
  it('requires a confirmed position even for address lists and never sends information or area matches', () => {
    expect(outageSmsPhase(rule, candidate(), now, activated)).toBe('start');
    for (const m of ['outage_area', 'outage_postal_area', 'outage_point', 'outage_adjacent', 'outage_street']) expect(outageSmsPhase(rule, candidate({ match_method: m }), now, activated)).toBeNull();
    expect(outageSmsPhase(rule, candidate({ match_method: 'outage_address', position_source: 'geocoder', geocode_precision: 'street' }), now, activated)).toBeNull();
    for (const notice_kind of ['information', 'water_restriction']) expect(outageSmsPhase(rule, candidate({ notice_kind }), now, activated)).toBeNull();
  });
  it('boiling allows unknown start/type but requires current provider publication, exact position and opt-in quiet-hours exception', () => {
    const e = candidate({ notice_kind: 'boil_water', kind: 'unknown', change_type: 'updated' });
    expect(outageSmsPhase(rule, e, now, activated)).toBe('start');
    expect(outageSmsPhase(rule, { ...e, reported_at: null }, now, activated)).toBeNull();
    const night = new Date('2026-11-19T23:00:00Z');
    const q = { enabled: true, start: '22:00', end: '07:00', emergencyException: false };
    expect(inQuietHours(q, night, true)).toBe(true);
    expect(inQuietHours({ ...q, emergencyException: true }, night, true)).toBe(false);
  });
  it('never backfills old publications, restores inferred outages, or mixes utility categories', () => {
    const old = new Date('2026-11-18T10:00:00Z');
    expect(outageSmsPhase(rule, candidate({ reported_at: old }), now, activated)).toBeNull();
    expect(outageSmsPhase(rule, candidate({ first_seen_at: old }), now, activated)).toBeNull();
    expect(outageSmsPhase(rule, candidate({ change_type: 'ended', state: 'restored', restored_inferred: true }), now, activated)).toBeNull();
    expect(outageSmsPhase(rule, candidate({ change_type: 'ended', state: 'withdrawn' }), now, activated)).toBeNull();
    expect(outageSmsPhase(rule, candidate({ change_type: 'ended', state: 'restored' }), now, activated)).toBe('restored');
    expect(NotificationConditionSchema.safeParse({ ...rule, category: 'gas_outage' }).success).toBe(false);
    expect(NotificationConditionSchema.safeParse({ ...rule, category: 'water_outage', utilities: ['gas'] }).success).toBe(false);
  });
  it('keeps the link intact while shortening optional names, including non-GSM names', () => {
    const link = 'https://fastighetsradar.se/p/1234567890abcdefghijklmnop';
    for (const name of ['Långt svenskt fastighetsnamn', '東測試物業']) {
      const sms = supplySmsText(name, 'Kokningsrekommendation publicerad', 'Stockholm Vatten och Avfall', link);
      expect(estimateSmsParts(sms)).toBe(1);
      expect(sms).toContain(link);
      expect(sms).toContain('Kokningsrekommendation');
    }
  });
});
