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
