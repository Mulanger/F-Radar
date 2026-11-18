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
  it('asks to acknowledge warnings, VMA and outages only, and counts what is left', () => {
    expect(vm.feed.filter((f) => f.ackRequired).map((f) => f.src)).toEqual(['SMHI', 'Krisinformation', 'Ellevio']);
    render(<AlertFeed vm={vm} isDemo onOpen={mocks.openProperty} />);
    expect(screen.getAllByRole('button', { name: /^Kvittera: / })).toHaveLength(3);
    expect(screen.getByRole('status').textContent).toBe('3 att kvittera');
  });

  it('acknowledges without opening the property, and can be undone', () => {
    render(<AlertFeed vm={vm} isDemo onOpen={mocks.openProperty} />);
    fireEvent.click(screen.getByRole('button', { name: `Kvittera: ${vma.title}` }));
    expect(mocks.openProperty).not.toHaveBeenCalled();
    const done = screen.getByRole('button', { name: new RegExp(`^Kvitterad \\d\\d:\\d\\d: ${vma.title.slice(0, 20)}`) });
    expect(done.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('2 att kvittera');
    fireEvent.click(done);
    expect(screen.getByRole('status').textContent).toBe('3 att kvittera');
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

  it('puts a moon on night-only work', () => {
    const night = { ...vm, feed: vm.feed.map((f, i) => (i === 1 ? { ...f, nightWork: 'Nattarbete 22–05' } : f)) };
    render(<AlertFeed vm={night} isDemo onOpen={mocks.openProperty} />);
    expect(screen.getAllByRole('img', { name: /^Nattarbete 22–05 – påverkar troligen inte dagtid$/ })).toHaveLength(1);
  });

  it('works on the mobile Larm page too', () => {
    render(<MobileAlerts />);
    const feed = screen.getByRole('region', { name: 'Händelseflöde' });
    expect(within(feed).getAllByRole('button', { name: /^Kvittera: / })).toHaveLength(3);
    for (const b of within(feed).getAllByRole('button', { name: /^Kvittera: / })) expect(b.closest('a')).toBeNull();
  });
});

describe('kommande förhållanden – timeline per property (designer’s layout)', () => {
  it('leads with a sentence, filters by kind and lists a bar per condition – nothing to acknowledge', () => {
    render(<UpcomingPanel vm={vm} />);
    const panel = screen.getByTestId('upcoming-panel');
    expect(panel.textContent).toContain('Orange varning för kraftig vind i Augustendal Brygga');
    expect(panel.textContent).toContain('SMHI · uppdaterad');
    expect(panel.textContent).toMatch(/\d+ händelser · \d+ platser/);
    expect(panel.textContent).toContain('Mörker');
    expect(within(panel).getAllByTestId('upcoming-row')).toHaveLength(vm.upcoming.length);
    expect(panel.textContent).not.toMatch(/Kvitter/);

    const chips = within(panel).getByRole('group', { name: 'Filtrera typ av händelse' });
    fireEvent.click(within(chips).getByRole('button', { name: /^Halka/ }));
    expect(within(panel).getAllByTestId('upcoming-row')).toHaveLength(1);
    expect(within(chips).getByRole('button', { name: /^Halka/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(chips).getByRole('button', { name: /^Alla/ }));
    expect(within(panel).getAllByTestId('upcoming-row')).toHaveLength(vm.upcoming.length);
  });

  it('expands a row inline: what it means, from, to, source – and a way to the property', () => {
    render(<UpcomingPanel vm={vm} />);
    const row = screen.getAllByTestId('upcoming-row')[0]!;
    expect(row.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const details = row.parentElement!;
    expect(details.textContent).toContain('Från');
    expect(details.textContent).toContain('Till');
    expect(details.textContent).toContain('SMHI · varning');
    fireEvent.click(within(details).getByRole('button', { name: /^Öppna / }));
    expect(mocks.openProperty).toHaveBeenCalled();
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });
});
