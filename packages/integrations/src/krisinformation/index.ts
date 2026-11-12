import type { EventFeedProvider } from '../types';
import { notImplemented } from '../not-implemented';

/**
 * Krisinformation v3 (IMPLEMENTATION.md §9.4).
 * TODO(Agent 2 / Phase 4): GET `${KRISINFORMATION_BASE_URL}/news?format=json&allcounties=true`.
 * County-level areas must be labelled "regional information", never an exact local incident.
 */
export const krisinformationAdapter: EventFeedProvider = {
  id: 'krisinformation',
  fetchActive: () => notImplemented('krisinformation'),
};
