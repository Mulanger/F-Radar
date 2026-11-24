// @vitest-environment jsdom
/**
 * Fas 2 / S-09 (docs/plans/skalning.md): one page per event over many properties – the official text
 * once, a searchable list and "Kvittera alla" – in demo and live.
 */
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { eventLinkKey, type EventPage, type PropertySnapshot } from '@fastighetsradar/domain';
import { demoPortfolio, scaleDemoPortfolio, DEMO_COUNTY_WARNING_EVENT_ID } from '@fastighetsradar/domain/fixtures';
import { demoEventPage } from '@/lib/demo/event-page';
import { EVENT_LIST_MAX, EventPageView } from '@/components/alerts/EventPage';

const scaled = scaleDemoPortfolio(demoPortfolio, 500);
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), openProperty: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props} /> }));
vi.mock('@/components/maps/PortfolioMap', () => ({ PortfolioMap: ({ list }: { list: unknown[] }) => <div data-testid="map">{list.length} på kartan</div> }));
vi.mock('@/lib/state/dashboard-state', () => ({ useDashboard: () => ({
  portfolio: scaled, mode: 'live', basePath: '', refresh: mocks.refresh, openProperty: mocks.openProperty,
  property: (id: string) => scaled.properties.find((s: PropertySnapshot) => s.property.id === id),
}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('demo event page', () => {
  it('names every property of the county warning once, with its official text', () => {
    const page = demoEventPage(scaled, DEMO_COUNTY_WARNING_EVENT_ID)!;
    expect(page.properties).toHaveLength(500);
    expect(new Set(page.properties.map((p) => p.propertyId)).size).toBe(500);
    expect(page.event.description).toBeTruthy();
    expect(page.properties.every((p) => p.changeId && p.ackRequired)).toBe(true);
    expect(demoEventPage(scaled, 'no-such-event')).toBeNull();
  });

  it('gives an SMS link key only for real event ids', () => {
    expect(eventLinkKey('0B9F1D2C-3E4F-4a5b-8c6d-7e8f9a0b1c2d')).toBe('0b9f1d2c3e4f4a5b');
    expect(eventLinkKey(DEMO_COUNTY_WARNING_EVENT_ID)).toBeNull();
  });
});

describe('event page', () => {
  const page: EventPage = { ...demoEventPage(scaled, DEMO_COUNTY_WARNING_EVENT_ID)!, event: { ...demoEventPage(scaled, DEMO_COUNTY_WARNING_EVENT_ID)!.event, origin: 'live' } };

  it('keeps search and "Visa alla" outside the scrolling property rows and shows the official text once', () => {
    render(<EventPageView page={page} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(page.event.title);
    expect(screen.getAllByText(page.event.description!)).toHaveLength(1);
    expect(screen.getByTestId('map').textContent).toBe('500 på kartan');
    const list = screen.getByRole('region', { name: 'Berörda fastigheter' });
    const scrolling = within(list).getByRole('region', { name: 'Fastighetslista' });
    const more = within(list).getByRole('button', { name: 'Visa alla 500' });
    const search = within(list).getByRole('searchbox');
    expect(scrolling.tabIndex).toBe(0);
    expect(scrolling.contains(more)).toBe(false);
    expect(scrolling.contains(search)).toBe(false);
    expect(within(scrolling).getAllByRole('listitem')).toHaveLength(EVENT_LIST_MAX);
    fireEvent.click(more);
    expect(within(scrolling).getAllByRole('listitem')).toHaveLength(500);
    const target = page.properties[123]!;
    scrolling.scrollTop = 250;
    fireEvent.change(search, { target: { value: target.name.toLowerCase() } });
    expect(scrolling.scrollTop).toBe(0);
    return vi.waitFor(() => expect(within(scrolling).getAllByRole('listitem').map((li) => li.textContent)).toContainEqual(expect.stringContaining(target.name)));
  });

  it('acknowledges every property in one call', async () => {
    const save = vi.fn(async (_url: string, init: RequestInit) => {
      const { changeIds } = JSON.parse(String(init.body)) as { changeIds: string[] };
      return Response.json({ changes: changeIds.map((changeId) => ({ changeId, at: page.generatedAt })) });
    });
    vi.stubGlobal('fetch', save);
    render(<EventPageView page={page} />);
    fireEvent.click(screen.getByRole('button', { name: `Kvittera alla 500: ${page.event.title}` }));
    await vi.waitFor(() => expect(screen.getByText('Alla kvitterade')).toBeTruthy());
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(save.mock.calls[0]![1].body)).changeIds).toHaveLength(500);
  });

  it('says why when the live page could not be loaded', () => {
    render(<EventPageView page={null} reason="Larmtjänsten går inte att nå." />);
    expect(screen.getByText('Larmtjänsten går inte att nå.')).toBeTruthy();
  });
});
