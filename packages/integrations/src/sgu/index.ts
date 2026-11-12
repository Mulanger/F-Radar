import type { ObservationProvider } from '../types';
import { notImplemented } from '../not-implemented';

/**
 * SGU groundwater – OGC API Features (IMPLEMENTATION.md §9.6).
 * TODO(Agent 2 / Phase 5): observed stations + regional HYPE areas, labelled separately.
 */
export const sguGroundwaterAdapter: ObservationProvider = {
  id: 'sgu_groundwater',
  getNearestObservations: () => notImplemented('sgu_groundwater'),
};
