import { z } from 'zod';
import { IsoDateTimeSchema, SeveritySchema } from './common';

/**
 * Utility outages (power, later district heating/cooling) published by grid operators on their
 * public outage maps. See docs/plans/stromavbrott.md and the ADR on outage precision.
 *
 * Vocabulary:
 *  - kind: planned | unplanned | unknown (operator did not say – never guessed)
 *  - state: upcoming (planned, not started) | ongoing | restored | withdrawn (vanished before start) | unknown
 *  - matchMethod: how precisely an outage was tied to a property. Only `outage_polygon` and
 *    `outage_address` with a confirmed property position may ever trigger an SMS.
 */
export const UTILITY_KINDS = ['electricity', 'district_heating', 'district_cooling', 'gas'] as const;
export const UtilityKindSchema = z.enum(UTILITY_KINDS);
export type UtilityKind = z.infer<typeof UtilityKindSchema>;

export const OutageKindSchema = z.enum(['planned', 'unplanned', 'unknown']);
export type OutageKind = z.infer<typeof OutageKindSchema>;

export const OutageStateSchema = z.enum(['upcoming', 'ongoing', 'restored', 'withdrawn', 'unknown']);
export type OutageState = z.infer<typeof OutageStateSchema>;

export const OutagePrecisionSchema = z.enum(['polygon', 'point', 'address_list', 'postal_area', 'area']);
export type OutagePrecision = z.infer<typeof OutagePrecisionSchema>;

export const OUTAGE_MATCH_METHODS = [
  'outage_polygon',
  'outage_address',
  'outage_street',
  'outage_adjacent',
  'outage_point',
  'outage_postal_area',
  'outage_area',
] as const;
export const OutageMatchMethodSchema = z.enum(OUTAGE_MATCH_METHODS);
export type OutageMatchMethod = z.infer<typeof OutageMatchMethodSchema>;

/** Match methods precise enough for SMS (still subject to a confirmed property position). */
export const SMS_ELIGIBLE_OUTAGE_MATCHES: readonly OutageMatchMethod[] = ['outage_polygon', 'outage_address'];
/** Match methods that are shown only inside the property panel (no feed row, no status, no SMS). */
export const PANEL_ONLY_OUTAGE_MATCHES: readonly OutageMatchMethod[] = ['outage_adjacent', 'outage_point'];

export type OutageMatchPrecisionLevel = 'high' | 'medium' | 'low' | 'area';

export function outageMatchLevel(method: OutageMatchMethod, positionConfirmed: boolean): OutageMatchPrecisionLevel {
  if (method === 'outage_polygon' || method === 'outage_address') return positionConfirmed ? 'high' : 'medium';
  if (method === 'outage_street') return 'medium';
  if (method === 'outage_adjacent' || method === 'outage_point') return 'low';
  return 'area';
}

/** A property's position counts as confirmed when geocoded to a building or set/adjusted by hand. */
export function isPositionConfirmed(geocodePrecision: string | null | undefined, positionSource: string | null | undefined): boolean {
  return positionSource === 'manual_pin' || positionSource === 'manual_adjusted' || geocodePrecision === 'building';
}

/**
 * Severity of an outage for ONE property (docs/plans/stromavbrott.md §5.3).
 * Returns null when the match must not create a feed row / status (panel only, or ended).
 */
export function outageEffectiveSeverity(
  o: { kind: OutageKind; state: OutageState },
  level: OutageMatchPrecisionLevel,
): z.infer<typeof SeveritySchema> | null {
  if (level === 'low') return null;
  const ended = o.state === 'restored' || o.state === 'withdrawn';
  // Area-level matches (postal area, operating area) only surface unplanned/unknown outages.
  if (level === 'area') return o.kind === 'planned' ? null : o.state === 'ongoing' ? 'monitor' : ended ? 'info' : null;
  if (ended) return 'info';
  if (o.state === 'upcoming') return 'monitor';
  if (o.state === 'ongoing') {
    if (o.kind === 'unplanned') return level === 'high' ? 'critical' : 'warning';
    return 'warning';
  }
  return o.kind === 'unknown' ? 'warning' : null;
}

export const UtilityOutageViewSchema = z.object({
  id: z.string(),
  operatorId: z.string(),
  operatorName: z.string(),
  utility: UtilityKindSchema,
  kind: OutageKindSchema,
  state: OutageStateSchema,
  matchMethod: OutageMatchMethodSchema,
  precisionLevel: z.enum(['high', 'medium', 'low', 'area']),
  /** Our descriptive caveat, e.g. "Fastighetens adresspunkt ligger inom avbrottsområdet". */
  precisionLabel: z.string(),
  severity: SeveritySchema.nullable(),
  distanceMeters: z.number().nonnegative().nullable(),
  affectedCustomers: z.number().int().nonnegative().nullable(),
  areaCustomerTotal: z.number().int().nonnegative().nullable(),
  reportedAt: IsoDateTimeSchema.nullable(),
  plannedStart: IsoDateTimeSchema.nullable(),
  plannedEnd: IsoDateTimeSchema.nullable(),
  actualStart: IsoDateTimeSchema.nullable(),
  estimatedRestore: IsoDateTimeSchema.nullable(),
  restoredAt: IsoDateTimeSchema.nullable(),
  /** Operator's own customer text – shown verbatim and attributed. */
  operatorText: z.string().nullable(),
  cause: z.string().nullable(),
  placeLabel: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  /** GeoJSON (WGS84 lon/lat) for maps; null when only an area reference exists. */
  geometry: z.unknown().nullable(),
});
export type UtilityOutageView = z.infer<typeof UtilityOutageViewSchema>;

