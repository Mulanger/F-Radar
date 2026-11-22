import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { PortfolioSchema, PropertySnapshotSchema, listPortfolio, type Portfolio, type PropertySnapshot } from '@fastighetsradar/domain';
import { demoPortfolio, demoScaleSize, scaleDemoPortfolio } from '@fastighetsradar/domain/fixtures';
import { DEMO_SIZE_COOKIE } from '../demo/size';
import { InternalApiError, internalApiJson } from '../server/internal-api';

export type DataMode = 'demo' | 'live';

export type PropertySnapshotLoadResult =
  | { status: 'ok'; snapshot: PropertySnapshot }
  | { status: 'not_found' }
  | { status: 'unavailable'; reason: string };

export type PortfolioLoadResult =
  | { status: 'ok'; mode: DataMode; portfolio: Portfolio }
  | { status: 'unavailable'; mode: DataMode; reason: string; code?: 'unauthenticated' | 'organization_required' | 'api_error' };

/**
 * The fixture dashboard (`/demo/*`) exists for design comparison only and is OFF unless
 * explicitly enabled. It never mixes with customer data.
 */
export function demoEnabled(): boolean {
  return process.env.FASTIGHETSRADAR_DEMO_ENABLED === 'true';
}

/** Scaled test portfolios are deterministic; keep the last few sizes instead of rebuilding per request. */
const scaledDemos = new Map<number, { full: Portfolio; list: Portfolio }>();
function demoPortfolios(size: number | null): { full: Portfolio; list: Portfolio } {
  const key = size ?? 0;
  let entry = scaledDemos.get(key);
  if (!entry) {
    const full = size === null ? demoPortfolio : scaleDemoPortfolio(demoPortfolio, size);
    entry = { full, list: listPortfolio(full) };
    if (scaledDemos.size >= 4) scaledDemos.delete(scaledDemos.keys().next().value!);
    scaledDemos.set(key, entry);
  }
  return entry;
}

/**
 * Test-portfolio size chosen with `/demo?n=…` (docs/plans/skalning.md, Fas 0); null = the original demo.
 * Development and tests only: a production build always serves the eight-property demo, so the size
 * cookie can never make the server build (and hold) a portfolio of thousands of properties.
 */
export async function requestedDemoSize(): Promise<number | null> {
  if (process.env.NODE_ENV === 'production') return null;
  return demoScaleSize((await cookies()).get(DEMO_SIZE_COOKIE)?.value, demoPortfolio.properties.length);
}

/**
 * The demo portfolio as the dashboard layout gets it: the same LIST shape as live (S-10), so the
 * split between list and property page can be verified locally.
 */
export async function loadDemoPortfolio(size: number | null = null): Promise<PortfolioLoadResult> {
  if (!demoEnabled()) return { status: 'unavailable', mode: 'demo', reason: 'Demoläget är avstängt.' };
  return { status: 'ok', mode: 'demo', portfolio: demoPortfolios(demoScaleSize(size, demoPortfolio.properties.length)).list };
}

/** Full snapshot of one demo property (the property page), like `/v1/properties/:id/snapshot` live. */
export async function loadDemoPropertySnapshot(size: number | null, id: string): Promise<PropertySnapshotLoadResult> {
  if (!demoEnabled()) return { status: 'not_found' };
  const full = demoPortfolios(demoScaleSize(size, demoPortfolio.properties.length)).full;
  const snapshot = full.properties.find((s) => s.property.id === id);
  return snapshot ? { status: 'ok', snapshot } : { status: 'not_found' };
}

/**
 * Full snapshot of ONE property of the signed-in organization (property page and its metadata;
 * S-10/S-11). The API checks that the property belongs to the organization. Deduplicated per request.
 */
export const loadLivePropertySnapshot = cache(async (id: string): Promise<PropertySnapshotLoadResult> => {
  try {
    const body = await internalApiJson<{ snapshot?: unknown }>(`/v1/properties/${encodeURIComponent(id)}/snapshot`);
    const parsed = PropertySnapshotSchema.safeParse(body?.snapshot);
    return parsed.success ? { status: 'ok', snapshot: parsed.data } : { status: 'unavailable', reason: 'Fastighetstjänsten returnerade ett oväntat svar.' };
  } catch (err) {
    if (err instanceof InternalApiError && (err.status === 404 || err.status === 400)) return { status: 'not_found' };
    return { status: 'unavailable', reason: err instanceof InternalApiError ? `Fel i fastighetstjänsten (${err.status}).` : 'Fastighetstjänsten går inte att nå.' };
  }
});

/**
 * Loads the signed-in organization's REAL portfolio from the API. Never falls back to
 * fixtures: on any failure the UI shows an explicit unavailable state.
 * Deduplicated per request (layout + page).
 */
export const loadLivePortfolio = cache(async (): Promise<PortfolioLoadResult> => {
  try {
    const body = await internalApiJson<unknown>('/v1/portfolio');
    const parsed = PortfolioSchema.safeParse(body);
    if (!parsed.success) return { status: 'unavailable', mode: 'live', reason: 'Portföljtjänsten returnerade ett oväntat svar.', code: 'api_error' };
    return { status: 'ok', mode: 'live', portfolio: parsed.data };
  } catch (err) {
    if (err instanceof InternalApiError) {
      if (err.status === 401) return { status: 'unavailable', mode: 'live', reason: 'Din inloggning kunde inte verifieras.', code: 'unauthenticated' };
      if (err.status === 403) return { status: 'unavailable', mode: 'live', reason: 'Välj eller skapa en organisation först.', code: 'organization_required' };
      return { status: 'unavailable', mode: 'live', reason: `Fel i portföljtjänsten (${err.status}).`, code: 'api_error' };
    }
    return { status: 'unavailable', mode: 'live', reason: 'Portföljtjänsten går inte att nå.', code: 'api_error' };
  }
});
