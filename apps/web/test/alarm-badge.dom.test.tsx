// @vitest-environment jsdom
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import type { FeedItem, Portfolio } from '@fastighetsradar/domain';
import { DashboardStateProvider } from '@/lib/state/dashboard-state';
import { MobileAlerts } from '@/components/mobile/MobileAlerts';
import { MobileNavigation } from '@/components/mobile/MobileNavigation';

const nav = vi.hoisted(() => ({ pathname: '/overview', router: { refresh: vi.fn(), push: vi.fn() } }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => nav.router }));
vi.mock('next/link', () => ({ default: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props} /> }));
vi.mock('@/lib/design/use-mobile-dashboard', () => ({ useAndroidNavigation: () => false }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); nav.pathname = '/overview'; nav.router.refresh.mockClear(); });

const alarm: FeedItem = {
  id: 'chg-2', eventId: 'event-1', propertyId: demoPortfolio.properties[0]!.property.id,
  publishedAt: demoPortfolio.generatedAt, sourceLabel: 'SMHI', sourceId: 'smhi_warnings', severity: 'warning',
  title: 'Kraftigt snöfall', origin: 'live', ackRequired: true, unreadAlarmId: 'chg-1',
};

function view(alarms: FeedItem[]) {
  const portfolio: Portfolio = { ...demoPortfolio, feed: [], activeAlarms: alarms };
  return <DashboardStateProvider mode="live" basePath="" portfolio={portfolio}>
    <MobileNavigation onSettings={() => {}} />
    {nav.pathname === '/alerts' && <MobileAlerts />}
  </DashboardStateProvider>;
}

it('clears the alarms rendered on arrival and keeps the acknowledgement and later escalations', async () => {
  const post = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', post);
  const { rerender } = render(view([alarm]));
  expect(screen.getByLabelText('1 olästa larm')).toBeTruthy();
  expect(post).not.toHaveBeenCalled();

  nav.pathname = '/alerts';
  rerender(view([alarm]));
  await waitFor(() => expect(screen.queryByLabelText('1 olästa larm')).toBeNull());
  expect(screen.getByRole('button', { name: 'Kvittera: Kraftigt snöfall' })).toBeTruthy();
  expect(post).toHaveBeenCalledWith('/api/app/feed/alarm-reads', expect.objectContaining({ body: JSON.stringify({ changeIds: ['chg-1'] }) }));

  const escalated = { ...alarm, unreadAlarmId: 'chg-3' };
  rerender(view([escalated]));
  expect(screen.getByLabelText('1 olästa larm')).toBeTruthy();
  expect(post).toHaveBeenCalledTimes(1);
  nav.pathname = '/overview';
  rerender(view([escalated]));
  nav.pathname = '/alerts';
  rerender(view([escalated]));
  await waitFor(() => expect(screen.queryByLabelText('1 olästa larm')).toBeNull());
  expect(post).toHaveBeenLastCalledWith('/api/app/feed/alarm-reads', expect.objectContaining({ body: JSON.stringify({ changeIds: ['chg-3'] }) }));
});

it('waits until a background Larm page becomes visible before clearing the badge', async () => {
  const post = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', post);
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  nav.pathname = '/alerts';
  render(view([alarm]));
  expect(screen.getByLabelText('1 olästa larm')).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  await waitFor(() => expect(screen.queryByLabelText('1 olästa larm')).toBeNull());
  expect(post).toHaveBeenCalledTimes(1);
});
