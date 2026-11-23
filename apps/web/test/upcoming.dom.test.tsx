// @vitest-environment jsdom
import { useMemo } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Portfolio } from '@fastighetsradar/domain';
import { demoPortfolio, scaleDemoPortfolio } from '@fastighetsradar/domain/fixtures';
import { GroupFilter } from '@/components/groups/GroupFilter';
import { MobileUpcoming } from '@/components/mobile/MobileUpcoming';
import { UpcomingPanel } from '@/components/upcoming/UpcomingPanel';
import { propertyHref } from '@/lib/navigation/dashboard';
import { DashboardStateProvider, useDashboard } from '@/lib/state/dashboard-state';
import { buildOverviewVM } from '@/lib/view-models/overview';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/demo/overview', useRouter: () => router }));

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); router.push.mockClear(); vi.unstubAllGlobals(); });

function fixture(n: number): Portfolio {
  const properties = scaleDemoPortfolio(demoPortfolio, n).properties.slice(0, n).map((s, i) => ({
    ...s, property: { ...s.property, name: `Fastighet ${i + 1}`, address: `Testgatan ${i + 1}`, groupIds: [i < 5 ? 'inner' : 'outer'] },
  }));
  const warning = demoPortfolio.upcoming.find((u) => u.official)!;
  const upcoming = properties.map(({ property }) => ({ ...warning, id: `official-${property.id}-wind`, where: property.name, propertyId: property.id }));
  return { ...demoPortfolio, properties, upcoming, feed: [] };
}

function OverviewUpcoming({ mobile }: { mobile?: boolean }) {
  const { portfolio, ready, group, isSmsOn, isRuleOn } = useDashboard();
  const vm = useMemo(() => buildOverviewVM(portfolio, { ready, group, isSmsOn, isRuleOn }), [portfolio, ready, group, isSmsOn, isRuleOn]);
  return <><GroupFilter variant={mobile ? 'select' : 'tabs'} />{mobile ? <MobileUpcoming vm={vm} /> : <UpcomingPanel vm={vm} />}</>;
}

function renderUpcoming(portfolio: Portfolio, mobile = false) {
  render(<DashboardStateProvider mode="demo" basePath="/demo" portfolio={portfolio}><OverviewUpcoming mobile={mobile} /></DashboardStateProvider>);
  return within(screen.getByRole('region', { name: 'Kommande förhållanden' }));
}

