import type { StatisticsProvider } from '../types';
import { notImplemented } from '../not-implemented';

/**
 * SCB PxWebApi v2 (IMPLEMENTATION.md §9.8). Context panel only, never real-time.
 * TODO(Agent 2 / Phase 5): pick explicit table IDs after metadata review; respect 30 calls/10 s.
 */
export const scbAdapter: StatisticsProvider = {
  id: 'scb',
  getContextStatistics: () => notImplemented('scb'),
};
