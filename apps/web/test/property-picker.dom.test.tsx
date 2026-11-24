// @vitest-environment jsdom
/**
 * Fas 1 (docs/plans/skalning.md, S-01/S-02): the shared property picker, Snabbväxla and the header
 * search (command palette) with a 500-property test portfolio.
 */
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { demoPortfolio, scaleDemoPortfolio } from '@fastighetsradar/domain/fixtures';
import { DashboardStateProvider } from '@/lib/state/dashboard-state';
import { PICKER_MAX_ROWS, PropertyPicker, matchProperties, pickerSearchText, sortForPicker } from '@/components/properties/PropertyPicker';
import { Header } from '@/components/shell/Header';

const nav = vi.hoisted(() => ({ pathname: '/demo/overview', router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() } }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => nav.router, useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props} /> }));
vi.mock('@/components/properties/PropertyEditorHost', () => ({ usePropertyEditor: () => ({ enabled: false, openCreate: () => {}, openEdit: () => {} }) }));

const big = scaleDemoPortfolio(demoPortfolio, 500);
const nameOf = (o: HTMLElement) => o.querySelector(':scope > div > div')!.textContent;
const scrolled: string[] = [];

beforeEach(() => {
  window.localStorage.clear();
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id); };
});
afterEach(() => {
  cleanup();
  nav.router.push.mockClear();
});

function picker(props: Partial<React.ComponentProps<typeof PropertyPicker>> = {}) {
  const onSelect = vi.fn();
  const view = render(
    <DashboardStateProvider mode="demo" basePath="/demo" portfolio={big}>
      <PropertyPicker variant="status" onSelect={onSelect} {...props} />
    </DashboardStateProvider>,
  );
  const input = screen.getByRole('combobox');
  const active = () => document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
  return { ...view, onSelect, input, active };
}

