// @vitest-environment jsdom
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import type { PropertySnapshot } from '@fastighetsradar/domain';
import { buildOverviewVM } from '@/lib/view-models/overview';
import { AlertFeed } from '@/components/dashboard/AlertFeed';
import { MobileFeedRows } from '@/components/mobile/MobilePrimitives';

const mocks = vi.hoisted(() => ({ openProperty: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props} /> }));
vi.mock('@/lib/state/dashboard-state', () => ({ useDashboard: () => ({
  portfolio: demoPortfolio, mode: 'demo', ready: true, metric: 'temp', basePath: '/demo', openProperty: mocks.openProperty,
  isSmsOn: (s: PropertySnapshot) => s.sms.enabled, isRuleOn: (_id: string, fallback: boolean) => fallback,
}) }));

beforeAll(() => {
  // jsdom has no layout; give map containers a size so Leaflet computes a viewport.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const ui = { ready: true, group: 'all', isSmsOn: (s: PropertySnapshot) => s.sms.enabled, isRuleOn: (_id: string, fallback: boolean) => fallback };
const vm = buildOverviewVM(demoPortfolio, ui);
const mappable = vm.feed.filter((f) => f.mapEventId);
const ended = vm.feed.find((f) => f.mapEnded)!;
const e4 = vm.feed.find((f) => f.title.startsWith('Körfält avstängt på E4'))!;

describe('dashboard feed – map button', () => {
  it('shows a map button only on cards whose event has a position', () => {
    expect(mappable.length).toBeGreaterThan(0);
    expect(mappable.length).toBeLessThan(vm.feed.length);
    render(<AlertFeed vm={vm} isDemo onOpen={mocks.openProperty} />);
    expect(screen.getAllByRole('button', { name: /^Visa (var det var )?på karta: / })).toHaveLength(mappable.length);
    expect(screen.getAllByRole('button', { name: /^Visa var det var på karta: / })).toHaveLength(1);
  });

  it('shows an ended event greyed out where it was', async () => {
    render(<AlertFeed vm={vm} isDemo onOpen={mocks.openProperty} />);
    fireEvent.click(screen.getByRole('button', { name: `Visa var det var på karta: ${ended.title}` }));
    const dialog = await screen.findByRole('dialog');
    expect(mocks.openProperty).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain('Avslutad');
    expect(dialog.textContent).toContain('Avslutad 07:40');
    expect(dialog.textContent).toContain('Lindhagensgatan');
    expect(dialog.textContent).toContain('Strandhuset');
    // One event only: no stepping between events.
    expect(screen.queryByRole('button', { name: 'Nästa händelse' })).toBeNull();
    await waitFor(() => expect(dialog.querySelectorAll('.leaflet-overlay-pane path').length).toBeGreaterThanOrEqual(3));
    expect([...dialog.querySelectorAll('.leaflet-overlay-pane path')].some((p) => p.getAttribute('stroke') === '#8E969D')).toBe(true);
    // No pulsing ring on an ended event's marker.
    expect(dialog.innerHTML).not.toContain('frRing');
  });

  it('opens the event on the map on the dashboard instead of going to the property', async () => {
    render(<AlertFeed vm={vm} isDemo onOpen={mocks.openProperty} />);
    fireEvent.click(screen.getByRole('button', { name: `Visa på karta: ${e4.title}` }));
    expect(mocks.openProperty).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Körfält avstängt på E4 norrgående vid Haga');
    expect(dialog.textContent).toContain('Arenastaden Hus C');
    // Enter on the button does not reach the card either.
    fireEvent.keyDown(screen.getByRole('button', { name: `Visa på karta: ${e4.title}` }), { key: 'Enter' });
    expect(mocks.openProperty).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The rest of the card still opens the property.
    fireEvent.click(screen.getByText(e4.title));
    expect(mocks.openProperty).toHaveBeenCalledWith(e4.propertyId);
  });

  it('puts the map button beside the link on mobile, not inside it', async () => {
    const onMap = vi.fn();
    render(<div><MobileFeedRows feed={vm.feed} basePath="/demo" onMap={onMap} /></div>);
    const buttons = screen.getAllByRole('button', { name: /^Visa (var det var )?på karta: / });
    expect(buttons).toHaveLength(mappable.length);
    for (const b of buttons) expect(b.closest('a')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(vm.feed.length);
    fireEvent.click(screen.getByRole('button', { name: `Visa på karta: ${e4.title}` }));
    expect(onMap).toHaveBeenCalledWith(expect.objectContaining({ propertyId: e4.propertyId, mapEventId: e4.mapEventId }));
    // Without onMap (other lists) there is no button.
    cleanup();
    render(<div><MobileFeedRows feed={vm.feed} basePath="/demo" /></div>);
    expect(within(document.body).queryAllByRole('button')).toHaveLength(0);
  });
});
