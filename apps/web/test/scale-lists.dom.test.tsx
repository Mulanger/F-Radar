// @vitest-environment jsdom
/**
 * Fas 1 (docs/plans/skalning.md): lists that must stay usable with hundreds of properties –
 * the property list search (S-03) and the SMS rule's property
 * selection and activity log (S-27).
 */
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { demoPortfolio, scaleDemoPortfolio } from '@fastighetsradar/domain/fixtures';
import { DashboardStateProvider } from '@/lib/state/dashboard-state';
import { buildOverviewVM } from '@/lib/view-models/overview';
import { PropertyIndex } from '@/components/properties/PropertyIndex';
import { PropertyNamesSummary, RulePropertySelect } from '@/components/notifications/RulePropertySelect';

vi.mock('next/navigation', () => ({ usePathname: () => '/demo/properties', useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props} /> }));
vi.mock('@/components/properties/PropertyEditorHost', () => ({ usePropertyEditor: () => ({ enabled: false, openCreate: () => {}, openEdit: () => {} }) }));
vi.mock('@/lib/design/use-mobile-dashboard', () => ({ useMobileDashboard: () => false, useAndroidNavigation: () => false }));
vi.mock('@/lib/view-models/overview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/view-models/overview')>();
  return { ...actual, buildOverviewVM: vi.fn(actual.buildOverviewVM) };
});

afterEach(cleanup);

describe('property list search (S-03)', () => {
  it('filters as you type without rebuilding the overview view model', async () => {
    const portfolio = scaleDemoPortfolio(demoPortfolio, 60);
    render(<DashboardStateProvider mode="demo" basePath="/demo" portfolio={portfolio}><PropertyIndex /></DashboardStateProvider>);
    const search = screen.getByRole('searchbox', { name: 'Sök fastighet, adress eller område' });
    await screen.findByText('60 fastigheter', { selector: '[role=status]' });
    // The provider flips `ready` 120 ms after mount (bars animate in); that rebuild is expected.
    await new Promise((r) => setTimeout(r, 200));
    const builds = vi.mocked(buildOverviewVM).mock.calls.length;
    for (const value of ['g', 'gö', 'göt', 'götg', 'götgården 1']) fireEvent.change(search, { target: { value } });
    await screen.findByText(/^\d+ fastighet(er)?$/, { selector: '[role=status]' });
    const matches = portfolio.properties.filter((s) => s.property.name.toLocaleLowerCase('sv-SE').includes('götgården 1')).length;
    expect(await screen.findByText(`${matches} ${matches === 1 ? 'fastighet' : 'fastigheter'}`, { selector: '[role=status]' })).toBeTruthy();
    expect(vi.mocked(buildOverviewVM).mock.calls.length).toBe(builds);
  });
});

describe('SMS rule property selection (S-27)', () => {
  const properties = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: i % 4 === 0 ? `Hamnvägen ${i}` : `Kajen ${i}` }));

  function view(initial: string[] = []) {
    let selected = initial;
    const onChange = vi.fn((ids: string[]) => {
      selected = ids;
      rerender(<RulePropertySelect properties={properties} selected={selected} onChange={onChange} />);
    });
    const { rerender } = render(<RulePropertySelect properties={properties} selected={selected} onChange={onChange} />);
    return { onChange, selected: () => selected };
  }

  it('searches, selects everything that matches and counts the selection', () => {
    const v = view(['p1']);
    expect(screen.getByRole('status').textContent).toBe('1 av 40 valda');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Sök fastighet för regeln' }), { target: { value: 'HAMNVÄG' } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Markera alla som syns (10)' }));
    expect(v.selected()).toHaveLength(11);
    expect(screen.getByRole('status').textContent).toBe('11 av 40 valda');
    expect(screen.getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Avmarkera alla som syns' }));
    expect(v.selected()).toEqual(['p1']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Sök fastighet för regeln' }), { target: { value: 'ingen sådan' } });
    expect(screen.getByText('Inga fastigheter matchar ”ingen sådan”.')).toBeTruthy();
  });

  it('shortens long property lists in the activity log', () => {
    const names = Array.from({ length: 300 }, (_, i) => `Fastighet ${i}`);
    const { container } = render(<div><PropertyNamesSummary names={names} /></div>);
    expect(container.textContent).toBe('Fastighet 0, Fastighet 1 och 298 till');
    fireEvent.click(screen.getByRole('button', { name: 'Visa alla 300 fastigheter' }));
    expect(container.textContent).toContain('Fastighet 299');
    cleanup();
    const short = render(<div><PropertyNamesSummary names={['A', 'B', 'C']} /></div>);
    expect(short.container.textContent).toBe('A, B, C');
  });
});
