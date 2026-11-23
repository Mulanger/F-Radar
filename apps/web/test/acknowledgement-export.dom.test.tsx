// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AcknowledgementHistory } from '@/components/acknowledgements/AcknowledgementHistory';
import { acknowledgementCsv, acknowledgementReport } from '@/lib/acknowledgements/pdf';
import { demoAcknowledgements } from '@/lib/demo/acknowledgements';

const { download, refresh } = vi.hoisted(() => ({ download: vi.fn(async () => {}), refresh: vi.fn() }));
vi.mock('@/lib/acknowledgements/pdf', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/acknowledgements/pdf')>(),
  downloadAcknowledgementReport: download,
}));
vi.mock('@/lib/state/dashboard-state', () => ({ useDashboard: () => ({ portfolio: { organizationName: 'Demoportfölj' }, refresh }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('undoes the selected history id, keeps the row and exports the undo time', async () => {
  const entry = demoAcknowledgements[0]!;
  const undoneAt = '2026-11-20T10:15:00Z';
  let undone = false;
  const request = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      undone = true;
      return Response.json({ id: entry.id, undoneAt });
    }
    // The report reads the whole selection from the server in one request (Fas 2 / S-08).
    const entries = [undone ? { ...entry, undoneAt } : entry, demoAcknowledgements[2]];
    return url.startsWith('/api/app/feed/acknowledgements/export')
      ? Response.json({ entries, truncated: false })
      : Response.json({ entries, properties: [], nextCursor: null });
  });
  vi.stubGlobal('fetch', request);
  render(<AcknowledgementHistory />);

  const undo = await screen.findByRole('button', { name: `Ångra kvittering: ${entry.title} · ${entry.propertyName}` });
  expect(screen.getAllByRole('button', { name: /^Ångra kvittering:/ })).toHaveLength(1);
  fireEvent.click(undo);
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledWith(`/api/app/feed/acknowledgements/${entry.id}/undo`, { method: 'POST' });
  expect(screen.queryByRole('button', { name: /^Ångra kvittering:/ })).toBeNull();
  const details = screen.getByRole('button', { name: new RegExp(`${entry.title}.*Ångrad`) });
  fireEvent.click(details);
  expect(document.querySelector(`time[datetime="${undoneAt}"]`)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ladda ner PDF' }));
  await waitFor(() => expect(download).toHaveBeenCalledWith(
    [{ ...entry, undoneAt }, demoAcknowledgements[2]], 'Demoportfölj', 'Alla datum · Alla fastigheter', false, 'compact',
  ));
  expect(request.mock.calls.filter(([url]) => String(url).startsWith('/api/app/feed/acknowledgements/export'))).toHaveLength(1);
});

it('defaults to a short list and exports every matching page in both formats', async () => {
  const sample = demoAcknowledgements[2]!;
  const matching = Array.from({ length: 33 }, (_, i) => ({ ...sample, id: `entry-${i}`, title: `Händelse ${i + 1}` }));
  render(<AcknowledgementHistory demoEntries={[
    { ...sample, id: 'other-day', acknowledgedAt: '2026-11-19T11:00:00Z' },
    demoAcknowledgements[1]!,
    ...matching,
  ]} />);

  const format = screen.getByRole<HTMLSelectElement>('combobox', { name: 'PDF-format' });
  const button = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Ladda ner PDF' });
  expect(format.value).toBe('compact');
  fireEvent.input(screen.getByLabelText('Från datum'), { target: { value: '2026-11-18' } });
  fireEvent.input(screen.getByLabelText('Till datum'), { target: { value: '2026-11-18' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Fastighet' }), { target: { value: sample.propertyId } });
  fireEvent.click(screen.getByRole('button', { name: 'Filtrera' }));

  await waitFor(() => expect(button().disabled).toBe(false));
  expect(screen.queryByText('Händelse 33')).toBeNull();
  const selection = 'Från 2026-11-18 · Till 2026-11-18 · Sjöstaden Kaj';
  fireEvent.click(button());
  await waitFor(() => expect(download).toHaveBeenNthCalledWith(1, matching, 'Demoportfölj', selection, true, 'compact'));
  await waitFor(() => expect(button().disabled).toBe(false));
  fireEvent.change(format, { target: { value: 'full' } });
  fireEvent.click(button());
  await waitFor(() => expect(download).toHaveBeenNthCalledWith(2, matching, 'Demoportfölj', selection, true, 'full'));
});

it('renders a single compact table row per acknowledgement and leaves long text to the full report', () => {
  const sample = demoAcknowledgements[2]!;
  const compact = acknowledgementReport([sample], 'Demoportfölj', 'Alla datum', true, sample.acknowledgedAt, 'compact');
  const full = acknowledgementReport([sample], 'Demoportfölj', 'Alla datum', true, sample.acknowledgedAt, 'full');
  expect(compact.content).toContainEqual(expect.objectContaining({
    table: expect.objectContaining({
      headerRows: 1,
      body: [
        ['Händelse', 'Fastighet', 'Kvitterad tid', 'Status'].map((text) => ({ text, bold: true })),
        [sample.title, sample.propertyName, '18 nov. 2026 09:04', 'Ångrad'],
      ],
    }),
  }));
  expect(JSON.stringify(compact.content)).not.toContain(sample.description);
  expect(JSON.stringify(full.content)).toContain(sample.description);
});

it('writes each event once in the report – 3 000 acknowledgements over 10 events (Fas 2 / S-08)', () => {
  const sample = demoAcknowledgements[2]!;
  const entries = Array.from({ length: 3_000 }, (_, i) => ({
    ...sample, id: `e-${i}`, propertyId: `p-${i % 300}`, propertyName: `Fastighet ${i % 300}`, undoneAt: null,
    title: `Länsvarning ${Math.floor(i / 300)}`, description: `Varningstext ${Math.floor(i / 300)}`, eventAt: `2026-11-${10 + Math.floor(i / 300)}T06:00:00Z`,
  }));
  const compact = acknowledgementReport(entries, 'Demoportfölj', 'Alla datum', true, sample.acknowledgedAt, 'compact');
  const table = (compact.content as Array<{ table?: { body: unknown[][] } }>).find((c) => c.table)!;
  expect(table.table!.body).toHaveLength(11);
  expect(table.table!.body[1]![1]).toBe('300 fastigheter');
  const full = JSON.stringify(acknowledgementReport(entries, 'Demoportfölj', 'Alla datum', true, sample.acknowledgedAt, 'full').content);
  expect(full.split('Varningstext 3"').length - 1).toBe(1);
  expect(full).toContain('3000 kvitteringar · 10 händelser');
  expect(full).toContain('Kvitterad för 300 fastigheter');
});

it('says when the selection was larger than the report', () => {
  const sample = demoAcknowledgements[2]!;
  const report = acknowledgementReport([sample], 'Demoportfölj', 'Alla datum', true, sample.acknowledgedAt, 'compact', 'fastighetsradar.test', true);
  expect(JSON.stringify(report.content)).toContain('rapporten tar med de 10000 senaste');
});

it('exports one CSV row per property, readable by Excel with Swedish settings', () => {
  const sample = { ...demoAcknowledgements[2]!, title: 'Varning "kraftig vind"; kust' };
  const csv = acknowledgementCsv([sample, { ...sample, id: 'x', propertyName: 'Strandhuset' }]);
  expect(csv.startsWith('﻿"Händelse";"Källa"')).toBe(true);
  const lines = csv.trim().split('\r\n');
  expect(lines).toHaveLength(3);
  expect(lines[1]).toContain('"Varning ""kraftig vind""; kust"');
  expect(lines[2]).toContain('"Strandhuset"');
});

it('keeps the PDF worker from importing the module that starts it (the production build looped on that)', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const file = (name: string) => readFileSync(resolve(process.cwd(), 'apps/web/lib/acknowledgements', name), 'utf8');
  const worker = file('pdf.worker.ts');
  expect(worker).toContain("from './report'");
  expect(worker).not.toMatch(/from '\.\/pdf'/);
  const report = file('report.ts');
  expect(report).not.toContain('new Worker(');
});

