import { z } from 'zod';
import { IsoDateTimeSchema, type SourceId } from './common';
import {
  DataSourceStatusSchema,
  FeedItemSchema,
  PropertySnapshotSchema,
  UpcomingConditionSchema,
  type FeedItem,
  type OfficialWarning,
  type PropertySnapshot,
  type UpcomingCondition,
} from './entities';
import { NowcastSchema } from './nowcast';
import type { UtilityOutageView } from './utility-outages';

/**
 * Live updates by row (docs/plans/skalning.md, Fas 3 / S-12).
 *
 * The live stream says WHICH properties changed. An open dashboard then fetches only those rows
 * (`/v1/portfolio/rows?ids=…`) – or only the radar nowcast (`/v1/portfolio/nowcast`) – and patches
 * them into the list it already has, instead of reloading the whole portfolio. A full reload is
 * left for changes that touch many properties or the parts a row patch cannot recompute.
 */

/** At most this many properties are patched by row; more → one full reload. */
export const ROWS_PATCH_MAX = 50;
/** Sources the portfolio list never shows (only the property page): an update reloads the open property only. */
export const DETAIL_ONLY_SOURCES: readonly SourceId[] = ['smhi_observations'];
/** Sources whose updates change portfolio-level parts a row patch does not rebuild (utility coverage). */
export const FULL_RELOAD_SOURCES: readonly SourceId[] = ['utility_outages'];

export const PortfolioRowsPatchSchema = z.object({
  generatedAt: IsoDateTimeSchema,
  /** List rows (`listSnapshot`) of the requested properties that still exist in the organization. */
  properties: z.array(PropertySnapshotSchema),
  /** Requested ids that are not (or no longer) in the organization. */
  missing: z.array(z.string()),
  /** The organization's feed, built as in the full portfolio. */
  feed: z.array(FeedItemSchema),
  /** Every alarm row that may be active; the client keeps those active in its rows (`filterActiveAlarms`). */
  alarmCandidates: z.array(FeedItemSchema),
  /** All upcoming conditions of the requested properties. */
  upcoming: z.array(UpcomingConditionSchema),
  sources: z.array(DataSourceStatusSchema),
});
export type PortfolioRowsPatch = z.infer<typeof PortfolioRowsPatchSchema>;

export const PortfolioNowcastPatchSchema = z.object({
  generatedAt: IsoDateTimeSchema,
  nowcasts: z.array(z.object({ propertyId: z.string(), nowcast: NowcastSchema.nullable() })),
  sources: z.array(DataSourceStatusSchema),
});
export type PortfolioNowcastPatch = z.infer<typeof PortfolioNowcastPatchSchema>;

const TONE_RANK: Record<UpcomingCondition['tone'], number> = { critical: 0, warning: 1, monitor: 2, cold: 3 };

/** Official first, then the most severe, then the soonest; the id keeps ties in a stable order. */
export function compareUpcoming(a: UpcomingCondition, b: UpcomingCondition): number {
  return Number(!!b.official) - Number(!!a.official)
    || TONE_RANK[a.tone] - TONE_RANK[b.tone]
    || (a.validAt ?? '').localeCompare(b.validAt ?? '')
    || a.id.localeCompare(b.id);
}

/**
 * Replace the patched properties' conditions and retain the full set for grouping and counting.
 */
export function mergeUpcoming(previous: UpcomingCondition[], candidates: UpcomingCondition[], propertyIds: Iterable<string>): UpcomingCondition[] {
  const ids = new Set(propertyIds);
  return [...previous.filter((u) => !u.propertyId || !ids.has(u.propertyId)), ...candidates].sort(compareUpcoming);
}

function* activeAlerts(snapshots: readonly PropertySnapshot[]): Generator<[string, OfficialWarning | UtilityOutageView]> {
  for (const s of snapshots) {
    for (const warning of s.warnings) if (warning.level !== 'Info') yield [s.property.id, warning];
    for (const section of s.utilityOutages ?? []) {
      for (const outage of section.current) if (outage.severity === 'warning' || outage.severity === 'critical') yield [s.property.id, outage];
    }
  }
}

/** SMHI can publish separate areas under the same warning; fixture ids can differ by property. */
export function officialWarningEventKey(warning: OfficialWarning): string {
  const { externalId, sourceId } = warning;
  const sourceKey = sourceId === 'smhi_warnings' ? externalId?.split(':', 1)[0] : externalId;
  const fallback = warning.origin === 'demo_fixture'
    ? JSON.stringify([warning.level, warning.type, warning.region, warning.validFrom, warning.validTo])
    : warning.id;
  return `${sourceId}:${sourceKey ?? fallback}`;
}

/** Count each active warning or outage once across the supplied properties. */
export function countActiveAlertEvents(snapshots: readonly PropertySnapshot[]): number {
  const warnings = new Set<string>();
  const outages = new Set<string>();
  for (const [, event] of activeAlerts(snapshots)) {
    if ('sourceId' in event) warnings.add(officialWarningEventKey(event));
    else outages.add(event.id);
  }
  return warnings.size + outages.size;
}

/** `propertyId:eventId` of every active alarm: an official warning above Info, or a current outage at warning/critical. */
export function activeAlarmKeys(snapshots: PropertySnapshot[]): Set<string> {
  const active = new Set<string>();
  for (const [propertyId, event] of activeAlerts(snapshots)) active.add(`${propertyId}:${event.id}`);
  return active;
}

/** The alarm rows whose warning or outage is still active in these snapshots. */
export function filterActiveAlarms(items: FeedItem[], snapshots: PropertySnapshot[]): FeedItem[] {
  const active = activeAlarmKeys(snapshots);
  return items.filter((i) => i.eventId !== undefined && active.has(`${i.propertyId}:${i.eventId}`));
}
