import type { SourceId } from '@fastighetsradar/domain';

/**
 * Implementation state per adapter. Flip to 'implemented' only when the adapter has
 * fixture-based contract tests AND a recorded live smoke test (IMPLEMENTATION.md §19 rule).
 */
export type AdapterImplementationState = 'not_implemented' | 'interface_only' | 'implemented';

export const ADAPTER_IMPLEMENTATION: Record<Exclude<SourceId, 'demo_other'>, AdapterImplementationState> = {
  smhi_forecast: 'interface_only',
  smhi_warnings: 'interface_only',
  smhi_observations: 'interface_only',
  smhi_oceanography: 'not_implemented',
  krisinformation: 'interface_only',
  air_quality: 'interface_only',
  sgu_groundwater: 'interface_only',
  mcf_flood: 'interface_only',
  scb: 'interface_only',
  trafikverket: 'interface_only',
  geoapify_geocoding: 'interface_only',
  lantmateriet_address: 'interface_only',
  boverket_energy: 'interface_only',
  sms_46elks: 'interface_only',
};
