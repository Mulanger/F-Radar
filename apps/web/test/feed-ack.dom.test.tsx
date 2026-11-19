// @vitest-environment jsdom
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import type { Portfolio, PropertySnapshot } from '@fastighetsradar/domain';
import { buildOverviewVM } from '@/lib/view-models/overview';
import { AlertFeed } from '@/components/dashboard/AlertFeed';
import { UpcomingPanel } from '@/components/upcoming/UpcomingPanel';
import { MobileAlerts } from '@/components/mobile/MobileAlerts';
import { acknowledgementReport } from '@/lib/acknowledgements/pdf';
import { demoAcknowledgements } from '@/lib/demo/acknowledgements';

const mocks = vi.hoisted(() => ({ openProperty: vi.fn(), refresh: vi.fn(), mode: 'demo' as 'demo' | 'live' }));
let activePortfolio = demoPortfolio;
vi.mock('next/link', () => ({ default: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props} /> }));
vi.mock('@/lib/state/dashboard-state', () => ({ useDashboard: () => ({
  portfolio: activePortfolio, mode: mocks.mode, ready: true, metric: 'temp', basePath: '/demo', openProperty: mocks.openProperty, refresh: mocks.refresh,
  isSmsOn: (s: PropertySnapshot) => s.sms.enabled, isRuleOn: (_id: string, fallback: boolean) => fallback,
}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); mocks.mode = 'demo'; activePortfolio = demoPortfolio; });

const ui = { ready: true, group: 'all', isSmsOn: (s: PropertySnapshot) => s.sms.enabled, isRuleOn: (_id: string, fallback: boolean) => fallback };
const vm = buildOverviewVM(demoPortfolio, ui);
const vma = vm.feed.find((f) => f.title.startsWith('VMA'))!;

describe('traffic updates in the feed', () => {
  it.each(['desktop', 'mobile'])('clears only the opened traffic revision on %s', async (device) => {
    const existing = demoPortfolio.properties[0]!;
    const propertyId = existing.property.id;
    const eventId = 'trafikverket-e14';
    const description = `${'Trafikmeddelande med fler uppgifter. '.repeat(20)}Bärgare på plats.`;
    activePortfolio = {
      ...demoPortfolio,
      properties: [{ ...existing, property: { ...existing.property, origin: 'live' } }],
      feed: [{ id: 'chg-3', propertyId, eventId, title: 'Ny: Olycka på E14', sourceId: 'trafikverket', sourceLabel: 'Trafikverket', severity: 'warning',
        origin: 'live', publishedAt: demoPortfolio.generatedAt, updatedAt: demoPortfolio.generatedAt, unreadUpdateId: 'chg-2' }],
    } satisfies Portfolio;
    const fetchEvent = vi.fn(async (url: string) => url === '/api/app/feed/reads' ? new Response(null, { status: 204 }) : Response.json({
      propertyId, title: 'Olycka på E14', sourceId: 'trafikverket', active: true, endedAt: null, distanceM: 400,
      item: { eventId, label: 'Olycka', icon: 'accident', hue: 'orange', where: 'E14', description, validFrom: null, validTo: null,
        impact: null, geometry: { type: 'Point', coordinates: [18, 59] }, radiusM: null, lengthM: null },
    }));
    vi.stubGlobal('fetch', fetchEvent);
    mocks.mode = 'live';
    const view = () => device === 'mobile' ? <MobileAlerts /> : <AlertFeed vm={buildOverviewVM(activePortfolio, ui)} isDemo={false} onOpen={mocks.openProperty} />;
    const { rerender } = render(view());
    expect(screen.getAllByText('Uppdaterad')).toHaveLength(1);
    expect(fetchEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Ny: Olycka på E14'));
    expect(fetchEvent).toHaveBeenCalledWith(`/api/app/properties/${propertyId}/event-map/${eventId}`, expect.objectContaining({ cache: 'no-store' }));
    expect((await screen.findByRole('region', { name: 'Beskrivning' })).textContent).toBe(description);
    expect(screen.queryByText('Uppdaterad')).toBeNull();
    expect(fetchEvent).toHaveBeenCalledWith('/api/app/feed/reads', expect.objectContaining({ method: 'POST', body: JSON.stringify({ changeId: 'chg-2' }) }));
    activePortfolio = { ...activePortfolio, feed: activePortfolio.feed.map(item => ({ ...item, unreadUpdateId: 'chg-4' })) };
    rerender(view());
    expect(screen.getAllByText('Uppdaterad')).toHaveLength(1);
  });
});

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
    expect(screen.getByText('Kvitterad', { exact: false }).tagName).toBe('SPAN');
    expect(screen.getByRole('status').textContent).toBe('2 att kvittera');
    fireEvent.click(screen.getByRole('button', { name: `Ångra kvittering: ${vma.title}` }));
    expect(mocks.openProperty).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: `Kvittera: ${vma.title}` })).toBeTruthy();
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
    fireEvent.click(within(feed).getByRole('button', { name: `Kvittera: ${vma.title}` }));
    fireEvent.click(within(feed).getByRole('button', { name: `Ångra kvittering: ${vma.title}` }));
    expect(within(feed).getByRole('button', { name: `Kvittera: ${vma.title}` })).toBeTruthy();
  });

  it('includes both timestamps in the exported PDF and omits identity fields', () => {
    const example = { ...demoAcknowledgements.find((entry) => !!entry.undoneAt)!, acknowledgedBy: 'Private Name', undoneBy: 'Another Name' };
    const report = acknowledgementReport([example], 'Demoportfölj', 'Alla datum', true, example.acknowledgedAt, 'full');
    const content = JSON.stringify(report.content);
    expect(content).toContain('Kvitterad 18 nov. 2026 09:04');
    expect(content).toContain('Ångrad 18 nov. 2026 09:16');
    expect(content).not.toContain('Private Name');
    expect(content).not.toContain('Another Name');
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
