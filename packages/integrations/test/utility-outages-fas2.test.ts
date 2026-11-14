import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import {
  ellevioShapeToRings,
  fetchOperatorOutages,
  inSweden,
  operatorById,
  operatorIdForEiName,
  parseEiConcessionZip,
  parseEllevio,
  parseTekniskaVerken,
  parseTrimble,
  pointInRing,
  readZip,
  trimbleDistricts,
  trimbleStations,
  trimbleTileRanges,
  UTILITY_OPERATORS,
  type AdapterContext,
  type NormalizedUtilityOutage,
} from '../src';

/** Real responses captured 2026-11-14 (docs/plans/stromavbrott.md Fas 2), trimmed. */
const fxText = (name: string) => readFileSync(new URL(`./fixtures/utility-outages/${name}`, import.meta.url), 'utf8');
const fx = (name: string) => JSON.parse(fxText(name));
const NOW = new Date('2026-11-14T17:30:00Z');
const ellevio = operatorById('ellevio')!;
const tv = operatorById('tekniskaverken')!;
const jamtkraft = operatorById('trimble:jamtkraft')! as Extract<ReturnType<typeof operatorById>, { platform: 'trimble' }> & object;
const ctx = (f: (url: string, init?: RequestInit) => Promise<Response>): AdapterContext => ({
  env: loadServerEnv({}),
  fetch: vi.fn(f) as unknown as typeof fetch,
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  now: () => NOW,
});
const ring0 = (o: NormalizedUtilityOutage) => {
  const g = o.geometry as { type: string; coordinates: number[][][] | number[][][][] };
  return (g.type === 'Polygon' ? (g.coordinates as number[][][])[0] : (g.coordinates as number[][][][])[0]![0]) as [number, number][];
};

describe('Ellevio (postal areas only)', () => {
  const e = fx('ellevio-2026-11-14.json');
  const shapes = new Map(Object.entries(e.shapes.postal_code_shapes).map(([k, v]) => [Number(k), v]));
  const r = parseEllevio({ today: e.today, forecast: e.forecast, tickets: e.tickets.ticketList, shapes }, ellevio, NOW)!;
  const by = (id: number) => r.outages.find((o) => o.externalId === `ellevio:${id}`)!;

  it('maps tickets: ongoing fault, restored faults and upcoming planned work, all postal-area precision', () => {
    expect(r.skipped).toBe(0);
    expect(r.outages).toHaveLength(5);
    expect(r.outages.every((o) => o.precision === 'postal_area')).toBe(true);
    expect(by(581064)).toMatchObject({ kind: 'unplanned', state: 'ongoing', affectedCustomers: 8, areaCustomerTotal: null, placeLabel: 'Värmlands län, Filipstad', cause: 'Markarbete/grävning' });
    expect(by(581064).actualStart).toBe('2026-11-14T12:33:00.000Z'); // "13.33" with a dot
    expect(by(581064).estimatedRestore).toBe('2026-11-15T11:30:00.000Z');
    expect(by(581055)).toMatchObject({ kind: 'unplanned', state: 'restored', affectedCustomers: 605 });
    expect(by(581055).restoredAt).toBe('2026-11-14T13:28:00.000Z');
    expect(by(568409)).toMatchObject({ kind: 'planned', state: 'upcoming', affectedCustomers: 46, actualStart: null });
    expect(by(568409).plannedStart).toBe('2026-11-26T08:30:00.000Z');
    expect(by(568409).plannedEnd).toBe('2026-11-26T12:30:00.000Z');
  });

  it('swaps Ellevio’s [lat, lon] postal polygons into lon/lat inside Sweden', () => {
    expect(r.outages.every((o) => ring0(o).every(inSweden))).toBe(true);
    expect(ellevioShapeToRings({ coord: { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.1, 59.3], [18.1, 59.4]]] } })).toBeNull();
  });

  it('a ticket without postal shapes or details is skipped, hidden tickets ignored', () => {
    const noShapes = parseEllevio({ today: e.today, forecast: e.forecast, tickets: e.tickets.ticketList, shapes: new Map() }, ellevio, NOW)!;
    expect(noShapes.outages).toHaveLength(0);
    expect(noShapes.skipped).toBe(5);
    const hidden = parseEllevio({ today: e.today, forecast: e.forecast, tickets: e.tickets.ticketList.map((t: { id: number }) => (t.id === 581064 ? { ...t, is_hidden: 1 } : t)), shapes }, ellevio, NOW)!;
    expect(hidden.ignored).toBe(1);
    expect(parseEllevio({ today: {}, forecast: e.forecast, tickets: [], shapes }, ellevio, NOW)).toBeNull();
  });

  it('fetch: lists, ticket details and postal shapes (cached), all on the Ellevio host', async () => {
    const calls: string[] = [];
    const c = ctx(async (url) => {
      calls.push(url);
      const t = new URL(url).searchParams.get('t');
      const body = t === 'today' ? e.today : t === 'forecast' ? e.forecast : t === 'ticket' ? e.tickets : t === 'postalCodes' ? e.shapes : null;
      return body ? new Response(JSON.stringify(body)) : new Response('', { status: 404 });
    });
    const r1 = await fetchOperatorOutages(ellevio, c);
    expect(r1.ok && r1.data.outages.length).toBe(5);
    const shapeCalls = calls.filter((u) => u.includes('t=postalCodes')).length;
    await fetchOperatorOutages(ellevio, c);
    expect(calls.filter((u) => u.includes('t=postalCodes')).length).toBe(shapeCalls); // cached
    expect(calls.every((u) => u.startsWith('https://avbrottskarta.ellevio.se/avbrottskartan/load.php?v=1.4.5&'))).toBe(true);
  });
});

