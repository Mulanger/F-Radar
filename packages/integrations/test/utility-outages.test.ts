import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import {
  enabledOperators,
  fetchOperatorOutages,
  goteborgKmlUrl,
  inSweden,
  operatorById,
  parseConcessionKml,
  parseDigproKml,
  parseSwedishLocal,
  parseVattenfall,
  plannedEndFromText,
  ringFromFlatLatLon,
  stockholmLocalToIso,
  UTILITY_OPERATORS,
  type AdapterContext,
  type NormalizedUtilityOutage,
} from '../src';

/** Fixtures are real responses captured 2026-11-14 (docs/plans/stromavbrott.md §4). */
const fx = (name: string) => readFileSync(new URL(`./fixtures/utility-outages/${name}`, import.meta.url), 'utf8');
const NOW = new Date('2026-11-14T13:30:00Z');
const vattenfall = operatorById('vattenfall')!;
const gbg = operatorById('goteborg_energi')!;
const digproOpts = { operatorId: 'digpro:fev', utility: 'electricity' as const, mapUrl: 'https://webmap.fev.se/outagemap2/?cust=fev&app=fpp', now: NOW };

function ctx(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>): AdapterContext {
  return { env: loadServerEnv({}), fetch: vi.fn(fetchImpl) as unknown as typeof fetch, logger: { debug() {}, info() {}, warn() {}, error() {} }, now: () => NOW };
}
const coordsOf = (o: NormalizedUtilityOutage) => {
  const g = o.geometry as { type: string; coordinates: unknown };
  return g.type === 'Point' ? [g.coordinates as [number, number]] : (g.type === 'Polygon' ? (g.coordinates as [number, number][][])[0]! : (g.coordinates as [number, number][][][])[0]![0]!);
};

describe('Swedish local time parsing (Europe/Stockholm)', () => {
  it('parses colon and dot clock formats to UTC', () => {
    expect(parseSwedishLocal('2026-11-30 09:00')).toBe('2026-11-30T08:00:00.000Z');
    expect(parseSwedishLocal('2026-11-14 12.30')).toBe('2026-11-14T11:30:00.000Z');
    expect(parseSwedishLocal('2026-07-01 09:00:00')).toBe('2026-07-01T07:00:00.000Z');
  });
  it('never guesses: empty/garbage → null, spring-forward gap → null, fall-back hour → first occurrence', () => {
    expect(parseSwedishLocal('')).toBeNull();
    expect(parseSwedishLocal('30-NOV-2026')).toBeNull();
    expect(parseSwedishLocal('2026-03-29 02:30')).toBeNull();
    expect(parseSwedishLocal('2026-10-25 02:30')).toBe('2026-10-25T00:30:00.000Z');
    expect(stockholmLocalToIso(2026, 13, 1, 0, 0)).toBeNull();
  });
});

describe('geometry', () => {
  it('swaps Vattenfall lat,lon into GeoJSON lon,lat and closes the ring', () => {
    const ring = ringFromFlatLatLon([59.27, 18.5, 59.28, 18.5, 59.28, 18.51])!;
    expect(ring[0]).toEqual([18.5, 59.27]);
    expect(ring.at(-1)).toEqual(ring[0]);
  });
  it('rejects swapped or foreign coordinates instead of matching the wrong place', () => {
    expect(ringFromFlatLatLon([18.5, 59.27, 18.5, 59.28, 18.51, 59.28])).toBeNull();
    expect(inSweden([59.3, 18.0])).toBe(false);
    expect(inSweden([18.0, 59.3])).toBe(true);
  });
});

