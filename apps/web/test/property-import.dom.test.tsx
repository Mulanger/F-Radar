// @vitest-environment jsdom
/**
 * Fas 6 (docs/plans/skalning.md, S-28): bulk import of properties – reading pasted Excel rows and CSV
 * files, the preview, sending in batches with a status per row, and the review list for positions
 * that only hit the street.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { PositionReviewItem, PropertyImportResponse, PropertyImportRow } from '@fastighetsradar/domain';
import { buildPreview, detectColumns, importRows, parseImportText } from '@/lib/import/parse';
import { ImportRequestError, runImport, type SubmitBatch } from '@/lib/import/run';
import { createDemoImport } from '@/lib/import/demo';
import { PropertyImportDialog } from '@/components/properties/PropertyImportDialog';
import { PositionReviewList } from '@/components/properties/PositionReview';

afterEach(cleanup);

const preview = (text: string, existing: string[] = []) => {
  const table = parseImportText(text);
  return buildPreview(table, detectColumns(table), existing);
};

describe('reading the file (S-28)', () => {
  it('reads rows pasted from Excel with Swedish headers and joins postcode and town', () => {
    const rows = preview('Namn\tAdress\tPostnummer\tOrt\nKontoret\tSveavägen 42\t111 34\tStockholm\nLagret\tTorshamnsgatan 2, Kista\t164 40\tKista\n');
    expect(rows).toEqual([
      { row: 2, name: 'Kontoret', address: 'Sveavägen 42, 111 34 Stockholm', location: undefined, status: 'ready' },
      // The town is already in the address: not repeated.
      { row: 3, name: 'Lagret', address: 'Torshamnsgatan 2, Kista, 164 40', location: undefined, status: 'ready' },
    ]);
  });

  it('reads a semicolon CSV with quotes, decimal commas and coordinates', () => {
    const rows = preview('\uFEFFfastighet;adress;latitud;longitud\r\n"Hus ""A""";"Storgatan 1; uppgång B, Umeå";63,8258;20,2630\r\n;Kungsgatan 5, Umeå;;\r\n');
    expect(rows[0]).toMatchObject({ row: 2, name: 'Hus "A"', address: 'Storgatan 1; uppgång B, Umeå', location: { lat: 63.8258, lon: 20.263 }, status: 'ready' });
    // No name: the street part of the address stands in.
    expect(rows[1]).toMatchObject({ name: 'Kungsgatan 5', status: 'ready' });
    expect(importRows(rows)[0]).toEqual({ row: 2, name: 'Hus "A"', address: 'Storgatan 1; uppgång B, Umeå', location: { lat: 63.8258, lon: 20.263 } });
  });

  it('guesses columns without a header: name, address, then coordinates', () => {
    const table = parseImportText('Kontoret,"Sveavägen 42, Stockholm",59.3367,18.0627\nLagret,"Kistagången 2, Kista",59.403,17.944');
    expect(detectColumns(table)).toEqual(['name', 'address', 'lat', 'lon']);
    expect(table.firstRowNumber).toBe(1);
  });

  it('marks broken rows, repeats, addresses the organization has and addresses without a town', () => {
    const rows = preview(
      ['Namn;Adress;Latitud;Longitud', 'A;Sveavägen 42, Stockholm;;', 'B;sveavägen 42,  STOCKHOLM;;', 'C;Kungsgatan 1, 111 43 Stockholm;;', 'D;;;', 'E;Paris 1, Frankrike;48,85;2,35', 'F;Storgatan 1;63,8;', 'G;Storgatan 1;;'].join('\n'),
      ['Kungsgatan 1, 111 43 Stockholm, Sverige'],
    );
    expect(rows.map((r) => [r.name, r.status, r.message ?? r.warning ?? ''])).toEqual([
      ['A', 'ready', ''],
      ['B', 'duplicate_file', 'Samma adress som rad 2'],
      ['C', 'exists', 'Finns redan som fastighet'],
      ['D', 'invalid', 'Adress saknas'],
      ['E', 'invalid', 'Koordinaterna ligger utanför Sverige (ange WGS84, t.ex. 59,3293 och 18,0686)'],
      ['F', 'invalid', 'Både latitud och longitud behövs'],
      ['G', 'ready', 'Ort saknas – adressen kan hamna i fel ort'],
    ]);
  });
});

const rowsOf = (n: number): PropertyImportRow[] => Array.from({ length: n }, (_, i) => ({ row: i + 2, name: `R${i}`, address: `Vägen ${i + 1}, Kista` }));

describe('sending in batches (S-28)', () => {
  it('sends 25 rows at a time, marks only the last batch final and sends pending rows again', async () => {
    const sent: Array<{ rows: number[]; final: boolean }> = [];
    let first = true;
    const submit: SubmitBatch = async ({ rows, final }) => {
      sent.push({ rows: rows.map((r) => r.row), final });
      const results = rows.map((r, i): PropertyImportResponse['results'][number] => ({ row: r.row, status: first && i >= 20 ? 'pending' : 'created', propertyId: crypto.randomUUID() }));
      first = false;
      return { results, remaining: 1000 };
    };
    const done = await runImport(rowsOf(60), submit, { signal: new AbortController().signal, onProgress: () => {}, sleep: async () => {} });
    expect(done.state).toBe('done');
    expect(done.done).toBe(60);
    expect(sent.map((s) => s.rows.length)).toEqual([25, 25, 15]);
    // The five rows the first batch did not reach lead the second.
    expect(sent[1]!.rows.slice(0, 5)).toEqual([22, 23, 24, 25, 26]);
    expect(sent.map((s) => s.final)).toEqual([false, false, true]);
  });

  it('waits and sends again when the API asks it to slow down (429)', async () => {
    let calls = 0;
    const submit: SubmitBatch = async ({ rows }) => {
      if (++calls <= 2) throw new ImportRequestError(429, 'För många');
      return { results: rows.map((r) => ({ row: r.row, status: 'created' as const })), remaining: 1000 };
    };
    const slept: number[] = [];
    const done = await runImport(rowsOf(10), submit, { signal: new AbortController().signal, onProgress: () => {}, sleep: async (ms) => void slept.push(ms) });
    expect(done).toMatchObject({ state: 'done', done: 10 });
    expect(slept).toEqual([2000, 2000]);
  });

  it('pauses when the address search stops answering, and continues where it stopped', async () => {
    let down = true;
    const submit: SubmitBatch = async ({ rows }) => ({ results: rows.map((r) => ({ row: r.row, status: down ? 'pending' : 'created' })), remaining: 1000 });
    const results = new Map();
    const paused = await runImport(rowsOf(10), submit, { signal: new AbortController().signal, onProgress: () => {}, results, sleep: async () => {} });
    expect(paused.state).toBe('paused');
    expect(paused.message).toMatch(/Adressökningen svarar inte/);
    down = false;
    const resumed = await runImport(rowsOf(10), submit, { signal: new AbortController().signal, onProgress: () => {}, results, sleep: async () => {} });
    expect(resumed).toMatchObject({ state: 'done', done: 10 });
  });
});

describe('import dialog (S-28)', () => {
  it('shows the preview, imports with a status per row and hands over the positions to check', async () => {
    const onClose = vi.fn();
    render(<PropertyImportDialog submit={createDemoImport({ msPerSearch: 0 })} existingAddresses={['Kungsgatan 1, Stockholm']} demo onClose={onClose} />);
    const lines = ['Namn\tAdress', 'Kontoret\tSveavägen 42, Stockholm', 'Finns\tKungsgatan 1, Stockholm', 'Dubbel\tsveavägen 42, stockholm', ...Array.from({ length: 40 }, (_, i) => `Hus ${i}\tStorgatan ${i + 1}, Umeå`)];
    fireEvent.change(screen.getByLabelText('Rader att importera'), { target: { value: lines.join('\n') } });

    const summary = await screen.findByText(/klara att importera/);
    expect(summary.parentElement!.textContent).toContain('43 rader');
    expect(summary.textContent).toBe('41 klara att importera');
    expect(screen.getByText('finns redan eller är dubbletter').textContent).toBe('2 finns redan eller är dubbletter');
    expect(screen.getByText(/Inga SMS-regler slås på/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Importera 41 fastigheter' }));
    await screen.findByText(/^Klart – \d+ fastigheter skapade/, {}, { timeout: 3000 });
    expect(screen.getByText(/\d+ väntar på positionskontroll/)).toBeTruthy();
    const table = screen.getByRole('table');
    // Created – with a building hit, or a street hit to check (the simulation decides by the address).
    expect(within(table).getByText('Kontoret').closest('tr')!.textContent).toMatch(/Skapad|Kontrollera positionSveavägen 42, Stockholm, Sverige · gata/);
    expect(within(table).getByText('Finns').closest('tr')!.textContent).toContain('Finns redan');
    expect(within(table).getByText('Dubbel').closest('tr')!.textContent).toContain('Samma adress som rad 2');

    // The demo simulation sends some to the review list; they are handed over on close.
    fireEvent.click(screen.getByRole('button', { name: 'Klar' }));
    const outcome = onClose.mock.calls[0]![0] as { created: number; review: PositionReviewItem[] };
    expect(outcome.created).toBeGreaterThan(30);
    expect(outcome.review.every((r) => r.precision === 'street')).toBe(true);
  });

  it('asks for a CSV file instead of an Excel workbook', async () => {
    render(<PropertyImportDialog submit={createDemoImport()} existingAddresses={[]} demo={false} onClose={() => {}} />);
    const file = new File(['x'], 'fastigheter.xlsx');
    fireEvent.change(document.getElementById('import-file')!, { target: { files: [file] } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Spara som CSV/);
  });
});

const items: PositionReviewItem[] = Array.from({ length: 12 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  name: `Gatan ${i + 1}`,
  address: `Gatan ${i + 1}, Uppsala`,
  label: 'Gatan, 753 20 Uppsala, Sverige',
  precision: 'street',
  location: { lat: 59.86, lon: 17.64 },
}));

describe('review list for uncertain positions (S-28)', () => {
  it('lists the first ten and opens the map editor to confirm the pin', () => {
    const onAdjust = vi.fn();
    render(<PositionReviewList items={items} editable onAdjust={onAdjust} />);
    expect(screen.getByText('Kontrollera position (12)')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Visa alla 12' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(screen.getAllByText(/Gatan 1, Uppsala → Gatan, 753 20 Uppsala, Sverige · träffade gatan/)).toHaveLength(1);
    // A label that only adds postcode and country is not repeated.
    cleanup();
    render(<PositionReviewList items={[{ ...items[0]!, label: 'Gatan 1, 753 20 Uppsala, Sverige' }]} editable onAdjust={() => {}} />);
    expect(screen.getByText(/Gatan 1, Uppsala · träffade gatan/)).toBeTruthy();
    cleanup();
    render(<PositionReviewList items={items} editable onAdjust={onAdjust} />);
    fireEvent.click(screen.getByRole('button', { name: 'Visa alla 12' }));

    fireEvent.click(within(screen.getAllByRole('listitem')[0]!).getByRole('button', { name: 'Kontrollera på kartan' }));
    expect(onAdjust).toHaveBeenCalledWith(items[0]!.id);
    expect(screen.queryByRole('button', { name: /^Stämmer$/ })).toBeNull();
  });

  it('does not let demo imports edit a saved position', () => {
    render(<PositionReviewList items={items.slice(0, 2)} editable={false} onAdjust={() => {}} />);
    expect(screen.getAllByRole('button', { name: 'Kontrollera på kartan' }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('renders nothing when every position is confirmed', () => {
    const { container } = render(<PositionReviewList items={[]} editable onAdjust={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});
