// @vitest-environment jsdom
/** Sorting, the area filter and the rendering budget of the property list (docs/plans/skalning.md, Fas 4 / S-19). */
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import type { PropertySnapshot, PropertyStatus } from '@fastighetsradar/domain';
import { PropertyIndex } from '@/components/properties/PropertyIndex';
import { areaOptions, sortProperties } from '@/lib/view-models/property-sort';

const mocks = vi.hoisted(() => ({ matchMobile: false }));
vi.mock('next/navigation', () => ({ usePathname: () => '/demo/properties', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, onNavigate: _onNavigate, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { onNavigate?: unknown }) => <a href={href} {...props} /> }));
vi.mock('@/components/properties/PropertyEditorHost', () => ({ usePropertyEditor: () => ({ enabled: false, openCreate: vi.fn(), openImport: vi.fn(), openGroups: vi.fn() }) }));
vi.mock('@/components/properties/PositionReview', () => ({ PositionReview: () => null }));
vi.mock('@/lib/design/use-mobile-dashboard', () => ({ useMobileDashboard: () => mocks.matchMobile }));
vi.mock('@/lib/state/dashboard-state', () => ({ useDashboard: () => ({
  portfolio: demoPortfolio, mode: 'demo', ready: true, basePath: '/demo', group: 'all', setGroup: vi.fn(), openProperty: vi.fn(),
  isSmsOn: (s: PropertySnapshot) => s.sms.enabled, isRuleOn: (_id: string, fallback: boolean) => fallback,
}) }));

beforeEach(() => {
  sessionStorage.clear();
  mocks.matchMobile = false;
});
afterEach(() => cleanup());

const base = demoPortfolio.properties[0]!;
function row(name: string, o: { status?: PropertyStatus; risk?: number | null; municipality?: string | null; alerts?: number; warning?: 'Yellow' | 'Orange' | 'Red' | 'VMA' | 'Info' } = {}) {
  const snapshot: PropertySnapshot = {
    ...base,
    property: { ...base.property, id: name, name, status: o.status ?? 'normal', municipality: o.municipality === undefined ? 'Solna' : o.municipality, area: '' },
    riskIndex: o.risk === null ? undefined : { ...(base.riskIndex ?? { level: 'low', summary: '', factors: [] }), score: o.risk ?? 10 } as PropertySnapshot['riskIndex'],
    activeAlertCount: o.alerts ?? 0,
    warnings: o.warning ? [{ ...(base.warnings[0] ?? ({} as PropertySnapshot['warnings'][number])), level: o.warning }] : [],
  };
  return { snapshot };
}
const names = (rows: Array<{ snapshot: PropertySnapshot }>) => rows.map((r) => r.snapshot.property.name);

describe('sorting the property list', () => {
  const rows = [
    row('Örnen', { status: 'warning', risk: 60, municipality: 'Täby', alerts: 2, warning: 'Orange' }),
    row('Ankan', { status: 'normal', risk: 10, municipality: 'Solna' }),
    row('Björken', { status: 'unknown', risk: null, municipality: null }),
    row('Cedern', { status: 'critical', risk: 80, municipality: 'Ängelholm', alerts: 5, warning: 'VMA' }),
    row('Duvan', { status: 'warning', risk: 70, municipality: 'Solna', alerts: 2, warning: 'Info' }),
  ];

  it('sorts each column both ways with missing values last, and ties by risk then name', () => {
    expect(names(sortProperties(rows, 'name'))).toEqual(['Ankan', 'Björken', 'Cedern', 'Duvan', 'Örnen']);
    expect(names(sortProperties(rows, 'name', 'desc'))).toEqual(['Örnen', 'Duvan', 'Cedern', 'Björken', 'Ankan']);
    expect(names(sortProperties(rows, 'risk'))).toEqual(['Cedern', 'Duvan', 'Örnen', 'Ankan', 'Björken']);
    expect(names(sortProperties(rows, 'risk', 'asc'))).toEqual(['Ankan', 'Örnen', 'Duvan', 'Cedern', 'Björken']);
    // Status: two warnings tie and the higher risk comes first; "Ej bedömd" last both ways.
    expect(names(sortProperties(rows, 'status'))).toEqual(['Cedern', 'Duvan', 'Örnen', 'Ankan', 'Björken']);
    expect(names(sortProperties(rows, 'status', 'asc'))).toEqual(['Ankan', 'Duvan', 'Örnen', 'Cedern', 'Björken']);
    // Swedish order: Ä after Å after Z, so Täby before Ängelholm; no area last.
    expect(names(sortProperties(rows, 'area'))).toEqual(['Duvan', 'Ankan', 'Örnen', 'Cedern', 'Björken']);
    // Warning: VMA, then Orange; an "Info" message is not an official warning.
    expect(names(sortProperties(rows, 'warning'))).toEqual(['Cedern', 'Örnen', 'Duvan', 'Ankan', 'Björken']);
    expect(names(sortProperties(rows, 'alerts'))).toEqual(['Cedern', 'Duvan', 'Örnen', 'Ankan', 'Björken']);
    expect(areaOptions(rows)).toEqual([{ area: 'Solna', count: 2 }, { area: 'Täby', count: 1 }, { area: 'Ängelholm', count: 1 }]);
  });
});

