// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { PropertySnapshot, PropertyUtilityStatus, UtilityOutageView } from '@fastighetsradar/domain';
import { LocalEventsPanel } from '@/components/properties/LocalEventsPanel';
import { outageEventsFor, outageShapes } from '@/lib/view-models/utility-outages';
import type { DetailVM } from '@/lib/view-models/detail';
import { SEV } from '@/lib/design/tokens';

afterEach(cleanup);

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
  it('lists nothing without matched outages – coverage lives in the risk factor', () => {
    expect(outageEventsFor(snap())).toEqual([]);
    expect(outageEventsFor(snap(status()))).toEqual([]);
  });

  it('lists only outages that cover the property (high/medium), never area or near matches', () => {
    const rows = outageEventsFor(
      snap(
        status({
          current: [view(), view({ id: 'area', matchMethod: 'outage_postal_area', precisionLevel: 'area', severity: null })],
          nearby: [view({ id: 'near', matchMethod: 'outage_adjacent', precisionLevel: 'low', severity: null })],
        }),
      ),
    );
    expect(rows.map((r) => r.id)).toEqual(['e1']);
    expect(rows[0]).toMatchObject({ kind: 'Ström', title: 'Oplanerat strömavbrott – Vattenfall Eldistribution', c: SEV.critical.c, operatorText: 'Felsökning pågår' });
    expect(rows[0]!.when).toMatch(/^Oplanerat · start /);
  });

  it('orders ongoing, planned, then restored; district heating gets its own label', () => {
    const heat: PropertyUtilityStatus = { ...status({ coverage: 'unknown', operator: null }), utility: 'district_heating', upcoming: [view({ id: 'h', utility: 'district_heating', kind: 'planned', state: 'upcoming', severity: 'monitor', plannedStart: '2026-11-15T10:00:00.000Z', plannedEnd: '2026-11-16T01:00:00.000Z' })] };
    const rows = outageEventsFor({
      utilityOutages: [status({ current: [view()], recentlyRestored: [view({ id: 'r', state: 'restored', severity: 'info', restoredAt: '2026-11-14T15:00:00.000Z' })] }), heat],
    } as unknown as PropertySnapshot);
    expect(rows.map((r) => [r.id, r.kind])).toEqual([['e1', 'Ström'], ['h', 'Fjärrvärme'], ['r', 'Ström']]);
    expect(rows[1]!.title).toBe('Planerat fjärrvärmeavbrott 15/11 11:00–16/11 02:00 – Vattenfall Eldistribution');
    expect(rows[2]).toMatchObject({ title: 'Strömmen är tillbaka enligt Vattenfall Eldistribution', c: SEV.normal.c });
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
    ({ live: null, avail: { events: true }, noEvents: true, events: [], crisisN: 0, trafficN: 0, otherN: 0, outageEvents }) as unknown as DetailVM;

  it('shows an outage that covers the property with the operator text and a source link', () => {
    render(<LocalEventsPanel d={d(outageEventsFor(snap(status({ current: [view()] }))))} />);
    expect(screen.getByTestId('outage-event').textContent).toContain('Berör fastigheten');
    expect(screen.getByText(/Felsökning pågår/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Vattenfall Eldistribution · avbrottskarta/ }).getAttribute('rel')).toContain('noopener');
    expect(screen.queryByText(/Inga rapporterade/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/kris|fara|akut/i);
  });

  it('keeps the empty state when nothing affects the property', () => {
    render(<LocalEventsPanel d={d([])} />);
    expect(screen.queryByTestId('outage-event')).toBeNull();
    expect(screen.getByText(/Inga rapporterade/)).toBeTruthy();
  });
});