describe('Vattenfall incidents.json', () => {
  const raw = JSON.parse(fx('vattenfall-planned-2026-11-14.json'));
  const r = parseVattenfall(raw, vattenfall, NOW)!;

  it('parses published planned work with polygon, postal codes and municipality', () => {
    expect(r.skipped).toBe(0);
    expect(r.outages).toHaveLength(2);
    const ingaro = r.outages.find((o) => o.externalId === 'vattenfall:INCD-7860-A')!;
    expect(ingaro).toMatchObject({ kind: 'planned', state: 'upcoming', precision: 'polygon', affectedCustomers: 20, postalCodes: ['13464'], municipalityCode: '0120', placeLabel: 'INGARÖ' });
    expect(ingaro.plannedStart).toBe('2026-11-30T08:00:00.000Z');
    // End time comes from the operator's text "mellan 09:00 och 14:00" because completionTime is empty.
    expect(ingaro.plannedEnd).toBe('2026-11-30T13:00:00.000Z');
    expect(coordsOf(ingaro).every(inSweden)).toBe(true);
    expect(ingaro.operatorText).toContain('planerat arbete');
  });

  it('maps the map’s own status codes: 1–4 fault, 6 planned ongoing, 7 upcoming, else unknown', () => {
    const w = raw.warnings.warning[1];
    const as = (status: number) => parseVattenfall({ warnings: { lastUpdate: null, warning: [{ ...w, status }] } }, vattenfall, NOW)!;
    expect(as(2).outages[0]).toMatchObject({ kind: 'unplanned', state: 'ongoing' });
    expect(as(6).outages[0]).toMatchObject({ kind: 'planned', state: 'ongoing' });
    expect(as(7).outages[0]).toMatchObject({ kind: 'planned', state: 'upcoming' });
    const unknown = as(5);
    expect(unknown.outages[0]!.kind).toBe('unknown');
    expect(unknown.unknownStatusCodes).toEqual(['5']);
  });

  it('skips records with invalid geometry and rejects a wrong payload shape', () => {
    const w = raw.warnings.warning[0];
    const bad = parseVattenfall({ warnings: { lastUpdate: null, warning: [{ ...w, polygon: [1, 2] }, { nope: true }] } }, vattenfall, NOW)!;
    expect(bad.outages).toHaveLength(0);
    expect(bad.skipped).toBe(2);
    expect(parseVattenfall({ foo: 1 }, vattenfall, NOW)).toBeNull();
  });

  it('only reads an end time from text whose start matches the published start', () => {
    expect(plannedEndFromText('mellan 10:00 och 14:00', '2026-11-30T08:00:00.000Z')).toBeNull();
    expect(plannedEndFromText('mellan 09:00 och 08:00', '2026-11-30T08:00:00.000Z')).toBeNull();
    expect(plannedEndFromText(null, '2026-11-30T08:00:00.000Z')).toBeNull();
  });
});

describe('Digpro outagemap2 KML', () => {
  it('derives state from fields (Falu Elnät): restored, upcoming, fault', () => {
    const r = parseDigproKml(fx('digpro-fev-2026-11-14.kml'), digproOpts)!;
    expect(r.skipped).toBe(0);
    expect(r.outages).toHaveLength(10);
    const fault = r.outages.find((o) => o.externalId === 'digpro:fev:41069')!;
    expect(fault).toMatchObject({ kind: 'unplanned', state: 'restored', affectedCustomers: 286, operatorText: 'Felsökning pågår, träd på ledning', precision: 'polygon' });
    expect(fault.restoredAt).toBe('2026-11-13T07:51:00.000Z');
    const upcoming = r.outages.find((o) => o.externalId === 'digpro:fev:41060')!;
    expect(upcoming).toMatchObject({ kind: 'planned', state: 'upcoming', affectedCustomers: 187, actualStart: null });
    expect(upcoming.plannedStart).toBe('2026-11-17T12:00:00.000Z');
    expect(upcoming.plannedEnd).toBe('2026-11-17T14:00:00.000Z');
    expect(r.outages.every((o) => coordsOf(o).every(inSweden))).toBe(true);
  });

  it('does not trust styleUrl: #active_outage with a past restored time is restored (Västerbergslagen)', () => {
    const r = parseDigproKml(fx('digpro-vbe-2026-11-14.kml'), { ...digproOpts, operatorId: 'digpro:vbe' })!;
    const o = r.outages.find((x) => x.externalId === 'digpro:vbe:64594')!;
    expect(o.upstream.style).toBe('#active_outage');
    expect(o.state).toBe('restored');
    expect(o.affectedCustomers).toBeNull(); // 0 previously affected → unknown, not 0
  });

  it('never shows stale planned work as ongoing and keeps point-only outages as points (Lerum)', () => {
    const r = parseDigproKml(fx('digpro-lme-2026-11-14.kml'), { ...digproOpts, operatorId: 'digpro:lme' })!;
    const stale = r.outages.find((x) => x.externalId === 'digpro:lme:34763')!;
    expect(stale).toMatchObject({ kind: 'planned', state: 'unknown', precision: 'point' });
    expect(r.outages.filter((x) => x.state === 'upcoming')).toHaveLength(2);
  });

  it('ignores planned work without affected customers and skips placemarks without id', () => {
    const kml = fx('digpro-lme-2026-11-14.kml');
    const noImpact = kml.replace(/(<Data name="planned_no_affected_customers">\s*<value>)false/, '$1true');
    const r = parseDigproKml(noImpact, digproOpts)!;
    expect(r.ignored).toBe(1);
    const noId = kml.replace(/<Data name="outage_id">\s*<value>\d+<\/value>/, '<Data name="outage_id"><value></value>').replace(/<Data name="outage_oid">\s*<value>\d+<\/value>/, '<Data name="outage_oid"><value></value>');
    expect(parseDigproKml(noId, digproOpts)!.skipped).toBe(1);
  });

  it('reads Göteborg Energi’s proxied Digpro KML incl. cause; empty feed = no outages; non-KML = null', () => {
    const r = parseDigproKml(fx('goteborg-el-inactive-2026-11-14.kml'), { ...digproOpts, operatorId: 'goteborg_energi' })!;
    expect(r.outages).toHaveLength(3);
    expect(r.outages[0]).toMatchObject({ kind: 'unplanned', state: 'restored', precision: 'point', cause: 'Säkringsfel' });
    expect(parseDigproKml(fx('goteborg-el-active-empty-2026-11-14.kml'), digproOpts)).toEqual({ outages: [], skipped: 0, ignored: 0, sourceUpdatedAt: null });
    expect(parseDigproKml('<html>error</html>', digproOpts)).toBeNull();
  });

  it('parses concession areas', () => {
    const a = parseConcessionKml(fx('digpro-fev-concession.kml'))!;
    expect(a.length).toBeGreaterThan(0);
    expect(['Polygon', 'MultiPolygon']).toContain(a[0]!.geometry.type);
  });
});

