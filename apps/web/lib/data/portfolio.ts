import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { PortfolioSchema, type Portfolio } from '@fastighetsradar/domain';
import { demoPortfolio, demoScaleSize, scaleDemoPortfolio } from '@fastighetsradar/domain/fixtures';
import { DEMO_SIZE_COOKIE } from '../demo/size';
import { InternalApiError, internalApiJson } from '../server/internal-api';

export type DataMode = 'demo' | 'live';

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
const scaledDemos = new Map<number, Portfolio>();
function scaledDemo(size: number): Portfolio {
  let portfolio = scaledDemos.get(size);
  if (!portfolio) {
    portfolio = scaleDemoPortfolio(demoPortfolio, size);
    if (scaledDemos.size >= 3) scaledDemos.delete(scaledDemos.keys().next().value!);
    scaledDemos.set(size, portfolio);
  }
  return portfolio;
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

export async function loadDemoPortfolio(size: number | null = null): Promise<PortfolioLoadResult> {
  if (!demoEnabled()) return { status: 'unavailable', mode: 'demo', reason: 'Demoläget är avstängt.' };
  const n = demoScaleSize(size, demoPortfolio.properties.length);
  return { status: 'ok', mode: 'demo', portfolio: n === null ? demoPortfolio : scaledDemo(n) };
}

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
