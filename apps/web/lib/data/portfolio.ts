import 'server-only';
import { cache } from 'react';
import { PortfolioSchema, type Portfolio } from '@fastighetsradar/domain';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
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

export async function loadDemoPortfolio(): Promise<PortfolioLoadResult> {
  if (!demoEnabled()) return { status: 'unavailable', mode: 'demo', reason: 'Demo mode is disabled.' };
  return { status: 'ok', mode: 'demo', portfolio: demoPortfolio };
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
    if (!parsed.success) return { status: 'unavailable', mode: 'live', reason: 'Portfolio API returned an unexpected payload.', code: 'api_error' };
    return { status: 'ok', mode: 'live', portfolio: parsed.data };
  } catch (err) {
    if (err instanceof InternalApiError) {
      if (err.status === 401) return { status: 'unavailable', mode: 'live', reason: 'Your session could not be verified.', code: 'unauthenticated' };
      if (err.status === 403) return { status: 'unavailable', mode: 'live', reason: 'Select or create an organization first.', code: 'organization_required' };
      return { status: 'unavailable', mode: 'live', reason: `Portfolio service error (${err.status}).`, code: 'api_error' };
    }
    return { status: 'unavailable', mode: 'live', reason: 'Portfolio service is unreachable.', code: 'api_error' };
  }
});
