// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AcknowledgementHistory } from '@/components/acknowledgements/AcknowledgementHistory';
import { acknowledgementReport } from '@/lib/acknowledgements/pdf';
import { demoAcknowledgements } from '@/lib/demo/acknowledgements';

const download = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/acknowledgements/pdf', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/acknowledgements/pdf')>(),
  downloadAcknowledgementReport: download,
}));
vi.mock('@/lib/state/dashboard-state', () => ({ useDashboard: () => ({ portfolio: { organizationName: 'Demoportfölj' } }) }));
afterEach(() => { cleanup(); download.mockClear(); });

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