describe('kommande förhållanden – overview groups', () => {
  it.each([false, true])('renders one group with a clear button and its lowest temperature (mobile: %s)', (mobile) => {
    const portfolio = fixture(30);
    const frost = demoPortfolio.upcoming.find((u) => u.id.startsWith('frost-'))!;
    portfolio.upcoming = portfolio.properties.map(({ property }, i) => ({
      ...frost, id: `frost-${property.id}`, propertyId: property.id, where: property.name, value: i === 29 ? '-13°' : '-3°',
    }));
    const panel = renderUpcoming(portfolio, mobile);
    const rows = panel.getAllByTestId('upcoming-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toMatch(/^Minusgrader.*30 fastigheter · Visa fastigheter.*−13°lägst/);
    expect(within(rows[0]!).getByRole('button', { name: '30 fastigheter · Visa fastigheter' }).getAttribute('aria-expanded')).toBe('false');
    expect(panel.queryByRole('list', { name: 'Berörda fastigheter' })).toBeNull();
  });

  it('shows individual addresses across 11 properties when at most 10 share a condition', () => {
    const portfolio = fixture(11);
    const last = portfolio.upcoming[10]!;
    last.validAt = new Date(Date.parse(last.validAt!) + 3_600_000).toISOString();
    portfolio.properties[0]!.property.address = 'Subway, Kampenhofgatan 2, 451 42 Uddevalla, Sverige';
    const panel = renderUpcoming(portfolio);
    expect(panel.getAllByTestId('upcoming-row')).toHaveLength(11);
    expect(panel.getByText('Kampenhofgatan 2, 451 42 Uddevalla')).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Fastighet 11' })).toBeTruthy();
    expect(panel.queryByRole('button', { name: /Visa fastigheter/ })).toBeNull();
  });

  it('opens and closes the list and navigates to a selected property', () => {
    const portfolio = fixture(12);
    const panel = renderUpcoming(portfolio);
    const row = panel.getByRole('button', { name: /12 fastigheter/ });
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const list = panel.getByRole('list', { name: 'Berörda fastigheter' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(12);
    fireEvent.click(within(list).getByRole('button', { name: /^Fastighet 12 / }));
    expect(router.push).toHaveBeenCalledWith(propertyHref('/demo', portfolio.properties[11]!.property.id, 'overview'));
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(panel.queryByRole('list', { name: 'Berörda fastigheter' })).toBeNull();
  });

  it('pages through at most 100 properties and searches the entire group by name or address', () => {
    const portfolio = fixture(120);
    portfolio.properties[119]!.property.address = 'Subway, Testgatan 120, 45142 Uddevalla, Sverige';
    const panel = renderUpcoming(portfolio);
    fireEvent.click(panel.getByRole('button', { name: /120 fastigheter/ }));
    const results = () => within(panel.getByRole('list', { name: 'Berörda fastigheter' }));
    expect(results().getAllByRole('listitem')).toHaveLength(100);
    expect(results().queryByRole('button', { name: /^Fastighet 120 / })).toBeNull();
    fireEvent.click(panel.getByRole('button', { name: 'Visa fler' }));
    expect(results().getAllByRole('listitem')).toHaveLength(20);
    expect(results().getByRole('button', { name: /^Fastighet 120 / })).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: 'Visa föregående' }));

    const search = panel.getByRole('searchbox', { name: 'Sök på namn eller adress' });
    fireEvent.change(search, { target: { value: ' TESTGATAN 120 ' } });
    expect(results().getAllByRole('listitem')).toHaveLength(1);
    expect(results().getByRole('button', { name: /^Fastighet 120 / })).toBeTruthy();
    expect(results().getByText('Testgatan 120, 451 42 Uddevalla')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'fastighet 109' } });
    expect(results().getAllByRole('listitem')).toHaveLength(1);
    expect(results().getByRole('button', { name: /^Fastighet 109 / })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'saknas' } });
    expect(panel.getByRole('status').textContent).toBe('Inga fastigheter matchar sökningen.');
  });

  it('shows individual properties again when the selected group is below the threshold', () => {
    const panel = renderUpcoming(fixture(12));
    fireEvent.click(panel.getByRole('button', { name: /12 fastigheter/ }));
    fireEvent.click(screen.getByRole('tab', { name: /^Innerstad/ }));
    expect(panel.queryByRole('button', { name: /12 fastigheter/ })).toBeNull();
    expect(panel.queryByRole('list', { name: 'Berörda fastigheter' })).toBeNull();
    expect(panel.getAllByTestId('upcoming-row')).toHaveLength(5);
    expect(panel.getByRole('button', { name: 'Fastighet 5' })).toBeTruthy();
    expect(panel.queryByRole('button', { name: 'Fastighet 6' })).toBeNull();
  });

  it.each([false, true])('keeps the axis and the rows together in a bounded scroll region (mobile: %s)', (mobile) => {
    const panel = renderUpcoming(fixture(120), mobile);
    const scroll = panel.getByRole('region', { name: 'Tidslinje' });
    expect(scroll.style.overflowY).toBe('auto');
    expect(scroll.style.overflowX).toBe('hidden');
    expect(parseInt(scroll.style.maxHeight)).toBeGreaterThan(0);
    expect(scroll.tabIndex).toBe(0);
    expect(scroll.firstElementChild?.textContent).toContain('Nu');
    expect(scroll.contains(panel.getByTestId('upcoming-row'))).toBe(true);
    scroll.scrollTop = 250;
    fireEvent.click(panel.getByRole('button', { name: /Varningar 120/ }));
    expect(scroll.scrollTop).toBe(0);
  });

  it.each([false, true])('hides the midnight clock beside Nu but keeps later midnight visible (mobile: %s)', (mobile) => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly callback: () => void) {}
      observe() { this.callback(); }
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.textContent === 'Nu 23') return new DOMRect(0, 0, 33, 10);
      if (this.dataset.axisClock) return new DOMRect(300 * Number(this.dataset.axisClock) + 6, 0, 12, 10);
      return new DOMRect(0, 0, 300, 38);
    });
    const portfolio = { ...fixture(1), generatedAt: '2026-11-12T22:55:00Z' };
    const panel = renderUpcoming(portfolio, mobile);
    expect(panel.getByText('Nu 23')).toBeTruthy();
    const midnightClocks = panel.getAllByText('00', { exact: true });
    expect(midnightClocks).toHaveLength(2);
    expect(midnightClocks[0]!.style.visibility).toBe('hidden');
    expect(midnightClocks[1]!.style.visibility).toBe('');
  });
});
