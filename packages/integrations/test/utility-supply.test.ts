import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { enabledOperators, fetchOperatorOutages, operatorById, parseServiceAlert, serviceAlertProfile, UTILITY_OPERATORS, type AdapterContext } from '../src';

const now = new Date('2026-11-19T07:00:00Z');
const text = (id: string) => readFileSync(new URL(`./fixtures/utility-outages/${id}`, import.meta.url), 'utf8');
describe('water/gas quick wins with independent default-off utility gates', () => {
  it('uses the actual six VA profile titles, rejects telecom and correctly distinguishes unplanned', () => {
    for (const title of ['Vatten', 'VA', 'Vatten och Avlopp', 'Vatten & Avlopp']) expect(serviceAlertProfile(title)?.utility).toBe('water');
    expect(serviceAlertProfile('Elnät - Oplanerade avbrott')?.kind).toBe('unplanned');
    expect(serviceAlertProfile('El')?.utility).toBe('electricity');
    for (const title of ['Stadsnät', 'Bredband', 'Fiber', 'Kabel-TV', 'Återvinning']) expect(serviceAlertProfile(title)).toBeNull();
  });
  it('water profiles produce honest information with the real provider geometry and no guessed start time', () => {
    const op = operatorById('servicealert:ulricehamn')!;
    const raw = JSON.parse(text('servicealert-ulricehamn-2026-11-19.json'));
    const result = parseServiceAlert(raw, op, ['water'], now)!;
    expect(result.skipped).toBe(0);
    expect(result.outages.length).toBeGreaterThan(0);
    for (const o of result.outages) expect(o).toMatchObject({ utility: 'water', noticeKind: 'information', precision: 'area', kind: 'unknown', state: 'unknown', plannedStart: null, actualStart: null });
    const coordinatesOnly = parseServiceAlert(JSON.parse(text('servicealert-eem-2026-11-19.json')), operatorById('servicealert:eem')!, ['water'], now)!;
    expect(coordinatesOnly.outages).toHaveLength(0);
    expect(coordinatesOnly.skipped).toBeGreaterThan(0);
  });
  it('the water flag can enable water while the gas flag cannot enable gas', () => {
    const off = enabledOperators('', UTILITY_OPERATORS, loadServerEnv({ SOURCE_UTILITY_OUTAGES_ENABLED: 'true' }));
    expect(off.every((o) => !o.utilities.includes('water') && !o.utilities.includes('gas'))).toBe(true);
    const on = enabledOperators('', UTILITY_OPERATORS, loadServerEnv({ SOURCE_UTILITY_WATER_ENABLED: 'true', SOURCE_UTILITY_GAS_ENABLED: 'true' }));
    expect(on.find((o) => o.id === 'goteborg_energi')!.utilities).toEqual(['electricity']);
    expect(on.find((o) => o.id === 'servicealert:eem')!.utilities).toContain('water');
  });
  it('makes no requests when only Göteborg gas is selected', async () => {
    const op = { ...operatorById('goteborg_energi')!, utilities: ['gas' as const] };
    const fetcher = vi.fn<typeof fetch>();
    const ctx: AdapterContext = { env: loadServerEnv({ SOURCE_UTILITY_GAS_ENABLED: 'true' }), now: () => now, fetch: fetcher as typeof fetch, logger: { debug() {}, info() {}, warn() {}, error() {} } };
    expect(await fetchOperatorOutages(op, ctx)).toMatchObject({ ok: false, error: 'disabled' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
