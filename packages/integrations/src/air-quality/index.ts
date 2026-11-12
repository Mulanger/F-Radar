import type { ObservationProvider } from '../types';
import { notImplemented } from '../not-implemented';

/**
 * Air quality – Naturvårdsverket / SMHI datavärd luft (IMPLEMENTATION.md §9.5).
 * TODO(Agent 2 / Phase 5): discover stations/pollutants from the REST service before mapping.
 * No building-level AQI without a documented method. Note: the design's "AQI" value is demo-only.
 */
export const airQualityAdapter: ObservationProvider = {
  id: 'air_quality',
  getNearestObservations: () => notImplemented('air_quality'),
};
