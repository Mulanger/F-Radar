import type { SourceId } from '@fastighetsradar/domain';

/**
 * Implementation state per adapter. Flip to 'implemented' only when the adapter has
 * fixture-based contract tests AND a recorded live smoke test (IMPLEMENTATION.md §19 rule).
 */
export type AdapterImplementationState = 'not_implemented' | 'interface_only' | 'implemented';

export const ADAPTER_IMPLEMENTATION: Record<Exclude<SourceId, 'demo_other'>, AdapterImplementationState> = {
  smhi_forecast: 'implemented', // Phase 3: fixture tests + live smoke test 2026-11-13
  smhi_warnings: 'implemented', // Phase 3: fixture tests + live smoke test 2026-11-13
  smhi_observations: 'implemented', // Phase 3: fixture tests + live smoke test 2026-11-13
  smhi_oceanography: 'implemented', // fixtures + adapter live test 2026-11-14 (catalogue and hourly RH 2000)
  sgu_observed_groundwater: 'implemented', // fixtures + adapter live test 2026-11-14 (station + measured depth)
  sl_deviations: 'interface_only', // endpoints tested without key; locally gated adapter not live-enabled
  krisinformation: 'implemented', // Phase 3: fixture tests + live smoke test 2026-11-13
  air_quality: 'implemented', // fixtures + five-pollutant adapter live test 2026-11-14; EEA method ADR 0005
  sgu_groundwater: 'implemented', // Phase 3: fixture tests + live smoke test 2026-11-13
  mcf_flood: 'implemented', // Phase 3: fixture tests + live smoke test 2026-11-13
  scb: 'implemented', // Phase 3: fixture tests + live smoke test 2026-11-13
  trafikverket: 'implemented', // fixtures + road-ferry Situation live test 2026-11-14
  geoapify_geocoding: 'implemented', // contract tests + live smoke test 2026-11-12
  lantmateriet_address: 'interface_only',
  boverket_energy: 'interface_only',
  sms_46elks: 'interface_only',
};
