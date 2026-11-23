// @vitest-environment jsdom
import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import { afterEach, expect, it, vi } from 'vitest';
import { PropertyEditorDialog } from '@/components/properties/PropertyEditorDialog';
import { buildDetailVM } from '@/lib/view-models/detail';

vi.mock('@/components/maps/LocationPickerMap', () => ({
  LocationPickerMap: ({ onReady, onChange }: { onReady: () => void; onChange: (p: { lat: number; lon: number }) => void }) => {
    useEffect(() => onReady(), [onReady]);
    return <button type="button" onClick={() => onChange({ lat: 59.3831, lon: 17.909 })}>Flytta nålen</button>;
  },
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const renderCreate = () => render(<PropertyEditorDialog mode={{ kind: 'create' }} onClose={() => {}} onSaved={() => {}} />);
const saveButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /^Spara/ });
const confirmPin = async () => {
  const confirm = await screen.findByRole<HTMLButtonElement>('button', { name: 'Bekräfta position' });
  await waitFor(() => expect(confirm.disabled).toBe(false));
  fireEvent.click(confirm);
};

it('requires confirmation again after moving a pin and saves the explicitly confirmed location', async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
    ? Response.json({ property: { id: 'saved' } })
    : Response.json({ status: 'ok', attribution: 'Geoapify', suggestions: [{ label: 'Spånga, Stockholm', lat: 59.383, lon: 17.908, precision: 'approximate', provider: 'geoapify' }] }));
  vi.stubGlobal('fetch', fetcher);
  renderCreate();
  fireEvent.change(screen.getByRole('combobox', { name: 'Adress' }), { target: { value: 'Spånga' } });
  fireEvent.click(await screen.findByRole('option', { name: /Spånga, Stockholm/ }));
  expect(screen.getByText(/Lägg gärna till gata och husnummer/)).toBeTruthy();
  expect(saveButton().disabled).toBe(true);
  await confirmPin();
  expect(saveButton().disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Flytta nålen' }));
  expect(saveButton().disabled).toBe(true);
  await confirmPin();
  fireEvent.click(saveButton());
  const post = fetcher.mock.calls.find(([_url, options]) => options?.method === 'POST');
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
    positionConfirmed: true, location: { lat: 59.3831, lon: 17.909 }, geocode: { precision: 'approximate' },
  });
});

it('requires confirmation of a manual pin and clears it if the address changes', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'ok', attribution: '', suggestions: [] })));
  renderCreate();
  fireEvent.change(screen.getByLabelText('Fastighetens namn'), { target: { value: 'Huset' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Adress' }), { target: { value: 'Spånga' } });
  fireEvent.click(screen.getByRole('button', { name: /Placera nålen manuellt/ }));
  expect(saveButton().disabled).toBe(true);
  await confirmPin();
  expect(saveButton().disabled).toBe(false);
  fireEvent.change(screen.getByRole('combobox', { name: 'Adress' }), { target: { value: 'Trossö' } });
  expect(saveButton().disabled).toBe(true);
});

it('treats a manually adjusted street hit as confirmed in the editor and on the property page', () => {
  const s = demoPortfolio.properties[0]!;
  const snapshot = {
    ...s,
    property: { ...s.property, positionSource: 'manual_adjusted' as const, geocode: { ...s.property.geocode, provider: 'geoapify' as const, precision: 'street' as const } },
  };
  const d = buildDetailVM(demoPortfolio, snapshot, { ready: true, metric: 'temp', smsOn: false, isRuleOn: (_, value) => value });
  render(<><span title={d.positionNote}>Fastighetens koordinater</span><PropertyEditorDialog mode={{ kind: 'edit', snapshot }} onClose={() => {}} onSaved={() => {}} /></>);
  expect(screen.getByTitle('Bekräftad position')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Bekräfta position' })).toBeNull();
  expect(document.body.innerHTML).not.toMatch(/ungefärlig position|ungefärlig adresspunkt|position att kontrollera/i);
  fireEvent.change(screen.getByLabelText('Fastighetens namn'), { target: { value: 'Nytt namn' } });
  expect(saveButton().disabled).toBe(false);
});