describe('operators', () => {
  it('lists unique ids and honours UTILITY_OUTAGE_OPERATORS', () => {
    expect(new Set(UTILITY_OPERATORS.map((o) => o.id)).size).toBe(UTILITY_OPERATORS.length);
    expect(enabledOperators('')).toHaveLength(UTILITY_OPERATORS.filter((o) => !o.enableFlag).length);
    expect(enabledOperators('none')).toEqual([]);
    expect(enabledOperators('vattenfall, digpro:fev').map((o) => o.id)).toEqual(['vattenfall', 'digpro:fev']);
  });
  it('only follows Göteborg KML URLs on the company host and handler', () => {
    expect(goteborgKmlUrl('https://www.goteborgenergi.se', 'https://evil.example/GoteborgEnergi/Outages/FilteredOutagesKml.ashx?type=36857905', '36857905', 1)).toBeNull();
    expect(goteborgKmlUrl('https://www.goteborgenergi.se', 'https://www.goteborgenergi.se/other?type=36857905', '36857905', 1)).toBeNull();
    expect(goteborgKmlUrl('https://www.goteborgenergi.se', 'https://www.goteborgenergi.se/GoteborgEnergi/Outages/FilteredOutagesKml.ashx?type=1', '36857905', 1)).toBeNull();
    expect(goteborgKmlUrl('https://www.goteborgenergi.se', 'https://www.goteborgenergi.se/GoteborgEnergi/Outages/FilteredOutagesKml.ashx?type=36857905&t=1', '36857905', 1)).toContain('active=1');
  });
});

describe('fetchOperatorOutages', () => {
  it('Göteborg Energi: POSTs current-outages, then merges active + inactive KML', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const c = ctx(async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.includes('current-outages')) return new Response(fx('goteborg-current-outages-2026-11-14.json'));
      if (url.includes('upcoming-outages')) return new Response(fx('goteborg-upcoming-2026-11-14.json'));
      if (url.includes('active=1') || !url.includes('type=36857905')) return new Response(fx('goteborg-el-active-empty-2026-11-14.kml'));
      if (url.includes('active=0')) return new Response(fx('goteborg-el-inactive-2026-11-14.kml'));
      return new Response('', { status: 404 });
    });
    const r = await fetchOperatorOutages(gbg, c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const el = r.data.outages.filter((o) => o.utility === 'electricity');
    expect(el).toHaveLength(3);
    expect(el.every((o) => o.externalId.startsWith('goteborg_energi:') && o.state === 'restored')).toBe(true);
    // Fas 4: planned heating/cooling work by address, tied to the Göteborg address area.
    const addr = r.data.outages.filter((o) => o.precision === 'address_list');
    expect(addr).toHaveLength(21);
    expect(addr.every((o) => o.addressArea?.radiusM === 25_000)).toBe(true);
    expect(calls[0]).toMatchObject({ method: 'POST' });
    expect(calls.every((x) => x.url.startsWith('https://www.goteborgenergi.se/'))).toBe(true);
  });

  it('Vattenfall: invalid JSON → invalid_payload; HTTP 500 → upstream_error (never "no outages")', async () => {
    const notJson = await fetchOperatorOutages(vattenfall, ctx(async () => new Response('<html>')));
    expect(notJson).toMatchObject({ ok: false, error: 'invalid_payload' });
    const down = await fetchOperatorOutages(vattenfall, ctx(async () => new Response('', { status: 500 })));
    expect(down).toMatchObject({ ok: false, error: 'upstream_error' });
  });

  it('Digpro: fetches the operator KML with an identifying User-Agent', async () => {
    let ua = '';
    const fev = operatorById('digpro:fev')!;
    const r = await fetchOperatorOutages(fev, ctx(async (url, init) => {
      ua = new Headers(init?.headers).get('user-agent') ?? '';
      expect(url).toBe('https://webmap.fev.se/bios/servlet/sys.outagemap.servlets.api.GetOutagesKML?app=fpp_fev');
      return new Response(fx('digpro-fev-2026-11-14.kml'));
    }));
    expect(r.ok && r.data.outages.length).toBe(10);
    expect(ua).toBe('FastighetsRadar-avbrottsbevakning/1.0');
  });
});
