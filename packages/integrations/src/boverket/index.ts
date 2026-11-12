import type { AdapterResult } from '../types';

/**
 * Boverket energideklarationer (IMPLEMENTATION.md §9.12).
 * Deactivated interface only. Must stay off until written legal clearance exists for
 * customer-facing SaaS use. Energy class must never be shown as "fetched data" before then.
 */
export interface BoverketEnergyAdapter {
  readonly id: 'boverket_energy';
  getDeclaration(propertyId: string): Promise<AdapterResult<never>>;
}

export const boverketAdapter: BoverketEnergyAdapter = {
  id: 'boverket_energy',
  getDeclaration: async () => ({ ok: false, error: 'disabled', detail: 'Boverket integration is disabled pending legal clearance' }),
};
