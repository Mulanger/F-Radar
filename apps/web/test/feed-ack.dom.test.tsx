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
import { DemoAcknowledgementHistory, DemoAcknowledgementProvider } from '@/components/acknowledgements/DemoAcknowledgements';
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
  it.each(['desktop', 'mobile'])('groups new outages without an update badge on %s', async (device) => {
    const properties = demoPortfolio.properties.slice(0, 3);
    const publishedAt = demoPortfolio.generatedAt;
    const row: Portfolio['feed'][number] = {
      id: 'chg-71', propertyId: properties[0]!.property.id, eventId: 'one-power-outage', eventGroupId: 'outage:1:v1',
      sourceId: 'utility_outages', sourceLabel: 'Ellevio', title: 'Strömavbrott', severity: 'warning',
      origin: 'live', publishedAt, ackRequired: true,
    };
    const same = { ...row, id: 'chg-72', propertyId: properties[1]!.property.id, publishedAt: new Date(Date.parse(publishedAt) - 60_000).toISOString() };
    const separate = { ...row, id: 'chg-73', propertyId: properties[2]!.property.id, eventId: undefined, eventGroupId: undefined };
    activePortfolio = { ...demoPortfolio, properties, feed: [row, same, separate] };
    mocks.mode = 'live';
    const { container } = render(device === 'mobile' ? <MobileAlerts /> : <AlertFeed vm={buildOverviewVM(activePortfolio, ui)} isDemo={false} onOpen={mocks.openProperty} />);
    expect(screen.getAllByText('Strömavbrott')).toHaveLength(2);
    expect(screen.queryByText('Uppdaterad')).toBeNull();
    const group = container.querySelector('details')!;
    expect(group.querySelector('summary')?.textContent).toContain('2 berörda fastigheter');
    // The property rows are rendered when the card is opened (a county warning names hundreds: Fas 2).
    expect(group.querySelectorAll('li')).toHaveLength(0);
    fireEvent.click(group.querySelector('summary')!);
    await vi.waitFor(() => expect(group.querySelectorAll('li')).toHaveLength(2));
  });

  it.each(['desktop', 'mobile'])('acknowledges every property of an event in one call and can undo it on %s (Fas 2 / S-05)', async (device) => {
    const properties = demoPortfolio.properties.slice(0, 4);
    const publishedAt = demoPortfolio.generatedAt;
    const rows: Portfolio['feed'] = properties.map(({ property }, i) => ({
      id: `chg-${61 + i}`, propertyId: property.id, eventId: 'county-wind', eventGroupId: 'smhi:county-wind:new:1', sourceId: 'smhi_warnings',
      sourceLabel: 'SMHI', title: 'Orange varning: Vind', severity: 'warning', origin: 'live',
      publishedAt, ackRequired: true, acknowledgedAt: i === 3 ? publishedAt : null,
    }));
    activePortfolio = { ...demoPortfolio, properties, feed: rows };
    mocks.mode = 'live';
    const save = vi.fn(async (_url: string, init: RequestInit) => {
      const { changeIds, acknowledged } = JSON.parse(String(init.body)) as { changeIds: string[]; acknowledged: boolean };
      return Response.json({ changes: changeIds.map((changeId) => ({ changeId, at: acknowledged ? publishedAt : null })) });
    });
    vi.stubGlobal('fetch', save);
    const { container } = render(device === 'mobile' ? <MobileAlerts /> : <AlertFeed vm={buildOverviewVM(activePortfolio, ui)} isDemo={false} onOpen={mocks.openProperty} />);
    const group = container.querySelector('details')!;
    const summary = group.querySelector('summary')!;
    expect(summary.textContent).toContain('3 att kvittera');
    fireEvent.click(within(summary).getByRole('button', { name: 'Kvittera alla 3: Orange varning: Vind' }));
    expect(group.open).toBe(false); // the button does not toggle the card
    await vi.waitFor(() => expect(summary.textContent).toContain('4 av 4 kvitterade'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('/api/app/feed/acknowledgements/batch', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ changeIds: ['chg-61', 'chg-62', 'chg-63'], acknowledged: true }),
    }));
    // While saving, "Ångra" waits; once saved it undoes exactly what the button acknowledged – not the
    // row acknowledged earlier.
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    const undo = within(summary).getByRole('button', { name: 'Ångra kvitteringen av 3: Orange varning: Vind' }) as HTMLButtonElement;
    await vi.waitFor(() => expect(undo.disabled).toBe(false));
    fireEvent.click(undo);
    await vi.waitFor(() => expect(summary.textContent).toContain('3 att kvittera'));
    expect(save).toHaveBeenLastCalledWith('/api/app/feed/acknowledgements/batch', expect.objectContaining({
      body: JSON.stringify({ changeIds: ['chg-61', 'chg-62', 'chg-63'], acknowledged: false }),
    }));
  });

  it.each(['desktop', 'mobile'])('groups one SMHI revision and saves only the chosen property on %s', async (device) => {
    const properties = demoPortfolio.properties.slice(0, 4);
    expect(properties).toHaveLength(4);
    const publishedAt = demoPortfolio.generatedAt;
    const rows: Portfolio['feed'] = properties.map(({ property }, i) => ({
      id: `chg-${51 + i}`, propertyId: property.id, eventId: 'one-snow-warning', sourceId: 'smhi_warnings',
      sourceLabel: 'SMHI', title: 'Uppdaterad: Snöfall', severity: 'monitor', origin: 'live',
      publishedAt, acknowledgementUpdate: true, ackRequired: true, acknowledgedAt: i >= 2 ? publishedAt : null,
    }));
    const older = { ...rows[0]!, id: 'chg-49', publishedAt: new Date(Date.parse(publishedAt) - 60_000).toISOString(), ackRequired: false };
    const separate = { ...rows[0]!, id: 'chg-50', eventId: 'another-snow-warning', ackRequired: false };
    activePortfolio = { ...demoPortfolio, properties, feed: [...rows, older, separate] };
    mocks.mode = 'live';
    const save = vi.fn().mockResolvedValue(Response.json({ changeId: 'chg-51', at: publishedAt }));
    vi.stubGlobal('fetch', save);
    const { container } = render(device === 'mobile' ? <MobileAlerts /> : <AlertFeed vm={buildOverviewVM(activePortfolio, ui)} isDemo={false} onOpen={mocks.openProperty} />);
    const group = container.querySelector('details')!;
    const summary = group.querySelector('summary')!;
    expect(container.querySelectorAll('details')).toHaveLength(1);
    expect(screen.getAllByText('Snöfall')).toHaveLength(3);
    expect(group.open).toBe(false);
    expect(summary.textContent).toContain('4 berörda fastigheter');
    expect(summary.textContent).toContain('2 att kvittera');
    fireEvent.click(summary);
    expect(group.open).toBe(true);
    await vi.waitFor(() => expect(group.querySelectorAll('li')).toHaveLength(4));
    fireEvent.click(within(group).getByRole('button', { name: `Kvittera: Snöfall · ${properties[0]!.property.name}` }));
    await vi.waitFor(() => expect(within(summary).getByText('1 att kvittera')).toBeTruthy());
    expect(save).toHaveBeenCalledWith('/api/app/feed/acknowledgements', expect.objectContaining({
      body: JSON.stringify({ changeId: 'chg-51', acknowledged: true }),
    }));
    expect(within(summary).getByText('Uppdaterad')).toBeTruthy();
  });

  it.each(['desktop', 'mobile'])('keeps the update label after opening and acknowledging a warning on %s', async (device) => {
    const propertyId = demoPortfolio.properties[0]!.property.id;
    activePortfolio = { ...demoPortfolio, feed: [{
      id: 'chg-51', propertyId, eventId: 'snow-warning', sourceId: 'smhi_warnings', sourceLabel: 'SMHI',
      title: 'Uppdaterad: Snöfall', severity: 'monitor', origin: 'live', publishedAt: demoPortfolio.generatedAt,
      acknowledgementUpdate: true, ackRequired: true, acknowledgedAt: null,
    }] };
    mocks.mode = 'live';
    const save = vi.fn().mockResolvedValue(Response.json({ changeId: 'chg-51', at: '2026-11-18T08:00:00.000Z' }));
    vi.stubGlobal('fetch', save);
    render(device === 'mobile' ? <MobileAlerts /> : <AlertFeed vm={buildOverviewVM(activePortfolio, ui)} isDemo={false} onOpen={mocks.openProperty} />);
    const headline = screen.getByText('Snöfall');
    headline.closest('a')?.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(headline);
    expect(screen.getByText('Uppdaterad')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Kvittera: Snöfall' }));
    await screen.findByText('Kvitterad');
    expect(save).toHaveBeenCalledWith('/api/app/feed/acknowledgements', expect.objectContaining({
      body: JSON.stringify({ changeId: 'chg-51', acknowledged: true }),
    }));
    expect(screen.getByText('Uppdaterad')).toBeTruthy();
  });

  it('asks to acknowledge warnings, VMA and outages only, and counts what is left', () => {
    expect(vm.feed.filter((f) => f.ackRequired).map((f) => f.src)).toEqual(['SMHI', 'Krisinformation', 'Ellevio']);
    render(<AlertFeed vm={vm} isDemo onOpen={mocks.openProperty} />);
    expect(screen.getAllByRole('button', { name: /^Kvittera: / })).toHaveLength(3);
    expect(screen.getByRole('status').textContent).toBe('3 att kvittera');
  });

  it('acknowledges without opening the property and shows a read-only status in the feed', () => {
    render(<AlertFeed vm={vm} isDemo onOpen={mocks.openProperty} />);
    fireEvent.click(screen.getByRole('button', { name: `Kvittera: ${vma.title}` }));
    expect(mocks.openProperty).not.toHaveBeenCalled();
    expect(screen.getByText('Kvitterad', { exact: false }).tagName).toBe('SPAN');
    expect(screen.getByRole('status').textContent).toBe('2 att kvittera');
    expect(screen.queryByRole('button', { name: /Ångra kvittering/ })).toBeNull();
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

  it('keeps the event time separate on mobile and restores the Larm row when undone from history', async () => {
    activePortfolio = { ...demoPortfolio, feed: demoPortfolio.feed.map((item) => item.id === vma.id
      ? { ...item, publishedAt: new Date(Date.parse(item.publishedAt) - 86_400_000).toISOString() } : item) };
    render(<DemoAcknowledgementProvider portfolio={activePortfolio}><MobileAlerts /><DemoAcknowledgementHistory /></DemoAcknowledgementProvider>);
    const feed = screen.getByRole('region', { name: 'Händelseflöde' });
    expect(within(feed).getAllByRole('button', { name: /^Kvittera: / })).toHaveLength(3);
    for (const b of within(feed).getAllByRole('button', { name: /^Kvittera: / })) expect(b.closest('a')).toBeNull();
    fireEvent.click(within(feed).getByRole('button', { name: `Kvittera: ${vma.title}` }));
    const eventTime = within(feed).getByText('igår 13:20');
    const status = within(feed).getByText('Kvitterad', { exact: false });
    expect(eventTime.closest('a')?.contains(status)).toBe(false);
    expect(status.querySelector('time')?.getAttribute('datetime')).toBeTruthy();
    expect(within(feed).queryByRole('button', { name: /Ångra kvittering/ })).toBeNull();
    const history = screen.getByRole('region', { name: 'Kvitteringar' });
    fireEvent.click(await within(history).findByRole('button', { name: `Ångra kvittering: ${vma.title} · ${vma.prop}` }));
    expect(within(feed).getByRole('button', { name: `Kvittera: ${vma.title}` })).toBeTruthy();
    expect(within(history).getByRole('button', { name: new RegExp(`${vma.title}.*Ångrad`) })).toBeTruthy();
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
