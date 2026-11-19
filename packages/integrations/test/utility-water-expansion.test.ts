import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { fetchOperatorOutages, operatorById, parseSvoa, parseTekniskaVerken, parseServiceAlert, waterNoticeHeading, type AdapterContext } from '../src';
const fx = (id: string) => JSON.parse(readFileSync(new URL(`./fixtures/utility-outages/${id}-2026-11-19.json`, import.meta.url), 'utf8'));
const now = new Date('2026-11-19T09:00:00Z');
const env = loadServerEnv({ SOURCE_UTILITY_WATER_ENABLED: 'true' });
const context = (f: typeof fetch): AdapterContext => ({ env, fetch: f, now: () => now, logger: { debug() {}, info() {}, warn() {}, error() {} } });
describe('verified national water feeds', () => {
  it('reads all SVOA pages and filters unrelated projects without inventing restoration times', async () => {
    const fetcher = vi.fn(async (input) => new Response(JSON.stringify(fx(String(input).includes('skip=0') ? 'svoa-search' : 'svoa-search-next'))));
    const r = await fetchOperatorOutages(operatorById('svoa')!, context(fetcher as typeof fetch));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ ok: true, data: { skipped: 0, ignored: 16 } });
    if (!r.ok) throw new Error('Unexpected failure');
    expect(r.data.outages).toHaveLength(2);
    expect(r.data.outages.every((o) => o.state === 'restored' && o.restoredAt === null && o.utility === 'water' && o.precision === 'polygon')).toBe(true);
    expect(new Set(r.data.outages.map((o) => o.kind))).toEqual(new Set(['planned', 'unplanned']));
  });
  it('rejects inconsistent, duplicate and missing pages instead of ending absent notices', async () => {
    for (const second of [{ ...fx('svoa-search-next'), totalCount: 19 }, { ...fx('svoa-search-next'), disturbances: [] }, fx('svoa-search')]) {
      const fetcher = vi.fn(async (input) => new Response(JSON.stringify(String(input).includes('skip=0') ? fx('svoa-search') : second)));
      expect(await fetchOperatorOutages(operatorById('svoa')!, context(fetcher as typeof fetch))).toMatchObject({ ok: false, error: 'invalid_payload' });
    }
  });
  it('validates real coordinate order, date-only unknown time, and explicit Tekniska verken water states', () => {
    const water = fx('svoa-search-next').disturbances.find((r: { type: string }) => r.type === 'water');
    const r = parseSvoa([{ ...water, startDate: '2026-11-19' }], operatorById('svoa')!);
    expect(r.outages[0]!.plannedStart).toBeNull();
    expect(parseSvoa([{ ...water, affectedAreaCoordinates: water.affectedAreaCoordinates.map((p: { latitude: string; longitude: string }) => ({ ...p, latitude: p.longitude, longitude: p.latitude })) }], operatorById('svoa')!).skipped).toBe(1);
    const tv = parseTekniskaVerken(fx('tv-water-list'), fx('tv-water-shapes'), { ...operatorById('tekniskaverken')!, utilities: ['water'] }, now)!;
    expect(tv.skipped).toBe(0);
    expect(tv.outages).toHaveLength(2);
    expect(new Set(tv.outages.map((o) => o.kind))).toEqual(new Set(['planned', 'unplanned']));
    expect(new Set(tv.outages.map((o) => o.state))).toEqual(new Set(['ongoing']));
  });
  it('boiling is an explicit heading, not generic advice; synthetic lifecycle variants retain real geometry', () => {
    // No active boiling notice was observed live. These are deliberate synthetic classification variants.
    expect(waterNoticeHeading('Så gör du vid kokningsrekommendation')).toBeNull();
    expect(waterNoticeHeading('Ingen kokningsrekommendation')).toBeNull();
    expect(waterNoticeHeading('Kokningsrekommendation för tätorten')).toBe('boil_water');
    const raw = fx('servicealert-ulricehamn');
    const p = raw.profileSettingsAndMessages.find((p: { profileTitle: string }) => /^vatten/i.test(p.profileTitle));
    const message = p.webMessages[0];
    const make = (title: string) => parseServiceAlert({ ...raw, profileSettingsAndMessages: [{ ...p, webMessages: [{ ...message, title }] }] }, operatorById('servicealert:ulricehamn')!, ['water'], now)!;
    expect(make('Kokningsrekommendation för tätorten').outages[0]).toMatchObject({ noticeKind: 'boil_water', state: 'ongoing', precision: 'area', actualStart: null });
    expect(make('Kokningsrekommendationen är hävd').outages[0]).toMatchObject({ noticeKind: 'boil_water', state: 'restored', restoredAt: null });
    expect(make('Bevattningsförbud').outages).toHaveLength(0);
  });
});