describe('Tekniska verken (polygons)', () => {
  const t = fx('tekniskaverken-2026-11-14.json');
  it('reads electricity (and, since Fas 4, district heating) with published polygons', () => {
    const r = parseTekniskaVerken(t.list, t.shapes, tv, NOW)!;
    expect(r.ignored).toBe(0);
    const el = r.outages.filter((o) => o.utility === 'electricity');
    expect(el).toHaveLength(1);
    expect(el[0]).toMatchObject({ kind: 'unplanned', state: 'restored', precision: 'polygon', placeLabel: 'Rosenholm' });
    expect(r.outages.every((o) => ring0(o).every(inSweden))).toBe(true);
  });
  it('maps Scheduled/Active/Cancelled and skips outages without a shape', () => {
    const el = t.list.outages.find((o: { utility: string }) => o.utility === 'Electricity');
    const as = (patch: object) => parseTekniskaVerken({ outages: [{ ...el, ...patch }] }, t.shapes, tv, NOW)!.outages[0];
    expect(as({ status: 'Active' })).toMatchObject({ state: 'ongoing', kind: 'unplanned' });
    expect(as({ status: 'Scheduled', planned: true, plannedStartTime: '2026-11-20T07:00:00Z' })).toMatchObject({ state: 'upcoming', kind: 'planned', plannedStart: '2026-11-20T07:00:00.000Z' });
    expect(as({ status: 'Cancelled', planned: true })).toMatchObject({ state: 'withdrawn' });
    expect(as({ status: 'Weird' })).toMatchObject({ state: 'unknown' });
    expect(parseTekniskaVerken({ outages: [el] }, { outages: [] }, tv, NOW)!.skipped).toBe(1);
  });
  it('fetch: POSTs {ids} to the shapes endpoint', async () => {
    let body = '';
    const r = await fetchOperatorOutages(tv, ctx(async (url, init) => {
      if (url.includes('/outage/list/')) return new Response(JSON.stringify(t.list));
      body = String(init?.body);
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify(t.shapes));
    }));
    expect(r.ok).toBe(true);
    expect(JSON.parse(body).ids).toHaveLength(9);
  });
});

