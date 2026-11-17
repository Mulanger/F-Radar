import { z } from 'zod';

/**
 * How far from a property Trafikverket events count (matching, the property page, the feed and the
 * upper bound for traffic SMS). Chosen per organization under Inställningar; new organizations start
 * at `default`.
 */
export const TRAFFIC_RADIUS = { min: 100, max: 3_000, step: 100, default: 500 } as const;

export const TrafficRadiusSchema = z
  .number()
  .int()
  .min(TRAFFIC_RADIUS.min)
  .max(TRAFFIC_RADIUS.max)
  .refine((v) => v % TRAFFIC_RADIUS.step === 0, `Avståndet anges i steg om ${TRAFFIC_RADIUS.step} m`);

export const OrganizationSettingsSchema = z.object({ trafficRadiusM: TrafficRadiusSchema });
export type OrganizationSettings = z.infer<typeof OrganizationSettingsSchema>;

/** GET /v1/settings: the settings plus whether this user may change them (organization admins). */
export const OrganizationSettingsResponseSchema = OrganizationSettingsSchema.extend({ canEdit: z.boolean() });
export type OrganizationSettingsResponse = z.infer<typeof OrganizationSettingsResponseSchema>;

/** "500 m" / "1,5 km" / "3 km" */
export function formatTrafficRadius(m: number): string {
  if (m < 1000) return `${m} m`;
  const km = m / 1000;
  return `${Number.isInteger(km) ? km : km.toFixed(1).replace('.', ',')} km`;
}
