// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const refresh = vi.fn();
const signOut = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@clerk/nextjs', () => ({ useClerk: () => ({ signOut }) }));

import { LEGAL_VERSIONS, type LegalAcceptanceStatus } from '@fastighetsradar/domain';
import { SiteFooter } from '@/components/landing/SiteChrome';
import { LegalAcceptanceGate } from '@/components/legal/LegalAcceptanceGate';
import { LegalPage } from '@/components/legal/LegalPage';
import { CookiesDocument } from '@/components/legal/documents/CookiesDocument';
import { DataSourcesDocument } from '@/components/legal/documents/DataSourcesDocument';
import { DpaDocument } from '@/components/legal/documents/DpaDocument';
import { PrivacyDocument } from '@/components/legal/documents/PrivacyDocument';
import { TermsDocument } from '@/components/legal/documents/TermsDocument';
import { acknowledgementReport } from '@/lib/acknowledgements/pdf';
import { legalDomain, missingLegalFields } from '@/lib/legal/company';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refresh.mockReset();
});

describe('legal pages', () => {
  it.each([
    ['Användarvillkor', <TermsDocument key="t" domain="fastighetsradar.test" />, 'Ej säkerhetsklassat larmsystem'],
    ['Integritetspolicy', <PrivacyDocument key="p" domain="fastighetsradar.test" />, 'Integritetsskyddsmyndigheten'],
    ['Cookies i FastighetsRadar', <CookiesDocument key="c" domain="fastighetsradar.test" />, 'ingen cookie-banner'],
    ['PUB-avtal', <DpaDocument key="d" />, 'personuppgiftsincident'],
    ['Datakällor, licenser och metod', <DataSourcesDocument key="e" />, 'inte</strong> en officiell myndighetsbedömning'],
  ])('renders %s inside the public site chrome', (title, doc, phrase) => {
    const { container } = render(<LegalPage signedIn={false} eyebrow="Juridik" title={title}>{doc}</LegalPage>);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Huvudmeny' })).toBeTruthy();
    expect(container.innerHTML.toLowerCase()).toContain(phrase.toLowerCase());
  });

  it('shows placeholders for company details that are not decided yet', () => {
    render(<TermsDocument domain="fastighetsradar.test" />);
    expect(screen.getAllByText('[ORG_NR]').length).toBeGreaterThan(0);
    expect(screen.getAllByText('[FÖRETAGSNAMN]').length).toBeGreaterThan(0);
    expect(missingLegalFields()).toContain('orgNumber');
    expect(missingLegalFields()).not.toContain('smsProvider');
  });

  it('prints the data processing agreement', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<LegalPage signedIn={false} eyebrow="Juridik" title="PUB-avtal" printable><DpaDocument /></LegalPage>);
    fireEvent.click(screen.getByRole('button', { name: 'Skriv ut / Spara som PDF' }));
    expect(print).toHaveBeenCalled();
  });

  it('uses the configured domain, otherwise the host the site runs on', () => {
    expect(legalDomain('https://f-radar.fr-2.instapods.app')).toBe('f-radar.fr-2.instapods.app');
    expect(legalDomain(undefined)).toBe('[DOMÄN]');
  });
});

describe('site footer', () => {
  it('links every legal document and shows the company and data lines', () => {
    render(<SiteFooter page="legal" />);
    const nav = screen.getByRole('navigation', { name: 'Sidfot' });
    const href = (name: string) => within(nav).getByRole('link', { name }).getAttribute('href');
    expect([href('Användarvillkor'), href('Integritetspolicy'), href('Cookies'), href('PUB-avtal'), href('Datakällor')])
      .toEqual(['/villkor', '/integritetspolicy', '/cookies', '/pub-avtal', '/datakallor']);
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).toContain('Org.nr [ORG_NR] · [GATUADRESS], [POSTNR_ORT] · [SUPPORT_EPOST]');
    expect(footer.textContent).toContain('MET Norway (CC BY 4.0). Kartdata © OpenStreetMap-bidragsgivare, drivs av Geoapify.');
    expect(footer.textContent).not.toContain('F-skatt');
  });
});

const status = (over: Partial<LegalAcceptanceStatus> = {}): LegalAcceptanceStatus => ({
  termsVersion: null, termsAcceptedAt: null, privacyVersion: null, privacyAcceptedAt: null, acceptedByUserId: null, current: false, canAccept: true, ...over,
});

describe('LegalAcceptanceGate', () => {
  it('copies the sign-up acceptance to the organization without showing anything', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await act(async () => {
      render(<LegalAcceptanceGate status={status()} signupAcceptedAt="2026-11-21T11:58:00.000Z" />);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/app/legal/acceptance');
    expect(JSON.parse(String(init!.body))).toEqual({ termsVersion: LEGAL_VERSIONS.terms, privacyVersion: LEGAL_VERSIONS.privacy, acceptedAt: '2026-11-21T11:58:00.000Z' });
  });

  it('asks an administrator once when the organization has not accepted', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    render(<LegalAcceptanceGate status={status()} signupAcceptedAt={null} />);
    const dialog = screen.getByRole('dialog', { name: 'Godkänn villkoren för er organisation' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Godkänn och fortsätt' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Kryssa i rutan för att fortsätta.');
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Godkänn och fortsätt' }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it('never blocks members, organizations that have accepted, or a missing status', () => {
    const { rerender } = render(<LegalAcceptanceGate status={status({ canAccept: false })} signupAcceptedAt={null} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<LegalAcceptanceGate status={status({ current: true })} signupAcceptedAt={null} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<LegalAcceptanceGate status={null} signupAcceptedAt={null} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('PDF export', () => {
  it('states who generated the report and where the terms are', () => {
    const report = acknowledgementReport([], 'Brf Exempel', 'Alla datum', false, '2026-11-21T12:00:00Z', 'compact', 'fastighetsradar.test');
    const footer = (report.footer as (p: number, t: number) => { columns: Array<{ text: string }> })(1, 2);
    expect(footer.columns[0]!.text).toBe('Genererad av FastighetsRadar ([FÖRETAGSNAMN]) · Informations- och beslutsstöd baserat på externa datakällor. Se fastighetsradar.test/villkor.');
    expect(footer.columns[1]!.text).toBe('Sida 1 av 2');
  });
});
