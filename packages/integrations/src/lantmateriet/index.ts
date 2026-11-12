import type { GeocodingProvider } from '../types';
import { notImplemented } from '../not-implemented';

/**
 * Lantmäteriet Referens Uppslag Adress v3 (IMPLEMENTATION.md §9.11).
 * OPTIONAL – must never block onboarding. Disabled unless LANTMATERIET_ENABLED=true
 * and organisation access has been granted.
 */
export const lantmaterietAdapter: GeocodingProvider = {
  id: 'lantmateriet_address',
  suggest: (_q, ctx) =>
    ctx.env.LANTMATERIET_ENABLED ? notImplemented('lantmateriet_address') : Promise.resolve({ ok: false, error: 'disabled' }),
  resolve: (_t, ctx) =>
    ctx.env.LANTMATERIET_ENABLED ? notImplemented('lantmateriet_address') : Promise.resolve({ ok: false, error: 'disabled' }),
};
