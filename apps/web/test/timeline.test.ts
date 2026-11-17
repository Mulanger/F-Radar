import { describe, expect, it } from 'vitest';
import type { ActivityItem } from '@fastighetsradar/domain';
import { liveTimeline, timelineTime } from '../lib/view-models/timeline';

const NOW = '2026-11-17T13:00:00Z'; // 14:00 in Stockholm
const change = (over: Partial<Extract<ActivityItem, { kind: 'change' }>>): ActivityItem => ({
  kind: 'change', id: 'c1', at: '2026-11-17T12:32:00Z', sourceId: 'smhi_warnings', changeType: 'new', severity: 'monitor', level: 'Yellow', headline: 'Vind', attribution: 'Källa: SMHI', ...over,
});

describe('live property timeline', () => {
  it('labels times as today, yesterday or weekday (Swedish time)', () => {
    expect(timelineTime('2026-11-17T12:32:00Z', NOW)).toBe('13:32');
    expect(timelineTime('2026-11-16T23:30:00Z', NOW)).toBe('00:30'); // already 17 Nov in Stockholm
    expect(timelineTime('2026-11-16T08:00:00Z', NOW)).toBe('Igår 09:00');
    expect(timelineTime('2026-11-14T08:00:00Z', NOW)).toMatch(/^lör 09:00$/);
  });

  it('describes warnings, outages and SMS alerts, newest first', () => {
    const rows = liveTimeline([
      change({ id: 'c2', at: '2026-11-17T08:00:00Z', changeType: 'ended', level: 'Orange', headline: 'Höga flöden' }),
      { kind: 'sms', id: 's1', at: '2026-11-17T12:33:00Z', ruleName: 'Varningar', status: 'simulated', recipients: 2, isTest: false },
      change({}),
      change({ id: 'c3', at: '2026-11-17T07:00:00Z', sourceId: 'utility_outages', level: null, severity: 'warning', headline: 'Oplanerat strömavbrott – Ellevio', attribution: 'Ellevio' }),
      { kind: 'sms', id: 's2', at: '2026-11-17T06:00:00Z', ruleName: 'Varningar', status: 'suppressed_quiet_hours', recipients: 1, isTest: false },
    ], NOW);
    expect(rows.map((r) => r.title)).toEqual([
      'SMS-larm skickat',
      'Gul varning utfärdad — Vind',
      'Avslutad — orange varning, Höga flöden',
      'Oplanerat strömavbrott – Ellevio',
      'SMS-larm skickades inte',
    ]);
    expect(rows[0]!.detail).toBe('2 mottagare · Varningar · simulerat');
    expect(rows[1]!.detail).toBe('SMHI');
    expect(rows[3]!.detail).toBe('Nätbolag');
    expect(rows[4]!.detail).toBe('1 mottagare · Varningar · tysta timmar');
  });

  it('names a VMA and an SMHI message correctly', () => {
    const [vma, msg] = liveTimeline([
      change({ sourceId: 'krisinformation', level: 'VMA', severity: 'critical', headline: 'Brand i Västerås' }),
      change({ id: 'c9', at: '2026-11-17T12:00:00Z', level: 'Info', severity: 'info', changeType: 'updated', headline: 'Risk för höga flöden' }),
    ], NOW);
    expect(vma!.title).toBe('VMA utfärdat — Brand i Västerås');
    expect(msg!.title).toBe('Meddelande uppdaterat — Risk för höga flöden');
  });
});
