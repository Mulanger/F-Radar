// @vitest-environment jsdom
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import type { PropertySnapshot } from '@fastighetsradar/domain';
import { buildOverviewVM } from '@/lib/view-models/overview';
import { AlertFeed } from '@/components/dashboard/AlertFeed';
import { UpcomingPanel } from '@/components/upcoming/UpcomingPanel';
import { MobileAlerts } from '@/components/mobile/MobileAlerts';

const mocks = vi.hoisted(() => ({ openProperty: vi.fn(), refresh: vi.fn(), mode: 'demo' as 'demo' | 'live' }));
vi.mock('next/link', () => ({ default: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props} /> }));
vi.mock('@/lib/state/dashboard-state', () => ({ useDashboard: () => ({
  portfolio: demoPortfolio, mode: mocks.mode, ready: true, metric: 'temp', basePath: '/demo', openProperty: mocks.openProperty, refresh: mocks.refresh,
  isSmsOn: (s: PropertySnapshot) => s.sms.enabled, isRuleOn: (_id: string, fallback: boolean) => fallback,
}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); mocks.mode = 'demo'; });

const ui = { ready: true, group: 'all', isSmsOn: (s: PropertySnapshot) => s.sms.enabled, isRuleOn: (_id: string, fallback: boolean) => fallback };
const vm = buildOverviewVM(demoPortfolio, ui);
const vma = vm.feed.find((f) => f.title.startsWith('VMA'))!;

describe('kvittering i händelseflödet', () => {
  it('asks to acknowledge warnings and VMA only, and counts what is left', () => {
    expect(vm.feed.filter((f) => f.ackRequired).map((f) => f.src)).toEqual(['SMHI', 'Krisinformation']);
    render(<AlertFeed vm={vm} isDemo onOpen={mocks.openProperty} />);
    expect(screen.getAllByRole('button', { name: /^Kvittera: / })).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toBe('2 att kvittera');
  });

  it('acknowledges without opening the property, and can be undone', () => {
    render(<AlertFeed vm={vm} isDemo onOpen={mocks.openProperty} />);
    fireEvent.click(screen.getByRole('button', { name: `Kvittera: ${vma.title}` }));
    expect(mocks.openProperty).not.toHaveBeenCalled();
    const done = screen.getByRole('button', { name: new RegExp(`^Kvitterad \\d\\d:\\d\\d: ${vma.title.slice(0, 20)}`) });
    expect(done.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('1 att kvittera');
    fireEvent.click(done);
    expect(screen.getByRole('status').textContent).toBe('2 att kvittera');
  });

  it('saves for the organization in live mode and restores on failure', async () => {
    mocks.mode = 'live';
    const live = { ...vm, feed: vm.feed.map((f) => (f === vma ? { ...f, id: 'chg-42' } : f)) };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ changeId: 'chg-42', at: '2026-11-18T08:00:00.000Z' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<AlertFeed vm={live} isDemo={false} onOpen={mocks.openProperty} />);
    fireEvent.click(screen.getByRole('button', { name: `Kvittera: ${vma.title}` }));
    expect(fetchMock).toHaveBeenCalledWith('/api/app/feed/acknowledgements', expect.objectContaining({ method: 'POST', body: JSON.stringify({ changeId: 'chg-42', acknowledged: true }) }));
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalled());

    cleanup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    vi.stubGlobal('alert', vi.fn());
    render(<AlertFeed vm={live} isDemo={false} onOpen={mocks.openProperty} />);
    fireEvent.click(screen.getByRole('button', { name: `Kvittera: ${vma.title}` }));
    await screen.findByRole('button', { name: `Kvittera: ${vma.title}` });
    expect(window.alert).toHaveBeenCalled();
  });

  it('works on the mobile Larm page too', () => {
    render(<MobileAlerts />);
    const feed = screen.getByRole('region', { name: 'Händelseflöde' });
    expect(within(feed).getAllByRole('button', { name: /^Kvittera: / })).toHaveLength(2);
    for (const b of within(feed).getAllByRole('button', { name: /^Kvittera: / })) expect(b.closest('a')).toBeNull();
  });
});

describe('kommande förhållanden – plain information', () => {
  it('shows a summary, the 48 h strip and rows, with nothing to acknowledge', () => {
    render(<UpcomingPanel vm={vm} />);
    const panel = screen.getByTestId('upcoming-panel');
    expect(panel.textContent).toMatch(/de kommande 48 h/);
    expect(within(panel).getByRole('group', { name: 'Tidslinje, kommande 48 timmar' })).toBeTruthy();
    expect(within(panel).getAllByTestId('upcoming-row')).toHaveLength(vm.upcoming.length);
    expect(panel.textContent).not.toMatch(/Kvitter/);
  });

  it('opens what it means and what is good to do, with a way to the property', () => {
    render(<UpcomingPanel vm={vm} />);
    fireEvent.click(screen.getAllByTestId('upcoming-row')[0]!);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Bra att göra');
    expect(dialog.textContent).not.toMatch(/Kvitter/);
    const open = within(dialog).getByRole('button', { name: /^Öppna / });
    fireEvent.click(open);
    expect(mocks.openProperty).toHaveBeenCalled();
  });
});
