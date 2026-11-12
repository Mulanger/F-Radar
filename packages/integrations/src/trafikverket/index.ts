import type { EventFeedProvider } from '../types';
import { notImplemented } from '../not-implemented';

/**
 * Trafikverket open traffic API (IMPLEMENTATION.md §9.10).
 * Requires TRAFIKVERKET_ENABLED=true and TRAFIKVERKET_API_KEY. Until then the source
 * status is `pending_access` and nothing is called.
 * TODO(Agent 2 / Phase 9): implement from the current official data model (e.g. `Situation`).
 */
export const trafikverketAdapter: EventFeedProvider = {
  id: 'trafikverket',
  fetchActive: (ctx) =>
    !ctx.env.TRAFIKVERKET_ENABLED || !ctx.env.TRAFIKVERKET_API_KEY
      ? Promise.resolve({ ok: false, error: 'access_required', detail: 'TRAFIKVERKET_API_KEY missing or source disabled' })
      : notImplemented('trafikverket'),
};
