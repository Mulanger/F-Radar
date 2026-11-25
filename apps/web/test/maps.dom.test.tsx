// @vitest-environment jsdom
/**
 * Leaflet behaviour in a DOM (jsdom – no network: tile <img> elements are created but never fetched).
 * Covers tile layer setup, provider failure handling, map lifecycle/cleanup, marker rendering and
 * the location picker's position reporting.
 */
import { StrictMode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import { formatClock } from '@fastighetsradar/domain';
import { resolveTileConfig, TILE_ERROR_THRESHOLD } from '@/lib/maps/tile-config';
import { addTileLayer, loadLeaflet } from '@/components/maps/leaflet-utils';
import { PortfolioMap } from '@/components/maps/PortfolioMap';
import { LocationPickerMap } from '@/components/maps/LocationPickerMap';

const KEY = '0123456789abcdef0123456789abcdef';

beforeAll(() => {
  // jsdom has no layout; give map containers a size so Leaflet computes a viewport.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
});
afterEach(() => cleanup());

function container() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('tile layer', () => {
  it('adds exactly one Geoapify layer whose tiles point at maps.geoapify.com', async () => {
    const L = await loadLeaflet();
    const map = L.map(container()).setView([59.33, 18.06], 12);
    const layer = addTileLayer(L, map, resolveTileConfig({ geoapifyMapKey: KEY }));
    expect(layer).not.toBeNull();
    let tileLayers = 0;
    map.eachLayer((l) => (tileLayers += l instanceof L.TileLayer ? 1 : 0));
    expect(tileLayers).toBe(1);
    const srcs = [...map.getContainer().querySelectorAll('img.leaflet-tile')].map((i) => i.getAttribute('src') ?? '');
    expect(srcs.length).toBeGreaterThan(0);
    srcs.forEach((s) => expect(s).toMatch(/^https:\/\/maps\.geoapify\.com\/v1\/tile\/positron\/12\/\d+\/\d+(@2x)?\.png\?apiKey=/));
    expect(map.getContainer().querySelector('.leaflet-control-attribution')!.textContent).toContain('Geoapify');
    map.remove();
  });

  it('renders no tiles and explains why when no browser key is configured', async () => {
    const L = await loadLeaflet();
    const map = L.map(container()).setView([59.33, 18.06], 12);
    expect(addTileLayer(L, map, resolveTileConfig({}))).toBeNull();
    expect(map.getContainer().querySelectorAll('img.leaflet-tile')).toHaveLength(0);
    expect(map.getContainer().querySelector('.leaflet-control-attribution')!.textContent).toContain('Kartbilder ej konfigurerade');
    map.remove();
  });

  it('stops requesting tiles after repeated provider errors (401/429/network) and says so', async () => {
    const L = await loadLeaflet();
    const map = L.map(container()).setView([59.33, 18.06], 12);
    const layer = addTileLayer(L, map, resolveTileConfig({ geoapifyMapKey: KEY }))!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < TILE_ERROR_THRESHOLD - 1; i++) layer.fire('tileerror');
    layer.fire('tileload'); // a success resets the counter
    for (let i = 0; i < TILE_ERROR_THRESHOLD - 1; i++) layer.fire('tileerror');
    expect(map.hasLayer(layer)).toBe(true);
    layer.fire('tileerror');
    expect(map.hasLayer(layer)).toBe(false);
    expect(map.getContainer().querySelector('.leaflet-control-attribution')!.textContent).toContain('Kartbilder otillgängliga');
    expect(warn).toHaveBeenCalledTimes(1);
    map.remove();
  });
});

