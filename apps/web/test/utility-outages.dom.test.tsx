// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { PropertySnapshot, PropertyUtilityStatus, UtilityOutageView } from '@fastighetsradar/domain';
import { UtilityOutagePanel } from '@/components/properties/UtilityOutagePanel';
import { buildUtilityOutageVM, outageShapes } from '@/lib/view-models/utility-outages';
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

describe('Elnät panel view-model', () => {
  it('is hidden without an outage section (demo / old payload)', () => {
    expect(buildUtilityOutageVM(snap()).available).toBe(false);
  });

  it('says "Inga registrerade avbrott" only for a monitored, current grid', () => {
    expect(buildUtilityOutageVM(snap(status())).state).toMatchObject({ label: 'Inga registrerade avbrott', tone: SEV.normal });
    expect(buildUtilityOutageVM(snap(status({ coverage: 'stale' }))).state!.label).toBe('Ej bedömd');
    expect(buildUtilityOutageVM(snap(status({ coverage: 'not_monitored' }))).state!.label).toBe('Nätet bevakas inte ännu');
    const unknown = buildUtilityOutageVM(snap(status({ coverage: 'unknown', operator: null }))).state!;
    expect(unknown.label).toBe('Nätbolaget är okänt');
    expect(unknown.detail).toMatch(/kan inte bekräftas/);
  });

  it('names the operator of an unmonitored grid and explains boundary cases', () => {
    expect(buildUtilityOutageVM(snap(status({ coverage: 'not_monitored', operator: { id: 'ei:Kraftringen Nät AB', name: 'Kraftringen Nät AB', mapUrl: null } }))).state!.detail).toContain('Kraftringen Nät AB');
    const border = buildUtilityOutageVM(snap(status({ coverage: 'unknown', operator: null, operatorCandidates: ['Vattenfall Eldistribution', 'Kraftringen Nät AB'] }))).state!;
    expect(border.label).toBe('Osäkert nätbolag');
    expect(border.detail).toContain('Vattenfall Eldistribution och Kraftringen Nät AB');
    expect(buildUtilityOutageVM(snap(status())).footer).toContain('Energimarknadsinspektionen');
  });

  it('an unplanned outage is red and wins over coverage messages', () => {
    const vm = buildUtilityOutageVM(snap(status({ coverage: 'stale', current: [view()] })));
    expect(vm.state).toMatchObject({ label: 'Oplanerat strömavbrott', tone: SEV.critical });
    expect(vm.current[0]).toMatchObject({ badge: 'Oplanerat', title: 'Oplanerat strömavbrott – Vattenfall Eldistribution' });
    expect(vm.current[0]!.facts).toContainEqual(['Berörda kunder', '120']);
  });

  it('planned work is blue with its time window; restored is green', () => {
    const vm = buildUtilityOutageVM(
      snap(
        status({
          upcoming: [view({ id: 'p', kind: 'planned', state: 'upcoming', severity: 'monitor', plannedStart: '2026-11-30T08:00:00.000Z', plannedEnd: '2026-11-30T13:00:00.000Z', actualStart: null })],
          recentlyRestored: [view({ id: 'r', state: 'restored', severity: 'info', restoredAt: '2026-11-14T15:00:00.000Z' })],
        }),
      ),
    );
    expect(vm.upcoming[0]).toMatchObject({ badge: 'Planerat', tone: SEV.monitor });
    expect(vm.upcoming[0]!.facts[0]).toEqual(['Tid', '30/11 09:00–14:00']);
    expect(vm.restored[0]).toMatchObject({ badge: 'Återställt', tone: SEV.normal, title: 'Strömmen är tillbaka enligt Vattenfall Eldistribution' });
  });

  it('missing customer counts render as "—", never 0', () => {
    const vm = buildUtilityOutageVM(snap(status({ current: [view({ affectedCustomers: null })] })));
    expect(vm.current[0]!.facts).toContainEqual(['Berörda kunder', '—']);
  });

  it('map shapes only for outages with geometry; area/planned dashed', () => {
    const shapes = outageShapes(snap(status({ current: [view()], upcoming: [view({ id: 'p', state: 'upcoming', kind: 'planned', severity: 'monitor' })], nearby: [view({ id: 'n', geometry: null })] })));
    expect(shapes.map((s) => [s.id, s.dashed])).toEqual([['e1', false], ['p', true]]);
  });
});

describe('<UtilityOutagePanel />', () => {
  it('renders the red state, the operator’s own text and a source link', () => {
    render(<UtilityOutagePanel vm={buildUtilityOutageVM(snap(status({ current: [view()] })))} />);
    expect(screen.getByRole('status').textContent).toContain('Oplanerat strömavbrott');
    expect(screen.getByText(/Felsökning pågår/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /Källa: Vattenfall Eldistribution/ });
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(document.body.textContent).not.toMatch(/kris|fara|akut/i);
  });

  it('lists near matches separately and says they are not confirmed', () => {
    render(<UtilityOutagePanel vm={buildUtilityOutageVM(snap(status({ nearby: [view({ matchMethod: 'outage_adjacent', precisionLevel: 'low', severity: null, precisionLabel: 'Nära avbrottsområdet – inte bekräftat att fastigheten berörs' })] })))} />);
    expect(screen.getByText(/I närheten – inte bekräftat/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Inga registrerade avbrott');
  });

  it('renders nothing when unavailable', () => {
    const { container } = render(<UtilityOutagePanel vm={buildUtilityOutageVM(snap())} />);
    expect(container.innerHTML).toBe('');
  });
});
