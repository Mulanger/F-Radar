// @vitest-environment jsdom
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import type { PropertySnapshot } from '@fastighetsradar/domain';
import { buildOverviewVM } from '@/lib/view-models/overview';
import { buildDetailVM } from '@/lib/view-models/detail';
import { MobilePortfolioOverview } from '@/components/mobile/MobilePortfolioOverview';
import { MobilePropertyIndex } from '@/components/mobile/MobilePropertyIndex';
import { MobileWeatherChart } from '@/components/mobile/MobileWeatherChart';
import { MobileNavigation } from '@/components/mobile/MobileNavigation';

const mocks = vi.hoisted(() => ({ setGroup: vi.fn(), replace: vi.fn(), matchMobile: true, path: '/demo/overview' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }), usePathname: () => mocks.path }));
vi.mock('next/link', () => ({ default: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props} /> }));
vi.mock('@/components/three/ThreeScene', () => ({ ThreeScene: () => <div data-testid="three-scene" /> }));
vi.mock('@/components/maps/PortfolioMap', () => ({ PortfolioMap: () => <div data-testid="portfolio-map" /> }));
vi.mock('@/components/properties/PropertyEditorHost', () => ({ usePropertyEditor: () => ({ enabled: false, openCreate: vi.fn() }) }));
vi.mock('@/lib/state/dashboard-state', () => ({ useDashboard: () => ({
  portfolio: demoPortfolio, mode: 'demo', ready: true, basePath: '/demo', selectedId: demoPortfolio.properties[0]!.property.id,
  setGroup: mocks.setGroup, layers: { weather: false, flood: true }, toggleLayer: vi.fn(), openProperty: vi.fn(),
  isSmsOn: (s: PropertySnapshot) => s.sms.enabled, isRuleOn: (_id: string, fallback: boolean) => fallback,
}) }));

const ui = { ready: true, group: 'all', isSmsOn: (s: PropertySnapshot) => s.sms.enabled, isRuleOn: (_id: string, fallback: boolean) => fallback };
const vm = buildOverviewVM(demoPortfolio, ui);
beforeEach(() => {
  mocks.matchMobile = true;
  mocks.path = '/demo/overview';
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', () => ({ matches: mocks.matchMobile, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('mobile portfolio overview', () => {
  it('scrolls long event and property lists inside their cards instead of expanding them, without SMS controls', () => {
    render(<MobilePortfolioOverview vm={vm} />);
    const feed = screen.getByRole('region', { name: 'Händelseflöde' });
    const status = screen.getByRole('region', { name: 'Bevakningsstatus' });
    const feedScroll = within(feed).getByRole('region', { name: `Händelser, ${vm.feed.length} st – scrolla för fler` });
    expect(within(feedScroll).getAllByRole('link')).toHaveLength(vm.feed.length);
    expect(within(feed).queryByRole('button', { name: /Visa alla/ })).toBeNull();
    // Property links only; the attribution link is a separate source link.
    const statusScroll = within(status).getByRole('region', { name: 'Fastigheter, 8 st – scrolla för fler' });
    expect(within(statusScroll).getAllByRole('link').filter(a => a.getAttribute('href')?.startsWith('/demo/properties/'))).toHaveLength(8);
    expect(within(status).queryByRole('button', { name: /Visa alla/ })).toBeNull();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('keeps the 3D scene and warning summary in the same card, with all properties shown', () => {
    render(<MobilePortfolioOverview vm={vm} />);
    expect(screen.getByRole('img', { name: '5 av 8 fastigheter att bevaka. 3D-illustration.' })).toBeTruthy();
    expect(screen.getByText(/^Högst: Augustendal Brygga/)).toBeTruthy();
    expect(screen.getByTestId('three-scene')).toBeTruthy();
    expect(screen.queryByRole('tablist', { name: 'Fastighetsgrupp' })).toBeNull();
    const risk = screen.getByRole('region', { name: 'Portföljens risköversikt' });
    expect(within(risk).getByRole('img', { name: /SMS-larm .*aktiverat/ })).toBeTruthy();
    expect(within(risk).queryByRole('switch')).toBeNull();
    const warnings = within(risk).getByRole('button', { name: /VMA och 3 andra varningar.*Visa varningar/ });
    expect(warnings.getAttribute('data-level')).toBe('VMA');
    vi.spyOn(warnings, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 300, 300, 60));
    fireEvent.click(warnings);
    const preview = within(risk).getByRole('region', { name: 'Officiella varningar' });
    expect(within(preview).getAllByRole('listitem')).toHaveLength(4);
    expect(within(preview).getByText('Gul varning · Nacka · Värmdö')).toBeTruthy();
    expect(within(preview).getByText('Gul varning · Stockholm · Innerstaden')).toBeTruthy();
    expect(within(preview).getByRole('link', { name: 'Gå till Larm' }).getAttribute('href')).toBe('/demo/alerts');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(within(risk).queryByRole('region', { name: 'Officiella varningar' })).toBeNull();
    const feed = screen.getByRole('region', { name: 'Händelseflöde' });
    expect(within(feed).getAllByRole('link')[0]!.getAttribute('href')).toBe(`/demo/properties/${vm.feed[0]!.propertyId}`);
  });

  it('keeps a long warning list keyboard-scrollable with the Larm link outside the scrolling area', () => {
    const warnings = Array.from({ length: 25 }, (_, i) => ({ ...vm.warningPreview[0]!, id: `warning-${i}`, title: `Varning ${i + 1}` }));
    render(<MobilePortfolioOverview vm={{ ...vm, warningPreview: warnings }} />);
    const trigger = screen.getByRole('button', { name: /Visa varningar/ });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 300, 300, 60));
    fireEvent.click(trigger);
    const preview = screen.getByRole('region', { name: 'Officiella varningar' });
    const list = within(preview).getByRole('list');
    Object.defineProperties(list, { scrollHeight: { value: 1150 }, clientHeight: { value: 228 } });
    fireEvent.scroll(list);
    expect(list.getAttribute('tabindex')).toBe('0');
    expect(list.getAttribute('aria-label')).toBe('25 varningar – scrolla för fler');
    expect(within(list).getAllByRole('listitem')).toHaveLength(25);
    expect(within(list).queryByRole('link')).toBeNull();
    expect(within(preview).getByRole('link', { name: 'Gå till Larm' }).getAttribute('href')).toBe('/demo/alerts');
  });

  it('keeps missing source data distinct from zero and an assessed low risk', () => {
    const unavailable = { ...vm, avail: { ...vm.avail, alerts: false, weather: false, warnings: false }, hero: { ...vm.hero, status: { ...vm.hero.status, n: null, fill: 0, headline: 'Status kan inte bedömas' } } };
    render(<MobilePortfolioOverview vm={unavailable} />);
    expect(screen.getByRole('img', { name: 'Status kan inte bedömas. 3D-illustration.' })).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ej ansluten').length).toBeGreaterThan(0);
  });
});

