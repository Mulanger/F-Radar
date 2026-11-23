// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PropertySnapshot, PropertyUtilityStatus, UtilityOutageView } from '@fastighetsradar/domain';
import { LocalEventsPanel } from '@/components/properties/LocalEventsPanel';
import { outageEventsFor, outageShapes } from '@/lib/view-models/utility-outages';
import type { DetailVM } from '@/lib/view-models/detail';
import { SEV } from '@/lib/design/tokens';

// The outage map view looks the property up in the dashboard portfolio (live: one outage fetched by id).
vi.mock('@/lib/state/dashboard-state', () => ({ useDashboard: () => ({
  mode: 'live', portfolio: { generatedAt: '2026-11-14T13:30:00.000Z', properties: [{ property: { id: 'p1', name: 'Natur', address: 'Frescativägen 40', origin: 'live', location: { lat: 59.37, lon: 18.05 } } }] },
}) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const view = (o: Partial<UtilityOutageView> = {}): UtilityOutageView => ({
  id: 'e1',
  operatorId: 'vattenfall',
  operatorName: 'Vattenfall Eldistribution',
  utility: 'electricity',
  kind: 'unplanned',
  state: 'ongoing',
  matchMethod: 'outage_polygon',
  precisionLevel: 'high',
  precisionLabel: 'Fastighetens adresspunkt ligger inom avbrottsområdet',
  severity: 'critical',
  distanceMeters: 0,
  affectedCustomers: 120,
  areaCustomerTotal: null,
  reportedAt: null,
  plannedStart: null,
  plannedEnd: null,
  actualStart: '2026-11-14T13:05:00.000Z',
  estimatedRestore: '2026-11-14T16:00:00.000Z',
  restoredAt: null,
  restoredInferred: false,
  operatorText: 'Felsökning pågår',
  cause: null,
  placeLabel: 'INGARÖ',
  sourceUrl: 'https://www.vattenfalleldistribution.se/stromavbrott/pagaende-stromavbrott/',
  geometry: { type: 'Polygon', coordinates: [[[18.5, 59.27], [18.51, 59.27], [18.51, 59.28], [18.5, 59.27]]] },
  ...o,
});
const status = (o: Partial<PropertyUtilityStatus> = {}): PropertyUtilityStatus => ({
  utility: 'electricity',
  operator: { id: 'vattenfall', name: 'Vattenfall Eldistribution', mapUrl: 'https://x' },
  coverage: 'monitored',
  updatedAt: '2026-11-14T13:25:00.000Z',
  current: [],
  upcoming: [],
  recentlyRestored: [],
  nearby: [],
  ...o,
});
const snap = (u?: PropertyUtilityStatus) => ({ utilityOutages: u ? [u] : undefined }) as unknown as PropertySnapshot;

describe('outages among the property events', () => {
  it('lists nothing without confirmed outage matches', () => {
    expect(outageEventsFor(snap())).toEqual([]);
    expect(outageEventsFor(snap(status()))).toEqual([]);
  });

  it('lists direct matches and skips postcode and nearby outages', () => {
    const rows = outageEventsFor(
      snap(
        status({
          current: [
            view(),
            view({ id: 'area', operatorName: 'Ellevio', matchMethod: 'outage_postal_area', precisionLevel: 'area', severity: 'monitor', affectedCustomers: 223, precisionLabel: 'I fastighetens postnummerområde – inte säkert att fastigheten berörs' }),
            // Planned work at area level has no severity and is not listed.
            view({ id: 'area-planned', kind: 'planned', matchMethod: 'outage_postal_area', precisionLevel: 'area', severity: null }),
          ],
          nearby: [view({ id: 'near', matchMethod: 'outage_adjacent', precisionLevel: 'low', severity: null })],
        }),
      ),
    );
    expect(rows.map((r) => r.id)).toEqual(['e1']);
    expect(rows[0]).toMatchObject({ kind: 'Ström', title: 'Oplanerat strömavbrott – Vattenfall Eldistribution', c: SEV.critical.c, operatorText: 'Felsökning pågår', scope: 'Berör fastigheten', areaOnly: false });
    expect(rows[0]!.when).toMatch(/^Oplanerat · start /);
  });

  it('hides archived heating data and keeps the order of visible events', () => {
    const heat: PropertyUtilityStatus = { ...status({ coverage: 'unknown', operator: null }), utility: 'district_heating', upcoming: [view({ id: 'h', utility: 'district_heating', kind: 'planned', state: 'upcoming', severity: 'monitor', plannedStart: '2026-11-15T10:00:00.000Z', plannedEnd: '2026-11-16T01:00:00.000Z' })] };
    const rows = outageEventsFor({
      utilityOutages: [status({ current: [view()], recentlyRestored: [view({ id: 'r', state: 'restored', severity: 'info', restoredAt: '2026-11-14T15:00:00.000Z' })] }), heat],
    } as unknown as PropertySnapshot);
    expect(rows.map((r) => [r.id, r.kind])).toEqual([['e1', 'Ström'], ['r', 'Ström']]);
    expect(rows[1]).toMatchObject({ title: 'Strömmen är tillbaka enligt Vattenfall Eldistribution', c: SEV.normal.c });
  });

  it('a vanished ticket is grey and neutral, and hidden while the same operator still has an outage there', () => {
    const area = { operatorId: 'ellevio', operatorName: 'Ellevio' };
    const vanished = view({ ...area, id: 'old', state: 'withdrawn', severity: 'info', operatorText: 'Vi undersöker omfattningen av avbrottet.' });
    // Alone: listed, but never as "Strömmen är tillbaka".
    const alone = outageEventsFor(snap(status({ recentlyRestored: [vanished] })));
    expect(alone).toHaveLength(1);
    expect(alone[0]).toMatchObject({ title: 'Strömavbrott visas inte längre hos Ellevio – inget besked om att det är åtgärdat', c: SEV.unknown.c });
    expect(alone[0]!.when).toMatch(/^Visas inte längre hos nätbolaget/);
    // While another Ellevio outage covers the property it was replaced (581219 → 581216): not shown.
    const replaced = outageEventsFor(snap(status({ current: [view({ ...area, id: 'new', severity: 'monitor' })], recentlyRestored: [vanished] })));
    expect(replaced.map((r) => r.id)).toEqual(['new']);
  });

  it('removal from a map-only operator reads "troligen tillbaka", never "enligt"', () => {
    const rows = outageEventsFor(snap(status({ recentlyRestored: [view({ state: 'restored', severity: 'info', restoredInferred: true, restoredAt: '2026-11-14T15:00:00.000Z' })] })));
    expect(rows[0]!.title).toBe('Strömmen är troligen tillbaka – avbrottet visas inte längre hos Vattenfall Eldistribution');
    expect(rows[0]!.when).toMatch(/^Borttaget från kartan /);
  });

  it('map shapes only for outages covering the property; planned dashed', () => {
    const shapes = outageShapes(snap(status({
      current: [view(), view({ id: 'a', precisionLevel: 'area', matchMethod: 'outage_postal_area' })],
      upcoming: [view({ id: 'p', state: 'upcoming', kind: 'planned', severity: 'monitor' })],
      nearby: [view({ id: 'n', precisionLevel: 'low' })],
    })));
    expect(shapes.map((s) => [s.id, s.dashed])).toEqual([['e1', false], ['p', true]]);
  });
});

describe('<LocalEventsPanel /> with outages', () => {
  const d = (outageEvents: ReturnType<typeof outageEventsFor>) =>
    ({ id: 'p1', live: null, avail: { events: true }, noEvents: true, events: [], crisisN: 0, trafficN: 0, otherN: 0, outageEvents }) as unknown as DetailVM;

  it('shows an outage that covers the property with the operator text and a source link', () => {
    render(<LocalEventsPanel d={d(outageEventsFor(snap(status({ current: [view()] }))))} />);
    expect(screen.getByTestId('outage-event').textContent).toContain('Berör fastigheten');
    expect(screen.getByText(/Felsökning pågår/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Vattenfall Eldistribution · avbrottskarta/ }).getAttribute('rel')).toContain('noopener');
    expect(screen.queryByText(/Inga rapporterade/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/kris|fara|akut/i);
  });

  it('hides outages known only by postal area', () => {
    const area = view({ id: 'a', operatorName: 'Ellevio', matchMethod: 'outage_postal_area', precisionLevel: 'area', severity: 'monitor', precisionLabel: 'I fastighetens postnummerområde – inte säkert att fastigheten berörs' });
    render(<LocalEventsPanel d={d(outageEventsFor(snap(status({ current: [area] }))))} />);
    expect(screen.queryByTestId('outage-event')).toBeNull();
  });

  it('hides water point notices near the property', () => {
    const point = view({ utility: 'water', operatorName: 'VA-bolaget', matchMethod: 'outage_point', precisionLevel: 'low', severity: null });
    const water = { ...status({ nearby: [point] }), utility: 'water' as const };
    render(<LocalEventsPanel d={d(outageEventsFor(snap(water)))} />);
    expect(screen.queryByTestId('outage-event')).toBeNull();
  });

  it('opens an outage with an area on the map – also when it is over – and not one known only by addresses', async () => {
    const restored = view({ id: 'natur-1', state: 'restored', restoredAt: '2026-11-17T14:40:00.000Z', operatorName: 'Ellevio' });
    const addresses = view({ id: 'addr', geometry: null as never });
    const rows = outageEventsFor(snap(status({ current: [addresses], recentlyRestored: [restored] })));
    expect(rows.map((r) => [r.id, r.mapEventId, r.mapEnded])).toEqual(expect.arrayContaining([['natur-1', 'natur-1', true], ['addr', null, false]]));
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    render(<LocalEventsPanel d={d(rows)} />);
    const buttons = screen.getAllByRole('button', { name: /Visa på karta$/ });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/app/properties/p1/event-map/natur-1', expect.anything()));
  });

  it('keeps the empty state when nothing affects the property', () => {
    render(<LocalEventsPanel d={d([])} />);
    expect(screen.queryByTestId('outage-event')).toBeNull();
    expect(screen.getByText('Inga händelser att visa.')).toBeTruthy();
  });
});
