// @vitest-environment jsdom
/**
 * Fas 3 / S-12 (docs/plans/skalning.md): a live hint fetches only the changed rows and patches them
 * into the shown portfolio; only what a patch cannot rebuild reloads the whole dashboard.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import type { Portfolio, PortfolioRowsPatch, PropertySnapshot, StreamUpdate } from '@fastighetsradar/domain';
import { DashboardStateProvider, useDashboard } from '@/lib/state/dashboard-state';
import { PropertyDetailData, PropertyDetailProvider, usePropertyDetail } from '@/lib/state/property-detail';
import { useLiveUpdates } from '@/lib/live/use-live-updates';

const nav = vi.hoisted(() => ({ router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() } }));
vi.mock('next/navigation', () => ({ usePathname: () => '/overview', useRouter: () => nav.router, useSearchParams: () => new URLSearchParams() }));

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {}
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

const base: Portfolio = { ...demoPortfolio, activeAlarms: [] };
const row = base.properties[1]!;
const id = row.property.id;
const hint = (u: Partial<StreamUpdate>): StreamUpdate => ({ at: base.generatedAt, sources: ['smhi_forecast'], propertyIds: [], changes: 0, ...u });
const patched = (reason: string): PropertySnapshot => ({ ...row, property: { ...row.property, statusReason: reason } });
let fetchMock: ReturnType<typeof vi.fn>;

function Probe() {
  const mode = useLiveUpdates();
  const ds = useDashboard();
  const detail = usePropertyDetail(id);
  return (
    <>
      <output data-testid="list">{`${mode}|${ds.portfolio.properties[1]!.property.statusReason}`}</output>
      <output data-testid="detail">{detail?.snapshot?.property.statusReason ?? 'none'}</output>
    </>
  );
}
const view = (detail?: PropertySnapshot) => (
  <DashboardStateProvider mode="live" basePath="" portfolio={base}>
    <PropertyDetailProvider>
      {detail && <PropertyDetailData id={id} snapshot={detail} />}
      <Probe />
    </PropertyDetailProvider>
  </DashboardStateProvider>
);
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const send = (u: StreamUpdate) => act(() => FakeEventSource.last!.emit('update', u));
const setVisibility = (v: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.stubGlobal('EventSource', FakeEventSource);
  setVisibility('visible');
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/app/portfolio/rows')) {
      const body: PortfolioRowsPatch = { generatedAt: '2026-11-22T12:00:00Z', properties: [patched('Patchad rad')], missing: [], feed: base.feed, alarmCandidates: [], upcoming: [], sources: base.sources };
      return Response.json(body);
    }
    if (url.includes('/snapshot')) return Response.json({ generatedAt: base.generatedAt, snapshot: patched('Ny detalj'), sources: base.sources });
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  nav.router.refresh.mockClear();
  FakeEventSource.last = null;
});

it('patches the changed row instead of reloading the dashboard', async () => {
  render(view());
  act(() => FakeEventSource.last!.emit('hello', {}));
  send(hint({ propertyIds: [id] }));
  expect(fetchMock).not.toHaveBeenCalled(); // waits (and jitters) before asking
  await advance(5_000);
  expect(fetchMock).toHaveBeenCalledWith(`/api/app/portfolio/rows?ids=${encodeURIComponent(id)}`, expect.anything());
  expect(screen.getByTestId('list').textContent).toBe('live|Patchad rad');
  expect(nav.router.refresh).not.toHaveBeenCalled();

  // A central source the list shows (air quality near every property): one full reload, 15 s later at the earliest.
  send(hint({ sources: ['air_quality'], all: true }));
  await advance(5_000);
  expect(nav.router.refresh).not.toHaveBeenCalled();
  await advance(15_000);
  expect(nav.router.refresh).toHaveBeenCalledTimes(1);
});

it('reloads only the open property for station data the list does not show', async () => {
  render(view(row));
  expect(screen.getByTestId('detail').textContent).toBe(row.property.statusReason ?? 'none');
  send(hint({ sources: ['smhi_observations'], all: true }));
  await advance(5_000);
  expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([`/api/app/properties/${encodeURIComponent(id)}/snapshot`]);
  expect(screen.getByTestId('detail').textContent).toBe('Ny detalj');
  expect(nav.router.refresh).not.toHaveBeenCalled();
});

it('waits in a hidden tab and catches up when it is shown', async () => {
  render(view());
  setVisibility('hidden');
  send(hint({ propertyIds: [id] }));
  await advance(60_000);
  expect(fetchMock).not.toHaveBeenCalled();
  setVisibility('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await advance(5_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('list').textContent).toContain('Patchad rad');
});
