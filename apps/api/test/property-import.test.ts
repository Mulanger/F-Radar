import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressSuggestion } from '@fastighetsradar/integrations';
import { createPacer, importPropertyBatch, serializeForOrganization, type ImportGeocoder } from '../src/property-import';

const ctx = { organizationId: '11111111-1111-4111-8111-111111111111', userId: 'user_test' };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Answers the three statements an import batch runs: existing keys, insert, read back. */
function fakeDb(existing: Array<{ id: string; address: string; geocode_label: string | null; geocode_place_id: string | null }> = []) {
  const inserted: unknown[][] = [];
  let n = 100;
  const db = {
    async query<R>(sql: string, params: unknown[] = []) {
      if (sql.startsWith('SELECT id, address, geocode_label')) return { rows: existing as R[], rowCount: existing.length };
      if (sql.includes('WITH ins AS')) {
        inserted.push(params);
        return { rows: [{ id: uuid(++n) }] as R[], rowCount: 1 };
      }
      if (sql.includes('p.organization_id = $1 AND p.id = $2')) {
        const p = inserted.find((_, i) => uuid(101 + i) === params[1])!;
        const row = {
          id: params[1], name: p[1], address: p[2], status: 'profiling', position_source: p[16], lat: p[4], lon: p[3],
          geocode_provider: p[5], geocode_precision: p[6], geocode_confidence: null, geocode_label: p[9], geocode_place_id: p[8],
          geocode_result_type: null, postcode: null, city: null, municipality: null, geocoded_at: null, created_at: new Date(), updated_at: new Date(),
        };
        return { rows: [row] as R[], rowCount: 1 };
      }
      throw new Error(`unexpected statement: ${sql.slice(0, 60)}`);
    },
  };
  return { db, inserted };
}

const hit = (label: string, precision: AddressSuggestion['precision'], placeId = label): AddressSuggestion => ({
  label, lat: 59.33, lon: 18.06, precision, placeId, provider: 'geoapify',
});

