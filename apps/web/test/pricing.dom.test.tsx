// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: null as null | { fullName: string; primaryEmailAddress: { emailAddress: string } } }));
vi.mock('@clerk/nextjs', () => ({ useUser: () => ({ user: mocks.user }) }));

import { PricingPage } from '@/components/pricing/PricingPage';
import { LOOKUP_DELAY_MS } from '@/lib/pricing/org-lookup';

const NBSP = String.fromCharCode(0xa0);
const plain = (s: string | null | undefined) => (s ?? '').split(NBSP).join(' ');
const card = (name: string) => screen.getByRole('heading', { level: 3, name }).closest('article') as HTMLElement;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.user = null;
  document.body.style.overflow = '';
});

describe('PricingPage', () => {
  it('defaults to yearly invoicing and updates cards and table when switching to quarterly', () => {
    render(<PricingPage signedIn={false} />);
    const [heroToggle] = screen.getAllByRole('radiogroup', { name: 'Faktureringsintervall' });
    expect(within(heroToggle!).getByRole('radio', { name: /Årsfaktura/ }).getAttribute('aria-checked')).toBe('true');
    expect(plain(card('Pro').textContent)).toContain('575 kr');
    expect(plain(card('Pro').textContent)).toContain('Faktureras årsvis (6 900 kr/år exkl. moms)');

    fireEvent.click(within(heroToggle!).getByRole('radio', { name: 'Kvartalsfaktura' }));
    expect(plain(card('Start').textContent)).toContain('249 kr');
    expect(plain(card('Pro').textContent)).toContain('690 kr');
    expect(plain(card('Business').textContent)).toContain('1 490 kr');
    const header = screen.getAllByRole('columnheader').map((th) => plain(th.textContent));
    expect(header).toContain('Pro690 kr/mån');
    // Both toggles share the same state.
    const tableToggle = screen.getAllByRole('radiogroup', { name: 'Faktureringsintervall' })[1]!;
    expect(within(tableToggle).getByRole('radio', { name: 'Kvartalsfaktura' }).getAttribute('aria-checked')).toBe('true');
  });

  it('always states that prices exclude VAT and links the free and trial plans to sign-up', () => {
    render(<PricingPage signedIn={false} />);
    for (const name of ['Gratis', 'Start', 'Pro', 'Business']) expect(card(name).textContent).toContain('exkl. moms');
    expect(within(card('Gratis')).getByRole('link', { name: 'Skapa gratiskonto' }).getAttribute('href')).toBe('/sign-up');
    expect(within(card('Pro')).getByRole('link', { name: 'Starta 14 dagar fritt' }).getAttribute('href')).toBe('/sign-up');
  });

  it('marks Priser as the current page and points the other navigation links at the start page', () => {
    render(<PricingPage signedIn={false} />);
    const nav = screen.getByRole('navigation', { name: 'Huvudmeny' });
    expect(within(nav).getByRole('link', { name: 'Priser' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Funktioner' }).getAttribute('href')).toBe('/#funktioner');
  });

  it('collapses comparison categories and opens one FAQ answer at a time', () => {
    render(<PricingPage signedIn={false} />);
    const category = screen.getByRole('button', { name: /SMS-larm & regler/ });
    expect(screen.getByRole('rowheader', { name: 'Skarpa SMS-utskick per månad' })).toBeTruthy();
    fireEvent.click(category);
    expect(category.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('rowheader', { name: 'Skarpa SMS-utskick per månad' })).toBeNull();

    const first = screen.getByRole('button', { name: 'Vad räknas som en fastighet?' });
    const trial = screen.getByRole('button', { name: 'Hur fungerar 14 dagars fri provperiod?' });
    expect(first.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(trial);
    expect(trial.getAttribute('aria-expanded')).toBe('true');
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(first.getAttribute('aria-controls')!)!.hidden).toBe(true);
  });
});

describe('InvoiceModal', () => {
  const openPro = () => {
    render(<PricingPage signedIn />);
    fireEvent.click(within(card('Pro')).getByRole('button', { name: 'beställ direkt mot faktura' }));
    return screen.getByRole('dialog', { name: 'Beställ Pro mot faktura' });
  };

  it('opens with the order summary incl. VAT and closes on Escape', () => {
    const dialog = openPro();
    expect(document.body.style.overflow).toBe('hidden');
    const summary = plain(within(dialog).getByRole('complementary', { name: 'Ordersammanfattning' }).textContent);
    expect(summary).toContain('12 månader (Årsfaktura)');
    expect(summary).toContain('6 900 kr');
    expect(summary).toContain('1 725 kr');
    expect(summary).toContain('8 625 kr');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('looks up the organisation, prefills Peppol and enables ordering once everything is filled in', async () => {
    vi.useFakeTimers();
    mocks.user = { fullName: 'Elin Lindqvist', primaryEmailAddress: { emailAddress: 'elin@example.com' } };
    const dialog = openPro();
    const submit = within(dialog).getByRole('button', { name: 'Aktivera Pro mot faktura' }) as HTMLButtonElement;
    expect((within(dialog).getByLabelText('Namn') as HTMLInputElement).value).toBe('Elin Lindqvist');

    const org = within(dialog).getByLabelText('Organisationsnummer') as HTMLInputElement;
    fireEvent.change(org, { target: { value: '5590000004' } });
    expect(within(dialog).getByText(/kontrollsiffran stämmer inte/)).toBeTruthy();

    fireEvent.change(org, { target: { value: '5590000005' } });
    expect(org.value).toBe('559000-0005');
    expect(within(dialog).getByText('Hämtar företagsuppgifter…')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(LOOKUP_DELAY_MS);
    });
    expect(within(dialog).getByText('Brf Sjöstaden Kaj')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'E-faktura (Peppol)' }));
    expect((within(dialog).getByLabelText('Peppol-ID / GLN') as HTMLInputElement).value).toBe('0007:5590000005');
    expect(submit.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(plain(within(dialog).getByRole('status').textContent)).toContain('Fakturan på 8 625 kr inkl. moms skickas till Peppol-ID 0007:5590000005');
  });

  it('offers monthly invoicing after switching plan to Business', () => {
    const dialog = openPro();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Byt plan' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Business' }));
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe('Beställ Business mot faktura');
    expect(within(dialog).getByRole('radio', { name: /Månadsfaktura/ })).toBeTruthy();
  });
});
