import { z } from 'zod';
import { IsoDateTimeSchema, PropertyStatusSchema, SourceIdSchema } from './common';
import { WarningLevelSchema } from './entities';

/**
 * One event over many properties – the page a feed card and a grouped SMS open
 * (docs/plans/skalning.md, Fas 2 / S-09): the official text once, the organization's affected
 * properties on a map and in a searchable list, and "Kvittera alla".
 */
export const EventPagePropertySchema = z.object({
  propertyId: z.string(),
  name: z.string(),
  address: z.string(),
  location: z.object({ lat: z.number(), lon: z.number() }),
  /** The newest feed row of this event at the property ("chg-…"), which is what gets acknowledged. */
  changeId: z.string().nullable(),
  changeType: z.string().nullable(),
  /** Still inside the event's area (matched), or only in the history (e.g. ended). */
  matched: z.boolean(),
  ackRequired: z.boolean(),
  acknowledgedAt: IsoDateTimeSchema.nullable(),
});
export type EventPageProperty = z.infer<typeof EventPagePropertySchema>;

export const EventPageSchema = z.object({
  generatedAt: IsoDateTimeSchema,
  event: z.object({
    id: z.string(),
    sourceId: SourceIdSchema,
    sourceLabel: z.string(),
    title: z.string(),
    level: WarningLevelSchema.nullable(),
    severity: PropertyStatusSchema,
    /** The official text, once (not per property). */
    description: z.string().nullable(),
    areaLabel: z.string().nullable(),
    publishedAt: IsoDateTimeSchema.nullable(),
    validFrom: IsoDateTimeSchema.nullable(),
    validTo: IsoDateTimeSchema.nullable(),
    active: z.boolean(),
    sourceUrl: z.string().nullable(),
    origin: z.enum(['live', 'demo_fixture']),
  }),
  properties: z.array(EventPagePropertySchema),
});
export type EventPage = z.infer<typeof EventPageSchema>;

/**
 * The short key of an event in an SMS link (`/h/<key>`): the first 16 hex digits of its id. The page
 * behind it is only shown to the organization the event reaches, so the key need not be secret.
 */
export function eventLinkKey(eventId: string): string | null {
  const hex = eventId.replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(hex) ? hex.slice(0, 16) : null;
}
