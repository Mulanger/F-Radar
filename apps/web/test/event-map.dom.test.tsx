// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import { EventMapView } from '@/components/maps/EventMapView';
import { LocalEvents } from '@/components/properties/LocalEvents';
import { LocalEventsPanel } from '@/components/properties/LocalEventsPanel';
import type { EventMapState } from '@/components/properties/use-event-map';
import { demoEventMap } from '@/lib/demo/event-map-demo';
import { buildDetailVM } from '@/lib/view-models/detail';
import { eventMapEntries } from '@/lib/view-models/event-map';

vi.mock('@/lib/state/dashboard-state', () => ({ useDashboard: () => ({ mode: 'demo', portfolio: { generatedAt: demoPortfolio.generatedAt } }) }));

beforeAll(() => {
  // jsdom has no layout; give map containers a size so Leaflet computes a viewport.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
});
afterEach(cleanup);

const snap = demoPortfolio.properties.find((s) => s.property.id === 'demo-sjostaden-kaj')!;
const d = buildDetailVM(demoPortfolio, snap, { ready: true, metric: 'temp', smsOn: true, isRuleOn: (_id: string, v: boolean) => v });
const entries = eventMapEntries(d.events, demoEventMap(d.id), 'ready', demoPortfolio.generatedAt);
const property = { name: d.name, address: d.address, lat: d.location.lat, lon: d.location.lon };
const road = entries.find((e) => e.label === 'Vägarbete')!;

describe('<EventMapView />', () => {
  it('shows the event card, highlights the stretch with start and end, and steps between events', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<EventMapView entries={entries} openId={road.id} onSelect={onSelect} onClose={onClose} property={property} live={false} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain(road.title);
    expect(dialog.textContent).toContain('Påverkad sträcka ≈');
    expect(dialog.textContent).toContain(`Händelse ${entries.indexOf(road) + 1} av ${entries.length}`);
    expect(dialog.textContent).toContain('Demo');
    // Three stacked polylines per run (glow, colour, white dashes) plus the dashed line to the property.
    await waitFor(() => expect(dialog.querySelectorAll('.leaflet-overlay-pane path').length).toBeGreaterThanOrEqual(3));
    expect(dialog.textContent).toContain('Start');
    expect(dialog.textContent).toContain('Slut');
    expect(dialog.textContent).toContain(d.name);

    fireEvent.click(screen.getByRole('button', { name: 'Nästa händelse' }));
    expect(onSelect).toHaveBeenLastCalledWith(entries[(entries.indexOf(road) + 1) % entries.length]!.id);
    fireEvent.click(screen.getByRole('button', { name: 'Föregående händelse' }));
    expect(onSelect).toHaveBeenLastCalledWith(entries[(entries.indexOf(road) - 1 + entries.length) % entries.length]!.id);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`gå tillbaka till ${d.name}`) }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('locks page scroll while open and restores it, and shows Live for live data', () => {
    document.body.style.overflow = 'auto';
    const { unmount } = render(<EventMapView entries={[road]} openId={road.id} onSelect={() => {}} onClose={() => {}} property={property} live />);
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('dialog').textContent).toContain('Live');
    expect(screen.queryByRole('button', { name: 'Nästa händelse' })).toBeNull();
    unmount();
    expect(document.body.style.overflow).toBe('auto');
  });
});

describe('"Visa på karta" in the event list', () => {
  it('makes mappable events buttons that open the map at that event', () => {
    const open = vi.fn();
    const first = d.events[0]!;
    const map: EventMapState = { entries, mappable: new Set(entries.filter((e) => e.id !== first.id).map((e) => e.id)), openId: null, status: 'ready', open, close: () => {}, select: () => {} };
    render(<LocalEventsPanel d={d} map={map} />);
    const buttons = screen.getAllByRole('button', { name: /Visa på karta$/ });
    expect(buttons).toHaveLength(d.events.length - 1);
    expect(screen.queryByRole('button', { name: new RegExp(`^${first.title}`) })).toBeNull();
    fireEvent.click(buttons[0]!);
    expect(open).toHaveBeenCalledWith(d.events[1]!.id);
  });

  it('opens and closes the full map from the property page', async () => {
    render(<LocalEvents d={d} layout="desktop" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `${road.title}. Visa på karta` }));
    });
    expect(screen.getByRole('dialog').textContent).toContain(road.title);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    // "Öppna karta" on the local map starts at the first mappable event.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Öppna karta' }));
    });
    expect(screen.getByRole('dialog').textContent).toContain(entries[0]!.title);
  });
});
