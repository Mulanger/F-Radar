import 'server-only';
import { resolveDataMode, type DataMode } from '@fastighetsradar/config';
import type { Portfolio } from '@fastighetsradar/domain';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';

export type PortfolioLoadResult =
  | { status: 'ok'; mode: DataMode; portfolio: Portfolio }
  | { status: 'unavailable'; mode: DataMode; reason: string };

/** Data mode is chosen server-side. Default is `demo` until live adapters exist. */
export function getDataMode(): DataMode {
  return resolveDataMode(process.env.FASTIGHETSRADAR_DATA_MODE);
}

/**
 * Loads the portfolio snapshot for the dashboard.
 *
 *  - demo: returns the labelled design fixtures.
 *  - live: will call the FastighetsRadar API (`GET /v1/portfolio/...`, Agent 2).
 *    Until that exists it returns `unavailable` – it NEVER falls back to fixtures.
 */
export async function loadPortfolio(): Promise<PortfolioLoadResult> {
  const mode = getDataMode();
  if (mode === 'demo') return { status: 'ok', mode, portfolio: demoPortfolio };
  return {
    status: 'unavailable',
    mode,
    reason: 'Live portfolio API is not implemented yet. No demo data is shown in live mode.',
  };
}
