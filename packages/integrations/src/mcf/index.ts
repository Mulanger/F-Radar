import type { FloodExposureProvider } from '../types';
import { notImplemented } from '../not-implemented';

/**
 * MCF Översvämningsportalen (IMPLEMENTATION.md §9.7).
 * TODO(Agent 2 / Phase 5): inventory verified GIS layers in MCF_GIS_DATASET_MANIFEST;
 * import to PostGIS (ST_Intersects) or render via WMS. Static scenario ≠ current water level.
 */
export const mcfFloodAdapter: FloodExposureProvider = {
  id: 'mcf_flood',
  getMappedExposure: () => notImplemented('mcf_flood'),
};