describe('mobile property list', () => {
  it('combines search and status filtering, sorts by Swedish name, and clears empty results', () => {
    render(<MobilePropertyIndex />);
    const search = screen.getByRole('searchbox', { name: 'Sök fastighet, adress eller område' });
    fireEvent.change(search, { target: { value: 'bromma' } });
    expect(screen.getByRole('status').textContent).toBe('1 fastighet');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link').textContent).toContain('Ulvsunda Lager');
    fireEvent.click(screen.getByRole('button', { name: 'Kritisk 1' }));
    expect(screen.getByText('Inga fastigheter matchar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rensa filter' }));
    expect(screen.getAllByRole('link')).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Namn' }));
    expect(screen.getAllByRole('link')[0]!.textContent).toContain('Arenastaden Hus C');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('preserves the selected-property redirect on desktop', () => {
    mocks.matchMobile = false;
    render(<MobilePropertyIndex />);
    expect(mocks.replace).toHaveBeenCalledWith(`/demo/properties/${demoPortfolio.properties[0]!.property.id}`);
  });
});

it('mobile navigation has actual routes and opens settings', () => {
  mocks.path = '/demo/properties/demo-ulvsunda-lager';
  const onSettings = vi.fn();
  render(<MobileNavigation onSettings={onSettings} />);
  expect(screen.getByRole('link', { name: 'Fastigheter' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: /Larm/ }).getAttribute('href')).toBe('/demo/alerts');
  fireEvent.click(screen.getByRole('button', { name: 'Öppna inställningar och meny' }));
  expect(onSettings).toHaveBeenCalledOnce();
});

it('mobile forecast switches metrics through the dashboard state', () => {
  const snapshot = demoPortfolio.properties[0]!;
  const detail = buildDetailVM(demoPortfolio, snapshot, { ready: true, metric: 'temp', smsOn: true, isRuleOn: ui.isRuleOn });
  const onMetric = vi.fn();
  render(<MobileWeatherChart d={detail} onMetric={onMetric} />);
  expect(screen.getByRole('img', { name: 'Prognosdiagram: Temperatur' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Nederbörd' }));
  expect(onMetric).toHaveBeenCalledWith('rain');
});