describe('PropertyPicker', () => {
  it('shows the rain time in the option and the radar credit below the list', () => {
    render(
      <DashboardStateProvider mode="demo" basePath="/demo" portfolio={demoPortfolio}>
        <PropertyPicker variant="status" onSelect={vi.fn()} />
      </DashboardStateProvider>,
    );
    const options = screen.getByRole('listbox');
    expect(within(options).getByText(/^(Regn|Nederbörd) om ~25 min$/)).toBeTruthy();
    expect(options.textContent).not.toContain('MET Norway');
    const credit = screen.getByRole('link', { name: 'CC BY 4.0' });
    expect(options.contains(credit)).toBe(false);
    expect(credit.parentElement?.textContent).toContain('MET Norway · bearbetad av FastighetsRadar');
  });

  it('renders at most 100 rows of 500, worst status first, and says how to find the rest', () => {
    const { input } = picker();
    expect(document.activeElement).toBe(input);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(PICKER_MAX_ROWS);
    expect(screen.getByText(`Visar ${PICKER_MAX_ROWS} av 500 – skriv för att söka`)).toBeTruthy();
    const firstStatus = big.properties.find((s) => s.property.name === nameOf(options[0]!))!.property.status;
    expect(firstStatus).toBe('critical');
  });

  it('searches name, address, area and municipality case-insensitively with å, ä and ö', () => {
    const { input } = picker();
    fireEvent.change(input, { target: { value: 'GÖTGÅRDEN 17' } });
    expect(screen.getAllByRole('option').map(nameOf)).toEqual(['Götgården 17']);
    fireEvent.change(input, { target: { value: 'götgatan 17' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.change(input, { target: { value: 'täby' } });
    const taby = big.properties.filter((s) => s.property.area === 'Täby').length;
    expect(taby).toBeGreaterThan(0);
    expect(screen.getAllByRole('option')).toHaveLength(Math.min(taby, PICKER_MAX_ROWS));
    fireEvent.change(input, { target: { value: 'finns inte någonstans' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Inga fastigheter matchar ”finns inte någonstans”.')).toBeTruthy();
  });

  it('moves with the arrow keys and opens the active property with Enter', () => {
    const { input, active, onSelect } = picker();
    const options = screen.getAllByRole('option');
    expect(active()).toBe(options[0]);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(active()).toBe(options[2]);
    expect(options[2]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(active()).toBe(options[1]);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(active()).toBe(options[0]);
    fireEvent.keyDown(input, { key: 'Enter' });
    const sorted = sortForPicker(big.properties);
    expect(onSelect).toHaveBeenCalledWith(sorted[0]!.property.id);
  });

  it('starts at the current property and scrolls it into view', () => {
    const sorted = sortForPicker(big.properties);
    const current = sorted[42]!;
    const { active } = picker({ variant: 'risk', currentId: current.property.id });
    expect(active()?.getAttribute('aria-current')).toBe('true');
    expect(active()?.textContent).toContain(current.property.name);
    expect(active()?.textContent).toContain('Risk');
    expect(scrolled.at(-1)).toBe(active()!.id);
  });

  it('lists recently opened properties first when the search is empty', () => {
    const sorted = sortForPicker(big.properties);
    const pick = sorted[300]!;
    const first = picker();
    fireEvent.change(first.input, { target: { value: pick.property.name } });
    fireEvent.keyDown(first.input, { key: 'Enter' });
    expect(first.onSelect).toHaveBeenCalledWith(pick.property.id);
    cleanup();

    picker();
    const recent = screen.getByRole('group', { name: 'Senast besökta' });
    expect(within(recent).getAllByRole('option').map(nameOf)).toEqual([pick.property.name]);
    expect(screen.getAllByRole('option')).toHaveLength(PICKER_MAX_ROWS);
  });

  it('keeps working when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { input, onSelect } = picker();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('matches every word of the query', () => {
    const sorted = sortForPicker(big.properties);
    const texts = new Map(big.properties.map((s) => [s.property.id, pickerSearchText(s)]));
    const sample = big.properties[123]!.property;
    const [word] = sample.name.split(' ');
    const hits = matchProperties(sorted, texts, `  ${word!.toUpperCase()}   ${sample.area} `);
    expect(hits.map((s) => s.property.id)).toContain(sample.id);
    expect(hits.every((s) => pickerSearchText(s).includes(word!.toLocaleLowerCase('sv-SE')) && pickerSearchText(s).includes(sample.area.toLocaleLowerCase('sv-SE')))).toBe(true);
    expect(matchProperties(sorted, texts, '   ')).toBe(sorted);
    // The exact name first, then names starting with the query, then other hits.
    const torg = matchProperties(sorted, texts, 'torsviks  TORG 4').map((s) => s.property.name);
    expect(torg[0]).toBe('Torsviks Torg 4');
    expect(torg.slice(1, 11).every((n) => n.startsWith('Torsviks Torg 4'))).toBe(true);
    expect(torg).toContain('Torsviks Torg 14');
  });
});

function header() {
  return render(
    <DashboardStateProvider mode="demo" basePath="/demo" portfolio={big}>
      <Header />
    </DashboardStateProvider>,
  );
}

describe('header search and Snabbväxla', () => {
  it('opens the property search with Ctrl+K, finds a property by address and opens it', () => {
    header();
    expect(screen.queryByRole('dialog', { name: 'Sök fastigheter' })).toBeNull();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = screen.getByRole('dialog', { name: 'Sök fastigheter' });
    const input = within(dialog).getByRole('combobox');
    expect(document.activeElement).toBe(input);
    const target = big.properties.find((s) => s.property.name === 'Strandhuset 50')!;
    fireEvent.change(input, { target: { value: target.property.address.split(',')[0] } });
    expect(within(dialog).getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByRole('dialog', { name: 'Sök fastigheter' })).toBeNull();
    expect(nav.router.push).toHaveBeenCalledWith(expect.stringContaining(`/demo/properties/${encodeURIComponent(target.property.id)}`));
  });

  it('opens from the search field, closes with Esc and returns focus', () => {
    header();
    const trigger = screen.getByRole('button', { name: /Sök fastigheter/ });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Sök fastigheter' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Sök fastigheter' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('Snabbväxla shows a short searchable list and closes with Esc', () => {
    header();
    fireEvent.click(screen.getByRole('button', { name: /Snabbväxla/ }));
    expect(screen.getAllByRole('option')).toHaveLength(PICKER_MAX_ROWS);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Ulvsunda Lager 62' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
