import { isOfferedUtility, OFFERED_UTILITIES, utilityNoun } from '@fastighetsradar/domain';

// The values are fixed in code. SQL uses the same product scope as the collector and UI.
export const OFFERED_UTILITIES_SQL = `(${OFFERED_UTILITIES.map((u) => `'${u}'`).join(', ') || 'NULL'})`;

export const offeredUtilityEvent = (event: string) =>
  `(${event}.source_id <> 'utility_outages' OR ${event}.extra->>'utility' IN ${OFFERED_UTILITIES_SQL})`;

// For history that outlived its source event, only the system-generated headline remains.
const hiddenUtilityHeadlines = (['district_heating', 'district_cooling', 'gas'] as const)
  .filter((utility) => !isOfferedUtility(utility))
  .flatMap((utility) => [utilityNoun(utility), { district_heating: 'fjärrvärmen', district_cooling: 'fjärrkylan', gas: 'gasleveransen' }[utility]]);
export const offeredUtilityHeadline = (headline: string) => hiddenUtilityHeadlines.length
  ? `${headline} !~* '^(planerat |oplanerat )?(${hiddenUtilityHeadlines.join('|')})'`
  : 'true';

export const offeredUtilityChange = (change: string) =>
  `(${change}.source_id <> 'utility_outages' OR COALESCE((
    SELECT ${offeredUtilityEvent('utility_event')} FROM source_events utility_event WHERE utility_event.id = ${change}.event_id
  ), ${offeredUtilityHeadline(`${change}.headline`)}))`;

const positionConfirmed = (p: string) => `(${p}.geocode_precision = 'building' OR ${p}.position_source IN ('manual_pin', 'manual_adjusted'))`;

export const customerUtilityMatch = (event: string, match: string, property: string) =>
  `(${event}.source_id <> 'utility_outages' OR ${match}.match_method = 'outage_address'
    OR (${positionConfirmed(property)} AND (${match}.match_method = 'outage_polygon'
      OR (${match}.match_method = 'outage_area' AND ${event}.extra->>'noticeKind' = 'boil_water'))))`;

const customerUtilityRevision = (c: string) =>
  `(${c}.dedup_key LIKE '%:high'
    OR (${c}.dedup_key LIKE '%:area' AND ${c}.severity IN ('critical', 'info') AND EXISTS (
      SELECT 1 FROM source_events e JOIN properties p ON p.id = ${c}.property_id AND p.organization_id = ${c}.organization_id
      WHERE e.id = ${c}.event_id AND e.extra->>'noticeKind' = 'boil_water' AND ${positionConfirmed('p')}
    )))`;

/** Change keys retain the precision. A lost match is relevant only if previously shown. */
export const customerUtilityChange = (c: string) =>
  `(${c}.source_id <> 'utility_outages' OR ${customerUtilityRevision(c)}
    OR (${c}.dedup_key LIKE '%:gone' AND EXISTS (
      SELECT 1 FROM monitoring_changes reached WHERE reached.organization_id = ${c}.organization_id
        AND reached.event_id = ${c}.event_id AND reached.property_id = ${c}.property_id
        AND reached.id < ${c}.id AND ${customerUtilityRevision('reached')}
    )))`;