describe('Trimble NIS (district precision)', () => {
  const j = fx('trimble-jamtkraft-2026-11-14.json');
  const districts = trimbleDistricts(j.staticObjects, 'p')!;
  const stations = trimbleStations([j.tiles]);

  it('reads districts and station → outage links', () => {
    expect(districts.length).toBeGreaterThan(20);
    expect(districts.every((d) => d.ring.every(inSweden))).toBe(true);
    expect(stations.get(42601)?.length).toBeGreaterThan(5);
  });

  it('ties each outage to the smallest district holding its stations (precision area)', () => {
    const r = parseTrimble(JSON.parse(j.app), districts, stations, jamtkraft as never, NOW)!;
    expect(r.skipped).toBe(0);
    expect(r.outages).toHaveLength(3);
    const o = r.outages.find((x) => x.externalId === 'trimble:jamtkraft:42601')!;
    expect(o).toMatchObject({ kind: 'planned', state: 'upcoming', precision: 'area', affectedCustomers: 47, operatorText: 'Meddelas senare', cause: 'Planerat arbete' });
    expect(o.plannedStart).toBe('2026-11-17T09:00:00.000Z');
    expect(o.placeLabel).toContain('Järpen');
    for (const p of stations.get(42601)!) expect(districts.some((d) => pointInRing(p, d.ring))).toBe(true);
  });

  it('maps t f/p/u and reports unknown types; no stations → skipped', () => {
    const app = JSON.parse(JSON.parse(j.app));
    const one = { ...app.scopes.p.outages[0] };
    const as = (t: string) => parseTrimble({ scopes: { p: { outages: [{ ...one, t, starttime: Date.parse('2026-11-14T10:00:00Z'), estendtime: Date.parse('2026-11-14T20:00:00Z') }] } } }, districts, stations, jamtkraft as never, NOW)!;
    expect(as('f').outages[0]).toMatchObject({ kind: 'unplanned', state: 'ongoing', actualStart: '2026-11-14T10:00:00.000Z', estimatedRestore: '2026-11-14T20:00:00.000Z' });
    expect(as('p').outages[0]).toMatchObject({ kind: 'planned', state: 'ongoing' });
    expect(as('x').unknownStatusCodes).toEqual(['x']);
    expect(parseTrimble({ scopes: { p: { outages: [one] } } }, districts, new Map(), jamtkraft as never, NOW)!.skipped).toBe(1);
    expect(parseTrimble({ scopes: { h: {} } }, districts, stations, jamtkraft as never, NOW)).toBeNull();
  });

  it('tile ranges cover the districts at zoom 10', () => {
    const rows = trimbleTileRanges(districts);
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) expect(r).toMatch(/^\d+-\d+$/);
  });
});

describe('Energimarknadsinspektionen concession areas', () => {
  const zip = readFileSync(new URL('./fixtures/utility-outages/ei-concessions-sample.zip', import.meta.url));
  it('reads the shapefile from the ZIP: holder, concession id and SWEREF 99 TM rings', () => {
    expect([...readZip(zip).keys()].some((k) => k.endsWith('.shp'))).toBe(true);
    const areas = parseEiConcessionZip(zip);
    expect(areas.map((a) => a.holder).sort()).toEqual(['Göteborg Energi Nät AB', 'Kraftringen Nät AB', 'Partille Energi Nät AB']);
    for (const a of areas) {
      expect(a.concessionId).toBeTruthy();
      expect(a.rings[0]![0]![0]).toBeGreaterThan(180_000);
      expect(a.rings[0]![0]![1]).toBeGreaterThan(6_100_000);
    }
  });
  it('maps holders to our operators; unknown holders become ei:<name>', () => {
    expect(operatorIdForEiName('Göteborg Energi Nät AB')).toBe('goteborg_energi');
    expect(operatorIdForEiName('Vattenfall Eldistribution AB')).toBe('vattenfall');
    expect(operatorIdForEiName('Kraftringen Nät AB')).toBe('ei:Kraftringen Nät AB');
    expect(UTILITY_OPERATORS.filter((o) => o.utilities.includes('electricity')).every((o) => o.eiNames.length > 0)).toBe(true);
  });
  it('rejects a non-ZIP', () => {
    expect(() => parseEiConcessionZip(Buffer.from('not a zip at all, definitely not'))).toThrow();
  });
});
