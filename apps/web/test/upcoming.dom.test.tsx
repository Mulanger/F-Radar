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
afterEach(() => { cleanup(); router.push.mockClear(); });

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
  it.each([false, true])('renders a warning shared by many properties as one row (mobile: %s)', (mobile) => {
    const panel = renderUpcoming(fixture(20), mobile);
    const rows = panel.getAllByTestId('upcoming-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('20 fastigheter');
    expect(rows[0]!.textContent).toContain('SMHI · varning');
    expect(rows[0]!.getAttribute('aria-expanded')).toBe('false');
    expect(panel.queryByRole('list', { name: 'Berörda fastigheter' })).toBeNull();
  });

  it('shows the usual individual rows for three properties', () => {
    const panel = renderUpcoming(fixture(3));
    expect(panel.getAllByTestId('upcoming-row')).toHaveLength(3);
    expect(panel.getByRole('button', { name: 'Fastighet 3' })).toBeTruthy();
    expect(panel.queryByText('3 fastigheter')).toBeNull();
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
    const panel = renderUpcoming(fixture(120));
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
    fireEvent.change(search, { target: { value: 'fastighet 109' } });
    expect(results().getAllByRole('listitem')).toHaveLength(1);
    expect(results().getByRole('button', { name: /^Fastighet 109 / })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'saknas' } });
    expect(panel.getByRole('status').textContent).toBe('Inga fastigheter matchar sökningen.');
  });

  it('recounts and restricts the expanded list to the selected property group', () => {
    const panel = renderUpcoming(fixture(12));
    fireEvent.click(panel.getByRole('button', { name: /12 fastigheter/ }));
    fireEvent.click(screen.getByRole('tab', { name: /^Innerstad/ }));
    expect(panel.getByRole('button', { name: /5 fastigheter/ })).toBeTruthy();
    expect(panel.queryByRole('button', { name: /12 fastigheter/ })).toBeNull();
    const list = within(panel.getByRole('list', { name: 'Berörda fastigheter' }));
    expect(list.getAllByRole('listitem')).toHaveLength(5);
    expect(list.queryByRole('button', { name: /^Fastighet 6 / })).toBeNull();
  });
});
