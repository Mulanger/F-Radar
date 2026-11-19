import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchAddressList, normalizeHousenumber, parseAddressList } from '@fastighetsradar/domain';
import { operatorById, operatorIdForEiName, parseDigproKml, parseGoteborgTime, parseGoteborgUpcoming, parseTekniskaVerken, UTILITY_OPERATORS } from '../src';

/** District heating / cooling (docs/plans/stromavbrott.md Fas 4). Real responses captured 2026-11-14. */
const fx = (name: string) => readFileSync(new URL(`./fixtures/utility-outages/${name}`, import.meta.url), 'utf8');
const NOW = new Date('2026-11-14T18:30:00Z');
const gbg = operatorById('goteborg_energi')!;
const tv = operatorById('tekniskaverken')!;

describe('address lists', () => {
  it('parses streets with house numbers, street-only lines and unreadable numbers', () => {
    expect(parseAddressList('Stora Nygatan 1, 3\r\nSlussgatan 1\r\nRichtersgatan\r\nHavsörnsgatan \r\nLånga gatan 2-8\r\nTorget 12 B och 14')).toEqual([
      { street: 'stora nygatan', numbers: ['1', '3'] },
      { street: 'slussgatan', numbers: ['1'] },
      { street: 'richtersgatan', numbers: null },
      { street: 'havsörnsgatan', numbers: null },
      { street: 'långa gatan', numbers: null }, // ranges are not expanded – street level only
      { street: 'torget', numbers: null }, // "12 B och 14": "B" alone is not a number token → street level
    ]);
    expect(parseAddressList('')).toBeNull();
  });
  it('matches exact street + number; street-only lines give a street match', () => {
    const list = parseAddressList('Stora Nygatan 1, 3\nRichtersgatan')!;
    expect(matchAddressList('Stora Nygatan', '3', list)).toBe('outage_address');
    expect(matchAddressList('stora  nygatan', '5', list)).toBeNull();
    expect(matchAddressList('Richtersgatan', '12', list)).toBe('outage_street');
    expect(matchAddressList('Nygatan', '1', list)).toBeNull(); // no fuzzy street names
    expect(matchAddressList(null, '1', list)).toBeNull();
    expect(normalizeHousenumber('12 B')).toBe('12b');
  });
});

describe('Göteborg Energi planned heating/cooling by address', () => {
  it('reads "kl" time windows (same day and across midnight)', () => {
    expect(parseGoteborgTime('2026-11-15 kl 11:00 till 2026-11-16 kl 02:00')).toEqual({ start: '2026-11-15T10:00:00.000Z', end: '2026-11-16T01:00:00.000Z' });
    expect(parseGoteborgTime('2026-11-16 kl 07:00 till kl 18:00')).toEqual({ start: '2026-11-16T06:00:00.000Z', end: '2026-11-16T17:00:00.000Z' });
    expect(parseGoteborgTime('nästa vecka')).toBeNull();
    expect(parseGoteborgTime('2026-11-16 kl 18:00 till kl 07:00')).toBeNull();
  });
  it('turns the upcoming list into planned address-list outages; gas and unknown types are ignored', () => {
    const r = parseGoteborgUpcoming(JSON.parse(fx('goteborg-upcoming-2026-11-14.json')), gbg, ['district_heating', 'district_cooling'], NOW)!;
    expect(r.skipped).toBe(0);
    expect(r.outages).toHaveLength(21);
    const o = r.outages.find((x) => x.externalId === 'goteborg_energi:upcoming:193264667')!;
    expect(o).toMatchObject({ utility: 'district_heating', kind: 'planned', state: 'upcoming', precision: 'address_list', geometry: null, placeLabel: 'Stampen/Vallgraven' });
    expect(o.addresses).toContainEqual({ street: 'stora nygatan', numbers: ['1', '3'] });
    expect(o.operatorText).toContain('Tänk på att det kan ta upp till två timmar');
    expect(r.outages.filter((x) => x.utility === 'district_cooling')).toHaveLength(1);
    expect(parseGoteborgUpcoming(JSON.parse(fx('goteborg-upcoming-2026-11-14.json')), gbg, ['district_cooling'], NOW)!.ignored).toBe(20);
  });
});

describe('heating layers', () => {
  it('Digpro heating uses its own external id prefix', () => {
    const r = parseDigproKml(fx('digpro-lme-2026-11-14.kml'), { operatorId: 'digpro:lul', utility: 'district_heating', mapUrl: '', now: NOW, externalPrefix: 'digpro:lul:dh' })!;
    expect(r.outages.every((o) => o.externalId.startsWith('digpro:lul:dh:') && o.utility === 'district_heating')).toBe(true);
  });
  it('Tekniska verken district heating parses with polygons', () => {
    const t = JSON.parse(fx('tekniskaverken-2026-11-14.json'));
    const r = parseTekniskaVerken(t.list, t.shapes, tv, NOW)!;
    expect(r.outages.filter((o) => o.utility === 'district_heating')).toHaveLength(8);
    expect(r.outages.find((o) => o.utility === 'district_heating')).toMatchObject({ kind: 'planned', precision: 'polygon' });
  });
  it('heating-only operators never claim an electricity grid', () => {
    expect(operatorById('digpro:lnd')!.utilities).toEqual(['district_heating']);
    expect(operatorIdForEiName('Kraftringen Nät AB', [operatorById('digpro:lnd')!])).toBe('ei:Kraftringen Nät AB');
    expect(UTILITY_OPERATORS.filter((o) => o.utilities.includes('district_heating')).length).toBeGreaterThanOrEqual(8);
  });
});
