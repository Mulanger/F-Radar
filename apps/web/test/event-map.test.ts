import { describe, expect, it } from 'vitest';
import { EventMapItemSchema, type EventMapItem } from '@fastighetsradar/domain';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import { alongRun, distM, geometryRuns, nearestOnRuns, runLength, type LL } from '@/lib/maps/geo';
import { demoEventMap } from '@/lib/demo/event-map-demo';
import { buildDetailVM, type DetailVM } from '@/lib/view-models/detail';
import { eventMapEntries, formatStretch, untilLabel } from '@/lib/view-models/event-map';
import { SEV } from '@/lib/design/tokens';

const NOW = '2026-11-17T13:00:00.000Z'; // 14:00 Swedish time

describe('map geometry helpers', () => {
  const a: LL = [59.3, 18.0];
  const b: LL = [59.3, 18.01]; // ~568 m east

  it('measures metres and walks along a polyline', () => {
    expect(distM(a, b)).toBeGreaterThan(560);
    expect(distM(a, b)).toBeLessThan(575);
    expect(runLength([a, b, [59.309, 18.01]])).toBeCloseTo(distM(a, b) + distM(b, [59.309, 18.01]), 6);
    const mid = alongRun([a, b], 0.5);
    expect(mid[0]).toBeCloseTo(59.3, 6);
    expect(mid[1]).toBeCloseTo(18.005, 6);
  });

  it('finds the closest point on a segment, not only on vertices', () => {
    const p: LL = [59.301, 18.005];
    const n = nearestOnRuns([[a, b]], p)!;
    expect(n[0]).toBeCloseTo(59.3, 6);
    expect(n[1]).toBeCloseTo(18.005, 4);
    expect(nearestOnRuns([], p)).toBeNull();
  });

  it('turns GeoJSON [lon, lat] into Leaflet [lat, lon] runs', () => {
    expect(geometryRuns({ type: 'Point', coordinates: [18, 59] })).toEqual([[[59, 18]]]);
    expect(geometryRuns({ type: 'LineString', coordinates: [[18, 59], [18.1, 59.1]] })).toEqual([[[59, 18], [59.1, 18.1]]]);
    expect(geometryRuns({ type: 'MultiLineString', coordinates: [[[18, 59], [18.1, 59.1]], [[17, 58], [17.1, 58.1]]] })).toHaveLength(2);
  });
});

describe('event map view-model', () => {
  const ev = (o: Partial<DetailVM['events'][number]> = {}): DetailVM['events'][number] => ({
    id: 'e1', category: 'Traffic', kind: 'Trafik', title: 'Vägarbete: Götgatan', src: 'Trafikverket', dist: '120 m', time: 'Sedan 08:00',
    c: SEV.monitor.c, bg: SEV.monitor.bg, hx: SEV.monitor.hx, location: { lat: 59.3135, lon: 18.0725 }, ...o,
  });
  const item = (o: Partial<EventMapItem> = {}): EventMapItem => ({
    eventId: 'e1', geometry: { type: 'LineString', coordinates: [[18.0725, 59.3135], [18.0731, 59.3159]] }, radiusM: null, lengthM: 267,
    label: 'Vägarbete', icon: 'roadwork', hue: 'red', impact: 'Stor påverkan', where: 'Götgatan', description: 'Ett körfält avstängt.',
    validFrom: null, validTo: '2026-11-21T16:00:00.000Z', ...o,
  });

  it('joins events with their published stretch, in list order', () => {
    const [e] = eventMapEntries([ev()], [item()], 'ready', NOW);
    expect(e).toMatchObject({ shape: 'line', exact: true, label: 'Vägarbete', icon: 'roadwork', hx: SEV.critical.hx, impact: 'Stor påverkan', where: 'Götgatan', time: 'Till 21 nov', extent: 'Påverkad sträcka ≈ 270 m' });
    expect(e!.runs[0]).toHaveLength(2);
  });

  it('falls back to the closest point while the geometry loads, and says so', () => {
    expect(eventMapEntries([ev()], null, 'loading', NOW)[0]).toMatchObject({ shape: 'point', exact: false, extent: 'Hämtar exakt läge…', label: 'Trafik', hx: SEV.monitor.hx });
    expect(eventMapEntries([ev()], [], 'error', NOW)[0]).toMatchObject({ exact: false, extent: 'Närmaste punkt' });
  });

  it('leaves out events without any position (regional information)', () => {
    expect(eventMapEntries([ev({ id: 'k', category: 'Crisis', location: null })], [], 'ready', NOW)).toEqual([]);
  });

  it('areas and points get their own extent text', () => {
    const area = eventMapEntries([ev()], [item({ geometry: { type: 'Point', coordinates: [18.07, 59.31] }, radiusM: 170, lengthM: null })], 'ready', NOW)[0]!;
    expect(area).toMatchObject({ shape: 'area', extent: 'Påverkat område · radie 170 m' });
    const pt = eventMapEntries([ev()], [item({ geometry: { type: 'Point', coordinates: [18.07, 59.31] }, lengthM: null })], 'ready', NOW)[0]!;
    expect(pt).toMatchObject({ shape: 'point', extent: 'Exakt plats' });
  });

  it('formats stretch lengths and end times', () => {
    expect(formatStretch(5417)).toBe('5,4 km');
    expect(formatStretch(267)).toBe('270 m');
    expect(formatStretch(4)).toBe('10 m');
    expect(untilLabel('2026-11-17T17:00:00.000Z', NOW)).toBe('Till 18:00');
    expect(untilLabel('2026-11-21T16:00:00.000Z', NOW)).toBe('Till 21 nov');
  });
});

describe('demo event map fixture', () => {
  it('is valid map data for real demo events, and every demo event with a position is mappable', () => {
    for (const s of demoPortfolio.properties) {
      const items = demoEventMap(s.property.id);
      for (const x of items) EventMapItemSchema.parse(x);
      const ids = new Set(s.events.map((e) => e.id));
      expect(items.every((x) => ids.has(x.eventId))).toBe(true);
      const d = buildDetailVM(demoPortfolio, s, { ready: true, metric: 'temp', smsOn: true, isRuleOn: (_id: string, v: boolean) => v });
      const entries = eventMapEntries(d.events, items, 'ready', demoPortfolio.generatedAt);
      expect(entries.map((e) => e.id)).toEqual(d.events.filter((e) => e.location).map((e) => e.id));
    }
    expect(demoEventMap('demo-sjostaden-kaj').find((x) => x.eventId === 'demo-sjostaden-kaj-event-1')).toMatchObject({ label: 'Vägarbete', hue: 'red', geometry: { type: expect.stringMatching(/LineString/) } });
  });
});
