// @vitest-environment jsdom
/**
 * Fas 3 (docs/plans/skalning.md, S-10/S-11/S-14): the property page loads ONE full snapshot and
 * hands it to the detail view; the SMS short link redirects without the dashboard layout.
 */
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import { PropertyDetailData, PropertyDetailProvider, usePropertyDetail } from '@/lib/state/property-detail';

const api = vi.hoisted(() => ({ calls: [] as string[], respond: (_path: string): unknown => ({}) }));
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_1', getToken: async () => 'tok' }) }));
vi.mock('@/lib/server/internal-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/internal-api')>();
  return {
    ...actual,
    internalApiJson: async (path: string) => {
      api.calls.push(path);
      const r = api.respond(path);
      if (r instanceof actual.InternalApiError) throw r;
      return r;
    },
  };
});
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); },
}));

const full = demoPortfolio.properties[2]!;
afterEach(cleanup);
beforeEach(() => { api.calls.length = 0; });

function Reader({ id }: { id: string }) {
  const d = usePropertyDetail(id);
  return <output>{d ? `${d.id}:${d.snapshot?.forecast?.series.length ?? 'none'}:${d.reason ?? ''}` : 'list only'}</output>;
}

describe('property detail registration', () => {
  it('is in place already in the server HTML when the page renders before the detail view', () => {
    const html = renderToString(
      <PropertyDetailProvider>
        <PropertyDetailData id={full.property.id} snapshot={full} />
        <Reader id={full.property.id} />
      </PropertyDetailProvider>,
    );
    expect(html).toContain(`${full.property.id}:${full.forecast!.series.length}:`);
  });

  it('follows client navigation and refreshes, and is never used for another property', () => {
    const other = demoPortfolio.properties[3]!;
    const view = (id: string, snapshot = full) => (
      <PropertyDetailProvider>
        <PropertyDetailData id={id} snapshot={id === full.property.id ? snapshot : other} />
        <Reader id={full.property.id} />
        <Reader id={other.property.id} />
      </PropertyDetailProvider>
    );
    const { rerender } = render(view(full.property.id));
    expect(screen.getAllByRole('status').map((o) => o.textContent)).toEqual([`${full.property.id}:${full.forecast!.series.length}:`, 'list only']);
    const refreshed = { ...full, forecast: { ...full.forecast!, series: full.forecast!.series.slice(0, 1) } };
    rerender(view(full.property.id, refreshed));
    expect(screen.getAllByRole('status')[0]!.textContent).toBe(`${full.property.id}:1:`);
    rerender(view(other.property.id));
    expect(screen.getAllByRole('status').map((o) => o.textContent)).toEqual(['list only', `${other.property.id}:${other.forecast!.series.length}:`]);
  });
});

describe('live property page (S-11)', () => {
  it('loads one property snapshot – never the whole portfolio – for the page and its title', async () => {
    api.respond = (path) => (path.endsWith('/snapshot') ? { generatedAt: demoPortfolio.generatedAt, snapshot: full, sources: [] } : {});
    const mod = await import('@/app/(dashboard)/properties/[propertyId]/page');
    const params = Promise.resolve({ propertyId: encodeURIComponent('id med mellanslag') });
    expect((await mod.generateMetadata({ params })).title).toBe(`${full.property.name} · FastighetsRadar`);
    const el = await mod.default({ params });
    expect(el.props).toMatchObject({ id: 'id med mellanslag', snapshot: full });
    expect(api.calls.every((p) => p === '/v1/properties/id%20med%20mellanslag/snapshot')).toBe(true);
    expect(api.calls).not.toContain('/v1/portfolio');
  });

  it('answers 404 for a property outside the organization and shows the list data when the API fails', async () => {
    const { InternalApiError } = await import('@/lib/server/internal-api');
    const mod = await import('@/app/(dashboard)/properties/[propertyId]/page');
    api.respond = () => new InternalApiError(404, null);
    await expect(mod.default({ params: Promise.resolve({ propertyId: 'other-org' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    api.respond = () => new InternalApiError(502, null);
    const el = await mod.default({ params: Promise.resolve({ propertyId: 'p1' }) });
    expect(el.props).toMatchObject({ id: 'p1', snapshot: null, reason: 'Fel i fastighetstjänsten (502).' });
  });
});

describe('SMS short link (S-14)', () => {
  it('redirects to the property without the dashboard layout', async () => {
    const mod = await import('@/app/p/[key]/page');
    api.respond = () => ({ id: 'prop 1' });
    await expect(mod.default({ params: Promise.resolve({ key: '0123456789abcdef' }) })).rejects.toThrow('NEXT_REDIRECT /properties/prop%201');
    expect(api.calls).toEqual(['/v1/notifications/links/0123456789abcdef']);
    await expect(mod.default({ params: Promise.resolve({ key: 'not-a-key' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    const { InternalApiError } = await import('@/lib/server/internal-api');
    api.respond = () => new InternalApiError(404, null);
    await expect(mod.default({ params: Promise.resolve({ key: 'fedcba9876543210' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
