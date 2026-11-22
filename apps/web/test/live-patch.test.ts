import { describe, expect, it } from 'vitest';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import type { FeedItem, Portfolio, PortfolioNowcastPatch, PortfolioRowsPatch, StreamUpdate } from '@fastighetsradar/domain';
import { addUpdate, applyNowcastPatch, applyRowsPatch, emptyPending, hasPending, mergePending, sourcesChanged } from '@/lib/live/patch';

/** Fas 3 / S-12 (docs/plans/skalning.md): which hint leads to which fetch, and how a patch is applied. */
const hint = (u: Partial<StreamUpdate>): StreamUpdate => ({ at: demoPortfolio.generatedAt, sources: ['smhi_forecast'], propertyIds: [], changes: 0, ...u });
const ids = demoPortfolio.properties.map((s) => s.property.id);

describe('live hints → pending work', () => {
  it('patches rows for named properties, the nowcast alone, and the property page for station data', () => {
    const p = emptyPending();
    expect(hasPending(p)).toBe(false);
    addUpdate(p, hint({ propertyIds: [ids[0]!, ids[1]!] }));
    addUpdate(p, hint({ sources: ['trafikverket'], propertyIds: [ids[1]!, ids[2]!], changes: 2 }));
    addUpdate(p, hint({ sources: ['met_nowcast'], propertyIds: [ids[3]!] }));
    addUpdate(p, hint({ sources: ['smhi_observations'], all: true }));
    expect(p).toEqual({ full: false, rows: new Set([ids[0], ids[1], ids[2]]), nowcast: new Set([ids[3]]), detail: true });
  });

  it('reloads everything for central list data, unnamed changes, outages and more than 50 properties', () => {
    const cases: StreamUpdate[] = [
      hint({ sources: ['air_quality'], all: true }),
      hint({ sources: ['smhi_observations', 'smhi_hydrology'], all: true }),
      hint({ sources: ['smhi_warnings'], propertyIds: [] }),
      hint({ sources: ['utility_outages'], propertyIds: [ids[0]!], changes: 1 }),
      hint({ propertyIds: Array.from({ length: 51 }, (_, i) => `p${i}`) }),
    ];
    for (const u of cases) {
      const p = emptyPending();
      addUpdate(p, u);
      expect(p.full, JSON.stringify(u.sources)).toBe(true);
    }
  });

  it('fetches every nowcast at once when many points were refreshed, and keeps failed work for the next try', () => {
    const p = emptyPending();
    addUpdate(p, hint({ sources: ['met_nowcast'], propertyIds: Array.from({ length: 60 }, (_, i) => `p${i}`) }));
    expect(p.nowcast).toBe('all');
    const retry = emptyPending();
    addUpdate(retry, hint({ propertyIds: ['later'] }));
    mergePending(retry, p);
    expect(retry).toMatchObject({ full: false, nowcast: 'all', rows: new Set(['later']) });
  });
});

describe('applying a patch', () => {
  const base: Portfolio = { ...demoPortfolio, activeAlarms: [] };
  const target = base.properties[1]!;
  const changedRow = { ...target, property: { ...target.property, statusReason: 'Ny status från live-uppdateringen' } };
  const warning = changedRow.warnings.find((w) => w.level !== 'Info');
  const alarm = (eventId: string): FeedItem => ({ id: `chg-${eventId}`, eventId, propertyId: target.property.id, publishedAt: base.generatedAt, sourceLabel: 'SMHI', sourceId: 'smhi_warnings', severity: 'warning', title: 'Larm', origin: 'live' });
  const patch: PortfolioRowsPatch = {
    generatedAt: '2026-11-22T12:00:00Z',
    properties: [changedRow],
    missing: [],
    feed: base.feed.slice(1),
    alarmCandidates: [...(warning ? [alarm(warning.id)] : []), alarm('ended-elsewhere')],
    upcoming: [{ id: `new-${target.property.id}`, label: 'Hårda vindbyar (prognos)', where: target.property.name, propertyId: target.property.id, when: 'mån 12:00', value: '25 m/s', tone: 'critical', origin: 'live', official: true, validAt: '2026-11-22T12:00:00Z' }],
    sources: base.sources,
  };

  it('replaces only the patched rows and rebuilds feed, active alarms and upcoming conditions', () => {
    const next = applyRowsPatch(base, patch, [target.property.id])!;
    expect(next.generatedAt).toBe(patch.generatedAt);
    expect(next.properties[1]).toBe(changedRow);
    next.properties.forEach((s, i) => { if (i !== 1) expect(s).toBe(base.properties[i]); });
    expect(next.feed).toBe(patch.feed);
    expect(next.activeAlarms!.map((a) => a.eventId)).toEqual(warning ? [warning.id] : []);
    expect(next.upcoming[0]!.id).toBe(`new-${target.property.id}`);
    expect(next.upcoming.filter((u) => u.propertyId === target.property.id)).toHaveLength(1);
    expect(next.upcoming.length).toBeLessThanOrEqual(8);
  });

  it('asks for a full reload when a property was added or removed', () => {
    expect(applyRowsPatch(base, { ...patch, missing: [target.property.id] }, [target.property.id])).toBeNull();
    const stranger = { ...changedRow, property: { ...changedRow.property, id: 'not-in-the-list' } };
    expect(applyRowsPatch(base, { ...patch, properties: [stranger] }, ['not-in-the-list'])).toBeNull();
  });

  it('patches only the nowcast of the named properties', () => {
    const nowcast: PortfolioNowcastPatch = { generatedAt: '2026-11-22T12:05:00Z', sources: base.sources, nowcasts: [{ propertyId: target.property.id, nowcast: null }] };
    const next = applyNowcastPatch(base, nowcast);
    expect(next.properties[1]).toEqual({ ...target, nowcast: null });
    expect(next.properties[0]).toBe(base.properties[0]);
    expect(next.feed).toBe(base.feed);
  });

  it('notices when a source changed status (every row may then differ)', () => {
    expect(sourcesChanged(base.sources, base.sources.map((s) => ({ ...s })))).toBe(false);
    expect(sourcesChanged(base.sources, base.sources.map((s, i) => (i === 0 ? { ...s, status: s.status === 'ok' ? 'stale' : 'ok' } : s)))).toBe(true);
  });
});
