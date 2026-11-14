import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HISTORY_PARAMETERS, historyCsvAccumulator } from '../src/smhi/history';

function parseFixture(file: string, key: string, monthly = false) {
  const parameter = HISTORY_PARAMETERS.find((p) => p.key === key)!;
  const accumulator = historyCsvAccumulator(parameter, '1900-01-01', '2030-01-01', monthly);
  const csv = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8');
  for (const line of csv.split(/\r?\n/)) accumulator.line(line);
  return { result: accumulator.finish(), csv, parameter };
}

describe('real SMHI history CSV formats, captured 2026-11-13', () => {
  it.each([
    [5, 'precipitation'],
    [19, 'temperature_min'],
    [20, 'temperature_max'],
    [2, 'temperature_mean'],
  ])('preserves the representative day for parameter %s', (id, key) => {
    const { result, csv } = parseFixture(`history-metobs-${id}.csv`, key);
    expect(result?.days.length).toBeGreaterThan(20);
    const first = csv
      .split('\n')
      .find((line) => /^\d{4}-\d{2}-\d{2} .*;\d{4}-\d{2}-\d{2} .*;\d{4}-\d{2}-\d{2};/.test(line))!
      .split(';');
    expect(result!.days[0]).toMatchObject({ date: first[2], value: Number(first[3]), coverage: 1 });
  });

  it('aggregates hourly gusts and RW hourly sea samples with explicit day coverage', () => {
    const gust = parseFixture('history-metobs-21.csv', 'wind_gust').result!;
    const sea = parseFixture('history-ocobs-12.csv', 'sea_level').result!;
    expect(gust.days.some((d) => d.coverage === 1 && d.value !== null)).toBe(true);
    expect(sea.days.some((d) => d.coverage === 1 && d.min !== null && d.max !== null)).toBe(true);
    expect(sea.days.some((d) => d.coverage < 1 && d.value === null)).toBe(true);
  });

  it('derives observed temperature crossings from a complete hourly series, never from daily extrema', () => {
    const result = parseFixture('history-metobs-1.csv', 'temperature_crossings').result!;
    expect(result.days.some((d) => d.value === 0 && d.coverage === 1)).toBe(true);
    expect(result.days.some((d) => d.coverage < 1 && d.value === null)).toBe(true);
  });

  it('reads hydrology daily dates in the source-defined time convention', () => {
    const { result } = parseFixture('history-hydroobs-1.csv', 'water_flow');
    expect(result!.days[0]).toMatchObject({ date: '1952-01-01', value: 9.1, coverage: 1 });
  });

  it('never creates normals from a short monthly fixture', () => {
    expect(parseFixture('history-metobs-23.csv', 'precipitation', true).result!.normals).toEqual([]);
  });

  it('rejects wrong units and leaves bad/missing values unavailable', () => {
    const { csv, parameter } = parseFixture('history-metobs-5.csv', 'precipitation');
    const wrong = historyCsvAccumulator(parameter, '2020-01-01', '2030-01-01');
    for (const line of csv.replaceAll('millimeter', 'celsius').split('\n')) wrong.line(line);
    expect(wrong.finish()).toBeNull();
    const missing = historyCsvAccumulator(parameter, '2020-01-01', '2030-01-01');
    for (const line of csv.replace(';8.0;G', ';9999;G').split('\n')) missing.line(line);
    expect(missing.finish()!.days[0]).toMatchObject({ value: null, coverage: 0 });
  });
});

describe('history archive requests', () => {
  it('accepts SMHI CSV served as text/plain, so latest-months and latest-day are not refused with 406', async () => {
    const { loadServerEnv } = await import('@fastighetsradar/config');
    const { HISTORY_CSV_ACCEPT, fetchHistorySeries } = await import('../src/smhi/history');
    const csv = readFileSync(new URL('./fixtures/history-metobs-20.csv', import.meta.url), 'utf8');
    const seen: Array<{ url: string; accept: string | null }> = [];
    const fetchMock = (async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), accept: new Headers(init?.headers).get('accept') });
      return new Response(csv, { status: 200, headers: { 'content-type': 'text/plain;charset=UTF-8' } });
    }) as unknown as typeof fetch;
    const ctx = { env: loadServerEnv({}), fetch: fetchMock, now: () => new Date('2026-11-14T08:00:00Z'), logger: { debug() {}, info() {}, warn() {}, error() {} } };
    const parameter = HISTORY_PARAMETERS.find((p) => p.key === 'temperature_max')!;
    const r = await fetchHistorySeries(parameter, '133050', 'latest-months', ctx);
    expect(r.ok).toBe(true);
    expect(seen[0]!.url).toContain('/period/latest-months/data.csv');
    expect(seen[0]!.accept).toBe(HISTORY_CSV_ACCEPT);
    expect(HISTORY_CSV_ACCEPT).toContain('text/plain');
  });
});
