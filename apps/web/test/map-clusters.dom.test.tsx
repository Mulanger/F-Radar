// @vitest-environment jsdom
/** Clustered portfolio map (docs/plans/skalning.md, Fas 4 / S-18). */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import type { PropertySnapshot, PropertyStatus } from '@fastighetsradar/domain';
import { buildMapMarkers, clusterPoints, worstStatus } from '@/lib/maps/cluster';
import { loadLeaflet } from '@/components/maps/leaflet-utils';
import { PortfolioMap } from '@/components/maps/PortfolioMap';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const base = demoPortfolio.properties[0]!;
function at(n: number, lat: number, lon: number, status: PropertyStatus, name = `Hus ${n}`): PropertySnapshot {
  return { ...base, property: { ...base.property, id: `p-${n}`, name, status, location: { lat, lon } } };
}
// Equirectangular "screen" for the pure tests: `scale` pixels per degree.
const screen = (scale: number) => (lat: number, lon: number) => ({ x: lon * scale, y: -lat * scale });

describe('clustering', () => {
  it('joins points within the radius, keeps the rest, and gives the same result for the same input', () => {
    const points = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 10, y: 5 },
      { id: 'c', x: 23, y: 0 },
      { id: 'd', x: 60, y: 0 },
      { id: 'e', x: 61, y: 1 },
      { id: 'f', x: 200, y: 200 },
    ];
    expect(clusterPoints(points, 24)).toEqual([['a', 'b', 'c'], ['d', 'e'], ['f']]);
    expect(clusterPoints(points, 24)).toEqual(clusterPoints(points, 24));
    expect(clusterPoints(points, 5)).toEqual([['a'], ['b'], ['c'], ['d', 'e'], ['f']]);
  });

  it('colours a cluster by its most serious status, and "Ej bedömd" never hides green', () => {
    expect(worstStatus(['normal', 'warning', 'monitor'])).toBe('warning');
    expect(worstStatus(['normal', 'critical', 'warning'])).toBe('critical');
    expect(worstStatus(['unknown', 'normal', 'unknown'])).toBe('normal');
    expect(worstStatus(['unknown'])).toBe('unknown');

    const list = [at(1, 59.33, 18.06, 'normal'), at(2, 59.3301, 18.0601, 'warning'), at(3, 59.3302, 18.0602, 'monitor', 'Annex'), at(4, 59.5, 18.5, 'critical')];
    const markers = buildMapMarkers(list, screen(10_000), 24);
    expect(markers.map((m) => m.kind)).toEqual(['cluster', 'pin']);
    const cluster = markers[0]!;
    if (cluster.kind !== 'cluster') throw new Error('expected a cluster');
    expect(cluster.status).toBe('warning');
    expect(cluster.members.map((s) => s.property.name)).toEqual(['Hus 2', 'Annex', 'Hus 1']);
    expect(cluster.counts).toEqual([{ status: 'warning', n: 1 }, { status: 'monitor', n: 1 }, { status: 'normal', n: 1 }]);
    expect(cluster.samePlace).toBe(false);
    expect(cluster.lat).toBeCloseTo(59.3301, 6);

    // Zoomed in (more pixels per degree) the same properties open up into pins.
    expect(buildMapMarkers(list, screen(1_000_000), 24).every((m) => m.kind === 'pin')).toBe(true);
  });

  it('marks properties on one address point, which no zoom can separate', () => {
    const list = [at(1, 59.33, 18.06, 'normal'), at(2, 59.33, 18.06, 'normal'), at(3, 59.330001, 18.060001, 'warning')];
    const [m] = buildMapMarkers(list, screen(100_000_000), 24);
    expect(m?.kind === 'cluster' && m.samePlace).toBe(true);
  });
});

describe('PortfolioMap with clusters', () => {
  const props = { legend: [] };
  // 40 properties in one block (a few metres apart) and one far away: one cluster and one pin.
  const block = Array.from({ length: 40 }, (_, i) => at(i, 59.33 + (i % 8) * 0.00002, 18.06 + Math.floor(i / 8) * 0.00002, i === 7 ? 'critical' : i % 3 ? 'normal' : 'monitor'));
  const far = at(99, 59.6, 18.5, 'normal', 'Långt bort');

  it('draws a crowded block as one cluster with its number in the worst colour, and no pin is a tab stop', async () => {
    const { container: root } = render(<PortfolioMap list={[...block, far]} onOpen={() => {}} {...props} />);
    await waitFor(() => expect(root.querySelectorAll('.leaflet-marker-icon')).toHaveLength(2));
    const cluster = [...root.querySelectorAll('.leaflet-marker-icon')].find((m) => m.getAttribute('title') === '40 fastigheter')!;
    expect(cluster.textContent).toBe('40');
    expect(cluster.innerHTML).toContain('#D8473A');
    expect(root.querySelector('[title="Långt bort"]')).toBeTruthy();
    expect(root.querySelectorAll('.leaflet-marker-icon[tabindex]:not([tabindex="-1"])')).toHaveLength(0);
  });

  it('zooms in on a click, and lists the properties when they share one point', async () => {
    const L = await loadLeaflet();
    const fit = vi.spyOn(L.Map.prototype, 'fitBounds');
    const onOpen = vi.fn();
    const { container: root, rerender } = render(<PortfolioMap list={[...block, far]} onOpen={onOpen} {...props} />);
    await waitFor(() => expect(root.querySelector('[title="40 fastigheter"]')).toBeTruthy());
    const fits = fit.mock.calls.length;
    await act(async () => {
      root.querySelector('[title="40 fastigheter"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(fit.mock.calls.length).toBe(fits + 1);

    // Three properties on one address point: a list to choose from instead of zooming.
    const same = [at(1, 59.33, 18.06, 'normal', 'Hus A'), at(2, 59.33, 18.06, 'warning', 'Hus B'), at(3, 59.33, 18.06, 'normal', 'Hus C')];
    rerender(<PortfolioMap list={same} onOpen={onOpen} {...props} />);
    await waitFor(() => expect(root.querySelector('[title="3 fastigheter"]')).toBeTruthy());
    await act(async () => {
      root.querySelector('[title="3 fastigheter"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const list = await waitFor(() => {
      const el = root.querySelector('ul[aria-label="Fastigheter här"]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect([...list.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Hus BVarning', 'Hus AIngen aktiv varning', 'Hus CIngen aktiv varning']);
    (list.querySelectorAll('button')[0] as HTMLButtonElement).click();
    expect(onOpen).toHaveBeenCalledWith('p-2');
  });
});