describe('property import batch (Fas 6 / S-28)', () => {
  it('creates rows from coordinates and from the address search, with a status per row', async () => {
    const { db, inserted } = fakeDb([{ id: uuid(1), address: 'Kontoret', geocode_label: 'Sveavägen 42, 111 34 Stockholm, Sverige', geocode_place_id: 'p-sveav' }]);
    const searched: string[] = [];
    const geocode: ImportGeocoder = async (address) => {
      searched.push(address);
      if (address.startsWith('Finns ej')) return { ok: true, data: null };
      if (address.startsWith('Gata')) return { ok: true, data: hit('Gatan, Uppsala', 'street') };
      if (address.startsWith('Samma plats')) return { ok: true, data: hit('Torget 1, Kista', 'building', 'p-torget') };
      return { ok: true, data: hit(`${address}, Sverige`, 'building') };
    };
    const out = await importPropertyBatch(db, ctx, [
      { row: 2, name: 'Pinnen', address: 'Okänd väg 1', location: { lat: 59.4, lon: 18.1 } },
      { row: 3, name: 'Huset', address: 'Torget 1, Kista' },
      { row: 4, name: 'Gatan', address: 'Gata utan nummer, Uppsala' },
      { row: 5, name: 'Saknas', address: 'Finns ej 99, Ingenstans' },
      // The search label of an existing property, written differently.
      { row: 6, name: 'Kopia', address: 'Sveavägen 42, Stockholm' },
      // Another wording that the search puts on the place row 3 just took.
      { row: 7, name: 'Torget igen', address: 'Samma plats, Kista' },
    ], { geocode, limit: 1000 });

    expect(out.results.map((r) => [r.row, r.status])).toEqual([[2, 'created'], [3, 'created'], [4, 'created'], [5, 'not_found'], [6, 'duplicate'], [7, 'duplicate']]);
    expect(out.results[0]).not.toHaveProperty('needsReview');
    expect(out.results[1]).toMatchObject({ needsReview: false, match: { precision: 'building' } });
    expect(out.results[2]).toMatchObject({ needsReview: true, match: { label: 'Gatan, Uppsala', precision: 'street' } });
    expect(out.results[4]).toMatchObject({ propertyId: uuid(1) });
    expect(out.created).toBe(3);
    expect(out.remaining).toBe(1000 - 4);
    // Coordinates from the file are not searched and count as a position set by the customer.
    expect(searched).not.toContain('Okänd väg 1');
    expect(searched).not.toContain('Sveavägen 42, Stockholm');
    expect(inserted[0]![5]).toBe('manual_pin');
    // The customer's wording is kept as the address; the search label is stored beside it.
    expect(inserted[1]!.slice(2, 3)).toEqual(['Torget 1, Kista']);
  });

  it('stops at the property limit without spending searches on rows that cannot be created', async () => {
    const { db } = fakeDb([{ id: uuid(1), address: 'A 1, Stockholm', geocode_label: null, geocode_place_id: null }]);
    const geocode = vi.fn<ImportGeocoder>(async (address) => ({ ok: true, data: hit(address, 'building') }));
    const rows = Array.from({ length: 6 }, (_, i) => ({ row: i + 1, name: `R${i}`, address: `Vägen ${i + 1}, Kista` }));
    const out = await importPropertyBatch(db, ctx, rows, { geocode, limit: 3 });
    expect(out.results.filter((r) => r.status === 'created')).toHaveLength(2);
    expect(out.results.filter((r) => r.status === 'limit_reached')).toHaveLength(4);
    expect(out.remaining).toBe(0);
    // Four searches run in parallel, so up to four can be under way when the limit is hit; never all six.
    expect(geocode.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('returns rows as pending on a passing error or after the time budget, and unavailable when search is off', async () => {
    const { db } = fakeDb();
    let t = 0;
    const slow: ImportGeocoder = async (address) => {
      t += 4_000;
      return address.includes('fel') ? { ok: false, retry: true } : { ok: true, data: hit(address, 'building') };
    };
    const rows = Array.from({ length: 10 }, (_, i) => ({ row: i + 1, name: `R${i}`, address: i === 0 ? 'Vägen fel, Kista' : `Vägen ${i + 1}, Kista` }));
    const out = await importPropertyBatch(db, ctx, rows, { geocode: slow, limit: 1000, now: () => t });
    expect(out.results[0]!.status).toBe('pending');
    // 4 s per search: the budget (9 s) is spent after the first round of four.
    expect(out.results.filter((r) => r.status === 'created').length).toBeGreaterThan(0);
    expect(out.results.filter((r) => r.status === 'pending').length).toBeGreaterThan(1);

    const off: ImportGeocoder = async () => ({ ok: false, retry: false });
    const out2 = await importPropertyBatch(fakeDb().db, ctx, rows.slice(1, 4), { geocode: off, limit: 1000 });
    expect(out2.results.map((r) => r.status)).toEqual(['geocoding_unavailable', 'geocoding_unavailable', 'geocoding_unavailable']);
  });
});

describe('import pacing and per-organization order', () => {
  afterEach(() => vi.useRealTimers());

  it('spaces address searches evenly for every caller', async () => {
    vi.useFakeTimers();
    const pacer = createPacer(10, () => 0);
    const done: number[] = [];
    for (const n of [1, 2, 3]) void pacer.wait().then(() => done.push(n));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toEqual([1]);
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toEqual([1, 2, 3]);
  });

  it('runs one batch at a time per organization, other organizations in parallel', async () => {
    const log: string[] = [];
    const job = (name: string, ms: number) => async () => {
      log.push(`${name}+`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`${name}-`);
    };
    await Promise.all([
      serializeForOrganization('a', job('a1', 30)),
      serializeForOrganization('a', job('a2', 1)),
      serializeForOrganization('b', job('b1', 1)),
    ]);
    expect(log.indexOf('a1-')).toBeLessThan(log.indexOf('a2+'));
    expect(log.indexOf('b1-')).toBeLessThan(log.indexOf('a1-'));
  });
});
