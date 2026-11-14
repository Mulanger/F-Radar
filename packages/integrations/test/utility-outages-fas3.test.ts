import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  circleRing,
  decodeEonOutstat,
  htmlToText,
  inSweden,
  operatorById,
  operatorIdForEiName,
  parseEon,
  parseEonDetailText,
  parseServiceAlert,
  serviceAlertAreas,
  serviceAlertProfile,
  sweref99tmToWgs84,
  UTILITY_OPERATORS,
  type NormalizedUtilityOutage,
} from '../src';
// @ts-expect-error – plain ESM script without types
import { detect } from '../../../scripts/discover-outage-platforms.mjs';

/** Real responses captured 2026-11-14 (docs/plans/stromavbrott.md Fas 3), trimmed. */
const fxPath = (name: string) => new URL(`./fixtures/utility-outages/${name}`, import.meta.url);
const fx = (name: string) => JSON.parse(readFileSync(fxPath(name), 'utf8'));
const NOW = new Date('2026-11-14T18:30:00Z');
const coords = (o: NormalizedUtilityOutage) => JSON.stringify((o.geometry as { coordinates: unknown }).coordinates).match(/-?\d+\.\d+,-?\d+\.\d+/g)!.map((s) => s.split(',').map(Number) as [number, number]);

describe('SWEREF 99 TM → WGS84 (Lantmäteriet formulas)', () => {
  it('projects known points to within metres', () => {
    const [lon, lat] = sweref99tmToWgs84(6580822, 674032); // Stockholm
    expect(lat).toBeCloseTo(59.3302, 3);
    expect(lon).toBeCloseTo(18.0592, 3);
    const [lon2, lat2] = sweref99tmToWgs84(6400000, 319300); // Göteborg
    expect(lat2).toBeCloseTo(57.7058, 3);
    expect(lon2).toBeCloseTo(11.9672, 3);
  });
});

describe('E.ON (binary outstat + station areas)', () => {
  const bin = readFileSync(fxPath('eon-outstat-2026-11-14.bin'));
  const e = fx('eon-2026-11-14.json');
  const eon = operatorById('eon')!;

  it('decodes 52-byte records: area address, outage id, flags, affected station areas', () => {
    const recs = decodeEonOutstat(bin)!;
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({ areaPath: '01/01/01/01', outageId: 238436, fault: true, planned: false, stationAreas: ['10'] });
    expect(decodeEonOutstat(Buffer.alloc(51))).toBeNull();
  });

  it('repairs the malformed detail JSON the same way the map does', () => {
    expect(parseEonDetailText('{"t":"D","ts":1,[{"c":9,"t":2}]}')).toEqual({ t: 'D', ts: 1, evts: [{ c: 9, t: 2 }] });
    expect(parseEonDetailText('not json')).toBeUndefined();
  });

  it('builds area-precision outages with WGS84 station-area geometry and E.ON’s comment', () => {
    const details = new Map(Object.entries(e.details).map(([k, v]) => [Number(k), parseEonDetailText(v as string)]));
    const areas = new Map(Object.entries(e.areas));
    const r = parseEon(decodeEonOutstat(bin)!, details, areas, eon, NOW);
    expect(r.skipped).toBe(0);
    const o = r.outages.find((x) => x.externalId === 'eon:238392')!;
    expect(o).toMatchObject({ kind: 'unplanned', state: 'ongoing', precision: 'area', operatorText: 'Transformator byte i GT 80507.', affectedCustomers: 1 });
    expect(o.actualStart).toBe('2026-11-13T21:32:08.555Z');
    expect(o.estimatedRestore).toBe('2026-11-14T19:00:00.000Z');
    expect(coords(o).every(inSweden)).toBe(true);
    // Missing detail → skipped (never guessed).
    expect(parseEon(decodeEonOutstat(bin)!, new Map(), areas, eon, NOW).skipped).toBe(2);
  });
});

