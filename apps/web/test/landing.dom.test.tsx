// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
// WebGL is not available in jsdom; the hero must render its HTML without the 3D scene.
vi.mock('@/components/landing/hero-scene', () => ({
  createLandingScene: () => {
    throw new Error('no webgl');
  },
}));

import { LandingPage } from '@/components/landing/LandingPage';
import { readSignupEmail, SIGNUP_EMAIL_KEY } from '@/lib/landing/signup-email';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // jsdom has no 2D canvas; the water animation must simply skip drawing.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  sessionStorage.clear();
  push.mockReset();
});
afterEach(cleanup);

describe('LandingPage (signed out)', () => {
  it('does not promise flood thresholds, basement risk, unsupported boats or a numeric 0–100 AQI', () => {
    const { container } = render(<LandingPage signedIn={false} />);
    const text = container.textContent!;
    expect(text).not.toContain('Översvämningsgräns +60 cm');
    expect(text).not.toContain('Källarrisk');
    expect(text).not.toContain('Färjetrafik inställd');
    expect(text).not.toContain('Luftkvalitet 26');
    expect(text).not.toContain('26 Bra');
    expect(text).not.toContain('radie 1 km');
    expect(text).not.toContain('SL-färjor');
    expect(text).not.toContain('Filtrera per område');
    expect(text).toContain('Grundvatten: regional modell och närmaste mätstation');
    expect(text).toContain('larmradien 2 km');
    expect(text).toContain('Nacka kommun');
    expect(text).toContain('relativt medelvattenstånd');
  });
  it('renders the Swedish headline and every section the navigation points to', () => {
    const { container } = render(<LandingPage signedIn={false} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Allt som påverkar dina fastigheter/);
    const nav = screen.getByRole('navigation', { name: 'Huvudmeny' });
    for (const link of within(nav).getAllByRole('link')) {
      const href = link.getAttribute('href')!;
      if (href.startsWith('#')) expect(container.querySelector(href), href).not.toBeNull();
    }
    for (const id of ['sa-fungerar-det', 'funktioner', 'sms', 'data', 'kom-igang']) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
  });

  it('sends visitors to sign-in and sign-up', () => {
    render(<LandingPage signedIn={false} />);
    const nav = screen.getByRole('navigation', { name: 'Huvudmeny' });
    expect(within(nav).getByRole('link', { name: 'Logga in' }).getAttribute('href')).toBe('/sign-in');
    expect(within(nav).getByRole('link', { name: 'Skapa konto' }).getAttribute('href')).toBe('/sign-up');
    expect(screen.queryByRole('link', { name: /Öppna översikten/ })).toBeNull();
    const hero = screen.getByRole('region', { name: 'Introduktion' });
    expect(within(hero).getByRole('link', { name: /Skapa konto/ }).getAttribute('href')).toBe('/sign-up');
  });

  it('has no dead links', () => {
    render(<LandingPage signedIn={false} />);
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href'), link.textContent ?? '').not.toBe('#');
    }
  });

  it('hands the e-mail to the sign-up page without putting it in the URL', () => {
    render(<LandingPage signedIn={false} />);
    fireEvent.change(screen.getByLabelText('E-postadress'), { target: { value: '  anna@exempel.se ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skapa konto' }));
    expect(push).toHaveBeenCalledWith('/sign-up');
    expect(sessionStorage.getItem(SIGNUP_EMAIL_KEY)).toBe('anna@exempel.se');
    expect(readSignupEmail()).toBe('anna@exempel.se');
  });

  it('lets visitors try the SMS rules', () => {
    render(<LandingPage signedIn={false} />);
    expect(screen.getByText('Du får SMS vid orange och röd varning.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Orange' }));
    expect(screen.getByText('Du får SMS vid röd varning.')).toBeTruthy();
    expect(screen.getByText(/aktuella varningar ligger under vald nivå/)).toBeTruthy();
    const quiet = screen.getByRole('switch', { name: 'Tysta timmar' });
    const before = quiet.getAttribute('aria-checked');
    fireEvent.click(quiet);
    expect(quiet.getAttribute('aria-checked')).not.toBe(before);
  });

  it('switches the forecast chart', () => {
    render(<LandingPage signedIn={false} />);
    const tab = screen.getByRole('tab', { name: 'Vind' });
    fireEvent.click(tab);
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('img', { name: /Prognosdiagram: Vind/ })).toBeTruthy();
  });
});

describe('LandingPage (signed in)', () => {
  it('replaces the sign-up calls to action with the dashboard', () => {
    render(<LandingPage signedIn />);
    const links = screen.getAllByRole('link', { name: 'Öppna översikten' });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.getAttribute('href')).toBe('/overview');
    expect(screen.queryByLabelText('E-postadress')).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Huvudmeny' });
    expect(within(nav).queryByRole('link', { name: 'Skapa konto' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Logga in' })).toBeNull();
    const hero = screen.getByRole('region', { name: 'Introduktion' });
    expect(within(hero).getByRole('link', { name: /Öppna översikten/ }).getAttribute('href')).toBe('/overview');
  });
});
