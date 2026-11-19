import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { enabledOperators, operatorById, parseDigproKml, parseServiceAlert, parseTrimble, parseUmea, trimbleDistricts, trimbleStations, UTILITY_OPERATORS } from '../src';

const text = (id: string) => readFileSync(new URL(`./fixtures/utility-outages/${id}`, import.meta.url), 'utf8');
const json = (id: string) => JSON.parse(text(`${id}-2026-11-19.json`));
const now = new Date('2026-11-19T08:00:00Z');

describe('national heating feeds verified from the pod', () => {
  it('parses Exergi polygons with heating labels and explicit times', () => {
    const op = operatorById('stockholm_exergi')!;
    const r = parseDigproKml(text('exergi-kml-2026-11-19.kml'), { operatorId: op.id, utility: 'district_heating', mapUrl: op.mapUrl, now })!;
    expect(r.skipped).toBe(0);
    expect(r.outages.length).toBeGreaterThan(0);
    expect(r.outages.every((o) => o.utility === 'district_heating' && o.geometry && o.sourceUrl === op.mapUrl)).toBe(true);
    expect(op.reportsRestored).toBe(true);
  });
  it('uses Vattenfall heat stations and districts, never electricity or precise customer geometry', () => {
    const op = operatorById('vattenfall_heat')!;
    if (op.platform !== 'trimble') throw new Error('Expected Trimble');
    const r = parseTrimble(json('vattenfall-heat-app'), trimbleDistricts(json('vattenfall-heat-static'), 'h')!, trimbleStations([json('vattenfall-heat-tiles-0')]), op, now)!;
    expect(r.skipped).toBe(0);
    expect(r.outages).toHaveLength(8);
    expect(r.outages.every((o) => o.utility === 'district_heating' && o.precision === 'area')).toBe(true);
    expect(parseTrimble({}, [], new Map(), op, now)).toBeNull();
  });
  it('maps only Solör’s verified heating profiles and keeps unknown kinds and times unknown', () => {
    const r = parseServiceAlert(json('solor-profiles'), operatorById('solor')!, ['district_heating'], now)!;
    expect(r.skipped).toBe(0);
    expect(r.outages.length).toBeGreaterThan(0);
    expect(r.outages.every((o) => o.utility === 'district_heating' && o.kind === 'unknown' && o.actualStart === null && o.precision === 'area')).toBe(true);
    expect(r.ignored).toBeGreaterThan(0); // Danderyd VA is a different utility.
  });
  it('reuses Umeå’s published heat and cooling geometries, and gates every new addition', () => {
    const op = operatorById('umea')!;
    const r = parseUmea(json('umea-public'), { ...op, utilities: ['district_heating', 'district_cooling'] }, now)!;
    expect(r.skipped).toBe(0);
    expect(new Set(r.outages.map((o) => o.utility))).toEqual(new Set(['district_heating', 'district_cooling']));
    const off = enabledOperators('', UTILITY_OPERATORS, loadServerEnv({}));
    for (const id of ['stockholm_exergi', 'vattenfall_heat', 'solor']) expect(off.some((o) => o.id === id)).toBe(false);
    expect(off.some((o) => o.id === 'umea')).toBe(false);
    const on = enabledOperators('umea', UTILITY_OPERATORS, loadServerEnv({ SOURCE_UTILITY_UMEA_ENABLED: 'true' }));
    expect(on[0]!.utilities).toEqual(['electricity']);
  });
});