describe('ServiceAlert notices', () => {
  const karlstad = operatorById('servicealert:karlstad')!;
  const molndal = operatorById('servicealert:molndal')!;
  it('profile titles give utility and, where split, kind', () => {
    expect(serviceAlertProfile('Elnät')).toEqual({ utility: 'electricity', kind: 'unknown' });
    expect(serviceAlertProfile('Elnät - Planerade avbrott')).toEqual({ utility: 'electricity', kind: 'planned' });
    expect(serviceAlertProfile('Elnät - Akuta avbrott')).toEqual({ utility: 'electricity', kind: 'unplanned' });
    expect(serviceAlertProfile('Fjärrvärme')).toEqual({ utility: 'district_heating', kind: 'unknown' });
    expect(serviceAlertProfile('Stadsnät')).toBeNull();
  });
  it('point + radius becomes a circle inside Sweden; HTML becomes text', () => {
    const polys = serviceAlertAreas('[{"type":"Feature","properties":{"radius":500},"geometry":{"type":"Point","coordinates":[13.52,59.39]}}]')!;
    expect(polys[0]![0]!.length).toBe(33);
    expect(polys[0]![0]!.every(inSweden)).toBe(true);
    expect(circleRing([13.52, 59.39], 0)).toBeNull();
    expect(htmlToText('<p>Vi ska&nbsp;laga</p><br /><p>Ring oss</p>')).toBe('Vi ska laga Ring oss');
  });
  it('Mölndal: planned electricity notice is kind planned, state unknown; heating ignored in electricity mode', () => {
    const r = parseServiceAlert(fx('servicealert-molndal-2026-11-14.json'), molndal, ['electricity'], NOW)!;
    expect(r.outages).toHaveLength(1);
    expect(r.outages[0]).toMatchObject({ kind: 'planned', state: 'unknown', precision: 'area', utility: 'electricity' });
    expect(r.outages[0]!.operatorText).toContain('Planerat strömavbrott');
    expect(r.ignored).toBe(3);
  });
  it('Karlstad: district heating messages parse when heating is enabled (Fas 4)', () => {
    const r = parseServiceAlert(fx('servicealert-karlstad-2026-11-14.json'), karlstad, ['electricity', 'district_heating'], NOW)!;
    expect(r.outages.every((o) => o.utility === 'district_heating')).toBe(true);
    expect(r.outages.length).toBeGreaterThan(0);
    expect(parseServiceAlert({ nope: 1 }, karlstad, ['electricity'], NOW)).toBeNull();
  });
});

describe('platform discovery', () => {
  it('detects Digpro, Trimble and ServiceAlert signatures', () => {
    expect(detect('<iframe src="https://webmap.fev.se/outagemap2/?cust=fev&app=fpp">', 'https://fev.se/')).toEqual([{ platform: 'digpro', host: 'webmap.fev.se', cust: 'fev' }]);
    expect(detect('<iframe src="https://driftinfo.malarenergi.se/NisOutageMap/OutageMap.html">', 'https://x.se/')).toEqual([{ platform: 'trimble', base: 'https://driftinfo.malarenergi.se' }]);
    expect(detect('src="https://se.sms-service.dk/iFrame/driftstatus-map?customerId=fa39c3a2-d576-40c3-bfa5-ae15f9117d90&x=1"', 'https://x.se/')).toEqual([
      { platform: 'servicealert', apiBase: 'https://se.sms-service.dk/api', customerIds: 'fa39c3a2-d576-40c3-bfa5-ae15f9117d90' },
    ]);
  });
  it('every configured operator has a unique id and a known Ei holder name', () => {
    expect(new Set(UTILITY_OPERATORS.map((o) => o.id)).size).toBe(UTILITY_OPERATORS.length);
    for (const op of UTILITY_OPERATORS.filter((o) => o.utilities.includes('electricity'))) expect(operatorIdForEiName(op.eiNames[0]!)).toBe(op.id);
  });
});