export const OutageCoverageSchema = z.enum(['monitored', 'stale', 'not_monitored', 'unknown']);
export type OutageCoverage = z.infer<typeof OutageCoverageSchema>;

export const PropertyUtilityStatusSchema = z.object({
  utility: UtilityKindSchema,
  operator: z.object({ id: z.string(), name: z.string(), mapUrl: z.string().nullable() }).nullable(),
  coverage: OutageCoverageSchema,
  /** Operator's last successful collection. */
  updatedAt: IsoDateTimeSchema.nullable(),
  current: z.array(UtilityOutageViewSchema),
  upcoming: z.array(UtilityOutageViewSchema),
  recentlyRestored: z.array(UtilityOutageViewSchema),
  nearby: z.array(UtilityOutageViewSchema),
});
export type PropertyUtilityStatus = z.infer<typeof PropertyUtilityStatusSchema>;

/* ------------------------------------------------------------------ */
/* Swedish wording (ADR 0003: descriptive, never "kris", "fara", "akut") */
/* ------------------------------------------------------------------ */

const TZ = 'Europe/Stockholm';
const dayMonth = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'numeric', timeZone: TZ });
const clock = new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const localDay = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ });

const UTILITY_NOUN: Record<UtilityKind, string> = {
  electricity: 'strömavbrott',
  district_heating: 'fjärrvärmeavbrott',
  district_cooling: 'fjärrkyleavbrott',
  gas: 'gasavbrott',
};
const UTILITY_BACK: Record<UtilityKind, string> = {
  electricity: 'Strömmen är tillbaka',
  district_heating: 'Fjärrvärmen är tillbaka',
  district_cooling: 'Fjärrkylan är tillbaka',
  gas: 'Gasleveransen är tillbaka',
};

export function utilityNoun(u: UtilityKind): string {
  return UTILITY_NOUN[u];
}

/** "30/11 09:00–14:00", "30/11 22:00–1/12 02:00", "från 30/11 09:00" or "" when unknown. */
export function formatOutageWindow(start: string | null, end: string | null): string {
  if (!start) return '';
  const s = new Date(start);
  const head = `${dayMonth.format(s)} ${clock.format(s)}`;
  if (!end) return `från ${head}`;
  const e = new Date(end);
  const sameDay = localDay.format(s) === localDay.format(e);
  return `${head}–${sameDay ? '' : `${dayMonth.format(e)} `}${clock.format(e)}`;
}

/** Event-level headline used in the feed and as the SMS description. */
export function outageHeadline(o: { utility: UtilityKind; kind: OutageKind; state: OutageState; plannedStart: string | null; plannedEnd: string | null }, operatorName: string): string {
  const noun = UTILITY_NOUN[o.utility];
  const Noun = noun[0]!.toUpperCase() + noun.slice(1);
  if (o.state === 'restored') return `${UTILITY_BACK[o.utility]} enligt ${operatorName}`;
  if (o.state === 'withdrawn') return `Planerat ${noun} visas inte längre hos ${operatorName}`;
  if (o.kind === 'planned') {
    if (o.state === 'upcoming') {
      const w = formatOutageWindow(o.plannedStart, o.plannedEnd);
      return `Planerat ${noun}${w ? ` ${w}` : ''} – ${operatorName}`;
    }
    return `Planerat ${noun} pågår – ${operatorName}`;
  }
  if (o.kind === 'unplanned') return `Oplanerat ${noun} – ${operatorName}`;
  return `${Noun} registrerat – ${operatorName}`;
}

/** Caveat shown next to a match, per precision. */
export function outagePrecisionLabel(method: OutageMatchMethod, positionConfirmed: boolean, area?: { affected: number | null; total: number | null }): string {
  switch (method) {
    case 'outage_polygon':
      return positionConfirmed
        ? 'Fastighetens adresspunkt ligger inom avbrottsområdet'
        : 'Inom avbrottsområdet – fastighetens position är ungefärlig';
    case 'outage_address':
      return positionConfirmed ? 'Fastighetens adress finns i nätbolagets lista' : 'Adressen finns i nätbolagets lista – fastighetens position är ungefärlig';
    case 'outage_street':
      return 'Gatan nämns i nätbolagets lista – inte säkert att fastigheten berörs';
    case 'outage_adjacent':
      return 'Nära avbrottsområdet – inte bekräftat att fastigheten berörs';
    case 'outage_point':
      return 'Enstaka anläggning i närheten – inte bekräftat att fastigheten berörs';
    case 'outage_postal_area': {
      const share = area?.affected != null && area.total ? ` (${area.affected} av ${area.total} anläggningar)` : '';
      return `I fastighetens postnummerområde${share} – inte säkert att fastigheten berörs`;
    }
    case 'outage_area':
      return 'I nätbolagets driftområde – inte säkert att fastigheten berörs';
  }
}

/** Per-property feed title: the event headline plus a caveat when the match is not high precision. */
export function outageFeedTitle(headline: string, level: OutageMatchPrecisionLevel, method: OutageMatchMethod, area?: { affected: number | null; total: number | null }): string {
  if (level === 'high') return headline;
  if (method === 'outage_postal_area') {
    const share = area?.affected != null && area.total ? ` (${area.affected} av ${area.total} anläggningar)` : '';
    return `${headline} – i fastighetens postnummerområde${share}`;
  }
  if (method === 'outage_area') return `${headline} – i nätbolagets driftområde`;
  if (method === 'outage_street') return `${headline} – gatan nämns i nätbolagets lista`;
  return `${headline} – fastighetens position är ungefärlig`;
}