describe('PortfolioMap', () => {
  const list = demoPortfolio.properties;
  const legend = [{ key: 'normal', label: 'Normal', c: '#3FA66B', n: 3 }];

  it('initialises one Leaflet map (also under StrictMode), renders one marker per property and cleans up on unmount', async () => {
    const onOpen = vi.fn();
    const { container: root, unmount } = render(
      <StrictMode>
        <PortfolioMap list={list} legend={legend} onOpen={onOpen} />
      </StrictMode>,
    );
    await waitFor(() => expect(root.querySelectorAll('.leaflet-marker-icon')).toHaveLength(list.length));
    expect(root.querySelectorAll('.leaflet-map-pane')).toHaveLength(1);
    const titles = [...root.querySelectorAll('.leaflet-marker-icon')].map((m) => m.getAttribute('title'));
    expect(titles).toEqual(list.map((s) => s.property.name));

    // Marker click opens the property.
    await act(async () => {
      root.querySelector('.leaflet-marker-icon')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledWith(list[0]!.property.id);

    unmount();
    expect(root.querySelectorAll('.leaflet-map-pane')).toHaveLength(0);
  });

  it('re-renders markers when the property list changes without creating a second map', async () => {
    const props = { legend, onOpen: () => {} };
    const { container: root, rerender } = render(<PortfolioMap list={list} {...props} />);
    await waitFor(() => expect(root.querySelectorAll('.leaflet-marker-icon')).toHaveLength(list.length));
    rerender(<PortfolioMap list={list.slice(0, 2)} {...props} />);
    await waitFor(() => expect(root.querySelectorAll('.leaflet-marker-icon')).toHaveLength(2));
    expect(root.querySelectorAll('.leaflet-map-pane')).toHaveLength(1);
  });

  it('shows the radar on a live map without layer buttons and names its time in the legend', async () => {
    const live = [{ ...list[0]!, property: { ...list[0]!.property, origin: 'live' as const } }];
    const measuredAt = new Date().toISOString();
    const radar = vi.fn(async () => new Response(new Blob(), { headers: { 'x-radar-measured-at': measuredAt } }));
    const decode = vi.fn(async () => {});
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:portfolio-radar');
    vi.stubGlobal('fetch', radar);
    vi.stubGlobal('Image', function () { return Object.assign(document.createElement('img'), { decode }); });

    try {
      const { container: root, unmount } = render(<PortfolioMap list={live} legend={legend} onOpen={() => {}} />);
      await waitFor(() => expect(root.querySelector('.leaflet-image-layer')?.getAttribute('src')).toBe('blob:portfolio-radar'));
      expect(radar).toHaveBeenCalledWith('/api/map/radar', expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(root.querySelector('.leaflet-marker-icon')).not.toBeNull();
      expect(root.querySelector('[data-testid="rain-legend"]')?.textContent).toBe(`Nederbörd just nu${formatClock(measuredAt)}`);
      expect(root.querySelector('button[aria-label="Nederbördslager"], button[aria-label="Översvämningszoner"]')).toBeNull();
      expect(root.querySelector('.leaflet-portfolio-flood-pane')).toBeNull();

      unmount();
      expect(revoke).toHaveBeenCalledWith('blob:portfolio-radar');
    } finally {
      cleanup();
      vi.unstubAllGlobals();
      create.mockRestore();
      revoke.mockRestore();
    }
  });

  it('keeps the zoom on a live refresh of the same properties and refits only when the set changes (S-13)', async () => {
    const L = await loadLeaflet();
    const fit = vi.spyOn(L.Map.prototype, 'fitBounds');
    const props = { legend, onOpen: () => {} };
    const { container: root, rerender } = render(<PortfolioMap list={list} {...props} />);
    await waitFor(() => expect(root.querySelectorAll('.leaflet-marker-icon')).toHaveLength(list.length));
    expect(fit).toHaveBeenCalledTimes(1);
    const untouched = root.querySelectorAll('.leaflet-marker-icon')[1];

    // router.refresh(): a new portfolio object with the same properties, one of them now critical.
    const refreshed = list.map((s, i) => ({ ...s, property: { ...s.property, status: i === 0 ? 'critical' as const : s.property.status } }));
    rerender(<PortfolioMap list={refreshed} {...props} />);
    const pin = (name: string) => [...root.querySelectorAll('.leaflet-marker-icon')].find((m) => m.getAttribute('title') === name)!;
    expect(list[0]!.property.status).not.toBe('critical');
    await waitFor(() => expect(pin(list[0]!.property.name).innerHTML).toContain('#D8473A'));
    expect(fit).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll('.leaflet-marker-icon')).toHaveLength(list.length);
    expect([...root.querySelectorAll('.leaflet-marker-icon')]).toContain(untouched);

    // A different group: new set of properties → fit once more.
    rerender(<PortfolioMap list={refreshed.slice(2, 5)} {...props} />);
    await waitFor(() => expect(root.querySelectorAll('.leaflet-marker-icon')).toHaveLength(3));
    expect(fit).toHaveBeenCalledTimes(2);
  });
});

describe('LocationPickerMap', () => {
  it('shows a draggable pin at the point and reports map clicks as the corrected position', async () => {
    const onChange = vi.fn();
    const { container: root, unmount } = render(<LocationPickerMap point={{ lat: 59.33677, lon: 18.0627 }} onChange={onChange} />);
    await waitFor(() => expect(root.querySelectorAll('.leaflet-marker-icon')).toHaveLength(1));
    const pin = root.querySelector('.leaflet-marker-icon')!;
    expect(pin.classList.contains('leaflet-marker-draggable')).toBe(true);
    await act(async () => {
      root.querySelector('.leaflet-container')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 420, clientY: 160 }));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const p = onChange.mock.calls[0]![0] as { lat: number; lon: number };
    expect(Number.isFinite(p.lat) && Number.isFinite(p.lon)).toBe(true);
    expect(p).not.toEqual({ lat: 59.33677, lon: 18.0627 });
    unmount();
    expect(root.querySelectorAll('.leaflet-map-pane')).toHaveLength(0);
  });
});