describe('property table', () => {
  const tableNames = () => within(screen.getByRole('table', { name: 'Bevakningsstatus per fastighet' })).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent);

  it('sorts by a header, turns the order around on a second click, and marks the column', () => {
    render(<PropertyIndex />);
    const header = (name: RegExp) => screen.getByRole('columnheader', { name });
    expect(header(/Riskpoäng/).getAttribute('aria-sort')).toBe('descending');
    expect(screen.getByText(/sorterat efter risk$/)).toBeTruthy();

    fireEvent.click(within(header(/Fastighet/)).getByRole('button'));
    expect(header(/Fastighet/).getAttribute('aria-sort')).toBe('ascending');
    expect(header(/Riskpoäng/).getAttribute('aria-sort')).toBe('none');
    const byName = [...demoPortfolio.properties].map((s) => s.property.name).sort((a, b) => a.localeCompare(b, 'sv-SE'));
    expect(tableNames().map((t) => t!.replace(/[\s\S]*?(?=\S)/, '')).map((t) => byName.find((n) => t.startsWith(n)))).toEqual(byName);

    fireEvent.click(within(header(/Fastighet/)).getByRole('button'));
    expect(header(/Fastighet/).getAttribute('aria-sort')).toBe('descending');
    expect(tableNames()[0]).toContain(byName.at(-1)!);
    expect(screen.getByText(/sorterat efter namn$/)).toBeTruthy();

    // Headers without a sort are plain text; status is a button.
    expect(within(header(/Väder nu/)).queryByRole('button')).toBeNull();
    fireEvent.click(within(header(/^Status/)).getByRole('button'));
    expect(header(/^Status/).getAttribute('aria-sort')).toBe('descending');
  });

  it('filters by area, counts statuses within it, and keeps the choice after leaving the page', () => {
    const view = render(<PropertyIndex />);
    const areas = areaOptions(demoPortfolio.properties.map((snapshot) => ({ snapshot })));
    expect(areas.length).toBeGreaterThan(1);
    const pick = areas[0]!;
    const select = screen.getByRole('combobox', { name: /Område/ }) as HTMLSelectElement;
    expect(select.options).toHaveLength(areas.length + 1);
    fireEvent.change(select, { target: { value: pick.area } });
    expect(screen.getByRole('status').textContent).toBe(`${pick.count} ${pick.count === 1 ? 'fastighet' : 'fastigheter'}`);
    expect(screen.getByRole('button', { name: `Alla ${pick.count}` })).toBeTruthy();
    view.unmount();
    render(<PropertyIndex />);
    expect((screen.getByRole('combobox', { name: /Område/ }) as HTMLSelectElement).value).toBe(pick.area);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'finns-inte' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rensa filter' }));
    expect((screen.getByRole('combobox', { name: /Område/ }) as HTMLSelectElement).value).toBe('all');
  });

  it('keeps the header row fixed in a scrolling table and leaves rows out of view unpainted', () => {
    render(<PropertyIndex />);
    const table = screen.getByRole('table', { name: 'Bevakningsstatus per fastighet' });
    const [head, first] = within(table).getAllByRole('row');
    expect(head!.style.position).toBe('sticky');
    expect((table.parentElement as HTMLElement).style.maxHeight).toContain('min(');
    expect(first!.getAttribute('style')).toContain('content-visibility: auto');
  });

  it('draws 100 rows at a time and the next 100 on request, from the top again after a new sort', async () => {
    const { scaleDemoPortfolio } = await import('@fastighetsradar/domain/fixtures');
    const big = scaleDemoPortfolio(demoPortfolio, 210);
    const dashboard = await import('@/lib/state/dashboard-state');
    const original = dashboard.useDashboard();
    vi.spyOn(dashboard, 'useDashboard').mockReturnValue({ ...original, portfolio: big });
    render(<PropertyIndex />);
    const drawn = () => within(screen.getByRole('table', { name: 'Bevakningsstatus per fastighet' })).getAllByRole('row').length - 1;
    expect(screen.getByRole('status').textContent).toBe('210 fastigheter');
    expect(drawn()).toBe(100);
    const more = screen.getByRole('group', { name: 'Fler fastigheter' });
    expect(more.textContent).toContain('Visar 100 av 210');
    fireEvent.click(within(more).getByRole('button', { name: 'Visa 100 till' }));
    expect(drawn()).toBe(200);
    expect(screen.getByRole('button', { name: 'Visa 10 till' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('group', { name: 'Fler fastigheter' })).getByRole('button', { name: 'Visa alla' }));
    expect(drawn()).toBe(210);
    expect(screen.queryByRole('group', { name: 'Fler fastigheter' })).toBeNull();
    fireEvent.click(within(screen.getByRole('columnheader', { name: /Fastighet/ })).getByRole('button'));
    expect(drawn()).toBe(100);
  }, 20_000);

  it('sorts the mobile cards from a menu', () => {
    mocks.matchMobile = true;
    render(<PropertyIndex />);
    fireEvent.change(screen.getByRole('combobox', { name: /Sortera/ }), { target: { value: 'area' } });
    const first = sortProperties(demoPortfolio.properties.map((snapshot) => ({ snapshot })), 'area')[0]!.snapshot.property.name;
    expect(screen.getAllByRole('link')[0]!.textContent).toContain(first);
  });
});
