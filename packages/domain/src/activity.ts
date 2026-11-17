import { z } from 'zod';

/** Window and size of a property's short activity log ("Tidslinje"). Not a permanent journal. */
export const ACTIVITY = { days: 7, limit: 15 } as const;

/** A stored monitoring change (warning issued/updated/ended, VMA, outage) for one property. */
export const ActivityChangeSchema = z.object({
  kind: z.literal('change'),
  id: z.string(),
  at: z.iso.datetime(),
  sourceId: z.string(),
  changeType: z.enum(['new', 'updated', 'ended', 'cancelled']),
  severity: z.string(),
  /** SMHI level of the event (Yellow/Orange/Red/Info) or VMA; null for other sources. */
  level: z.string().nullable(),
  headline: z.string(),
  attribution: z.string().nullable(),
});

/** SMS alerts for the property, grouped per rule, status and minute (one row per recipient in the outbox). */
export const ActivitySmsSchema = z.object({
  kind: z.literal('sms'),
  id: z.string(),
  at: z.iso.datetime(),
  ruleName: z.string(),
  status: z.string(),
  recipients: z.number().int().nonnegative(),
  isTest: z.boolean(),
});

export const ActivityItemSchema = z.discriminatedUnion('kind', [ActivityChangeSchema, ActivitySmsSchema]);
export type ActivityItem = z.infer<typeof ActivityItemSchema>;

export const PropertyActivitySchema = z.object({
  propertyId: z.string(),
  since: z.iso.datetime(),
  items: z.array(ActivityItemSchema),
});
export type PropertyActivity = z.infer<typeof PropertyActivitySchema>;
