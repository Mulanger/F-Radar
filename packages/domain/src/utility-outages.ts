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
export const UTILITY_KINDS = ['electricity', 'district_heating', 'district_cooling', 'gas', 'water'] as const;
export const UtilityKindSchema = z.enum(UTILITY_KINDS);
export type UtilityKind = z.infer<typeof UtilityKindSchema>;
export const UtilityNoticeKindSchema = z.enum(['outage', 'information', 'boil_water', 'water_restriction']);
export type UtilityNoticeKind = z.infer<typeof UtilityNoticeKindSchema>;

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

/**
 * Area-level matches (postal area, operating district) reach the feed only for outages with at least
 * this many affected customers. Smaller ones (often a single customer in a postcode of thousands) are
 * shown in the property panel only – otherwise every property in the area would get noise.
 */
export const AREA_FEED_MIN_CUSTOMERS = 25;

export function outageMatchLevel(method: OutageMatchMethod, positionConfirmed: boolean, affectedCustomers?: number | null, noticeKind?: UtilityNoticeKind): OutageMatchPrecisionLevel {
  // An address-list match is by the property's own street address, independent of the map pin.
  if (method === 'outage_address') return 'high';
  if (method === 'outage_polygon') return positionConfirmed ? 'high' : 'medium';
  if (method === 'outage_street') return 'medium';
  if (method === 'outage_adjacent' || method === 'outage_point') return 'low';
  // A recommendation/notice is explicitly published for its whole drawn area; no electricity-count threshold.
  if (noticeKind && noticeKind !== 'outage') return 'area';
  // Area match: below the threshold (or unknown size) it is panel-only.
  return affectedCustomers !== undefined && (affectedCustomers ?? 0) < AREA_FEED_MIN_CUSTOMERS ? 'low' : 'area';
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
  o: { kind: OutageKind; state: OutageState; noticeKind?: UtilityNoticeKind },
  level: OutageMatchPrecisionLevel,
): z.infer<typeof SeveritySchema> | null {
  // Near matches do not show that the property itself is affected: panel/risk factor only.
  if (level === 'low') return null;
  const ended = o.state === 'restored' || o.state === 'withdrawn';
  if (o.noticeKind === 'information' || o.noticeKind === 'water_restriction') return 'info';
  if (o.noticeKind === 'boil_water') return ended ? 'info' : 'critical';
  // Area-level matches (postal area, operating area; ≥ AREA_FEED_MIN_CUSTOMERS) surface ongoing
  // unplanned/unknown outages as blue 'monitor' with a caveat – never red/orange, never SMS.
  // Planned work at area level is not shown (re-enabled 2026-11-17 after a missed Ellevio outage).
  if (level === 'area') return o.kind === 'planned' ? null : o.state === 'ongoing' || o.state === 'unknown' ? 'monitor' : ended ? 'info' : null;
  if (ended) return 'info';
  if (o.state === 'upcoming') return 'monitor';
  if (o.state === 'ongoing') {
    if (o.kind === 'unplanned') return level === 'high' ? 'critical' : 'warning';
    return 'warning';
  }
  return o.kind === 'unknown' ? 'warning' : null;
}

export const UtilityOutageViewSchema = z.object({
  lastSeenAt: IsoDateTimeSchema.optional(),
  noticeKind: UtilityNoticeKindSchema.optional(),
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
  /**
   * True when 'restored' is OUR inference: the operator never reports restoration and removed the
   * outage from its map (Vattenfall, E.ON, Trimble). Shown as "troligen tillbaka", never "enligt".
   */
  restoredInferred: z.boolean().default(false),
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
  /** Grid operators whose (approximate) concession area covers the property when more than one does. */
  operatorCandidates: z.array(z.string()).optional(),
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
  water: 'vattenavbrott',
  electricity: 'strömavbrott',
  district_heating: 'fjärrvärmeavbrott',
  district_cooling: 'fjärrkyleavbrott',
  gas: 'gasavbrott',
};
const UTILITY_BACK: Record<UtilityKind, string> = {
  water: 'Vattenleveransen är tillbaka',
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
/**
 * An outage that disappeared from the operator's list without the operator saying it is over
 * (`withdrawn`, not planned work). Never presented or sent as "Strömmen är tillbaka".
 */
/**
 * Platforms whose operators report restoration themselves. For them an outage that disappears from
 * the list was merged/re-issued or removed – not restored. ServiceAlert cannot prove restoration
 * by removing a notice either. Legacy Vattenfall/E.ON/Trimble removal remains an inferred UI state;
 * no inferred restoration ever triggers SMS. New sources can override this policy per operator.
 */
export const PLATFORMS_REPORTING_RESTORED: readonly string[] = ['ellevio', 'goteborg_energi', 'digpro', 'tekniskaverken', 'umea', 'skekraft', 'servicealert'];

export function outageVanished(o: { kind: OutageKind; state: OutageState }): boolean {
  return o.state === 'withdrawn' && o.kind !== 'planned';
}

export function outageHeadline(o: { utility: UtilityKind; kind: OutageKind; state: OutageState; plannedStart: string | null; plannedEnd: string | null; restoredInferred?: boolean; noticeKind?: UtilityNoticeKind }, operatorName: string): string {
  if (o.noticeKind === 'boil_water') {
    if (o.state === 'restored') return `Kokningsrekommendation upphörd enligt ${operatorName}`;
    if (o.state === 'withdrawn') return `Kokningsrekommendation visas inte längre hos ${operatorName} – inget besked om att den upphört`;
    return `Kokningsrekommendation – ${operatorName}`;
  }
  if (o.noticeKind === 'water_restriction') return `Information om vattenanvändning – ${operatorName}`;
  if (o.noticeKind === 'information') return o.state === 'withdrawn' ? `Vatten- och avloppsmeddelande visas inte längre hos ${operatorName}` : `Vatten- och avloppsmeddelande – ${operatorName}`;
  const noun = UTILITY_NOUN[o.utility];
  const Noun = noun[0]!.toUpperCase() + noun.slice(1);
  const plannedLabel = o.utility === 'water' ? 'Planerad vattenavstängning' : `Planerat ${noun}`;
  if (o.state === 'restored' && o.restoredInferred) return `${UTILITY_BACK[o.utility].replace(' är tillbaka', ' är troligen tillbaka')} – avbrottet visas inte längre hos ${operatorName}`;
  if (o.state === 'restored') return `${UTILITY_BACK[o.utility]} enligt ${operatorName}`;
  // Withdrawn = no longer in the operator's list. For an outage that was under way this is NOT a
  // statement that power is back (tickets are merged and re-issued), so it says so.
  if (o.state === 'withdrawn') return o.kind === 'planned' ? `${plannedLabel} visas inte längre hos ${operatorName}` : `${Noun} visas inte längre hos ${operatorName} – inget besked om att det är åtgärdat`;
  if (o.kind === 'planned') {
    if (o.state === 'upcoming') {
      const w = formatOutageWindow(o.plannedStart, o.plannedEnd);
      return `${plannedLabel}${w ? ` ${w}` : ''} – ${operatorName}`;
    }
    return `${plannedLabel} pågår – ${operatorName}`;
  }
  if (o.kind === 'unplanned') return `Oplanerat ${noun} – ${operatorName}`;
  return `${Noun} registrerat – ${operatorName}`;
}

/** Caveat shown next to a match, per precision. `placeLabel` names an operating district when known. */
export function outagePrecisionLabel(method: OutageMatchMethod, positionConfirmed: boolean, placeLabel?: string | null, noticeKind?: UtilityNoticeKind): string {
  if (noticeKind === 'boil_water' && (method === 'outage_area' || method === 'outage_postal_area')) return 'I leverantörens publicerade rekommendationsområde';
  if ((noticeKind === 'information' || noticeKind === 'water_restriction') && (method === 'outage_area' || method === 'outage_postal_area')) return 'Leverantörsmeddelande i området – inte säkert att fastigheten berörs';
  switch (method) {
    case 'outage_polygon':
      return positionConfirmed
        ? 'Fastighetens adresspunkt ligger inom avbrottsområdet'
        : 'Inom avbrottsområdet – fastighetens position är ungefärlig';
    case 'outage_address':
      return 'Fastighetens adress finns i nätbolagets lista';
    case 'outage_street':
      return 'Gatan nämns i nätbolagets lista – inte säkert att fastigheten berörs';
    case 'outage_adjacent':
      return 'Nära avbrottsområdet – inte bekräftat att fastigheten berörs';
    case 'outage_point':
      return 'Enstaka anläggning i närheten – inte bekräftat att fastigheten berörs';
    case 'outage_postal_area':
      return 'I fastighetens postnummerområde – inte säkert att fastigheten berörs';
    case 'outage_area':
      return `I nätbolagets driftområde${placeLabel ? ` ${placeLabel}` : ''} – inte säkert att fastigheten berörs`;
  }
}

/** Per-property feed title: the event headline plus a caveat when the match is not high precision. */
export function outageFeedTitle(headline: string, level: OutageMatchPrecisionLevel, method: OutageMatchMethod, placeLabel?: string | null, noticeKind?: UtilityNoticeKind): string {
  if (level === 'area' && noticeKind && noticeKind !== 'outage') return `${headline} – i leverantörens publicerade område`;
  if (level === 'high') return headline;
  if (method === 'outage_postal_area') return `${headline} – i fastighetens postnummerområde`;
  if (method === 'outage_area') return `${headline} – i nätbolagets driftområde${placeLabel ? ` ${placeLabel}` : ''}`;
  if (method === 'outage_street') return `${headline} – gatan nämns i nätbolagets lista`;
  return `${headline} – fastighetens position är ungefärlig`;
}

/* ------------------------------------------------------------------ */
/* Address lists (Fas 4: operators that publish streets, not geometry)  */
/* ------------------------------------------------------------------ */

export interface OutageAddress {
  street: string;
  /** Normalised house numbers ("12b"); null = the whole street is named. */
  numbers: string[] | null;
}

/** "Stora  Nygatan." → "stora nygatan" (exact street names only – no suffix guessing). */
export function normalizeStreet(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').replace(/[.]+$/, '').trim();
}

/** "12 B" → "12b". */
export function normalizeHousenumber(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, '').trim();
}

const NUMBER_TOKEN = /^\d{1,4}[a-z]?$/i;

/**
 * Parses an operator's address list ("Stora Nygatan 1, 3\nSlussgatan 1\nRichtersgatan").
 * A line whose numbers cannot all be read safely (ranges, words) keeps only its street (null
 * numbers → street-level, medium precision). Returns null for empty input.
 */
export function parseAddressList(text: string | null | undefined): OutageAddress[] | null {
  if (!text || !text.trim()) return null;
  const out: OutageAddress[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (!line) continue;
    const m = /^(.*?[^\d\s,])\s+(\d.*)$/.exec(line);
    if (!m) {
      out.push({ street: normalizeStreet(line), numbers: null });
      continue;
    }
    const tokens = m[2]!.split(/\s*,\s*|\s+och\s+|\s+/i).filter(Boolean);
    const ok = tokens.length > 0 && tokens.every((t) => NUMBER_TOKEN.test(t));
    out.push({ street: normalizeStreet(m[1]!), numbers: ok ? tokens.map(normalizeHousenumber) : null });
  }
  return out.length ? out : null;
}

/** How a property's street address matches an address list. */
export function matchAddressList(street: string | null | undefined, housenumber: string | null | undefined, list: OutageAddress[]): 'outage_address' | 'outage_street' | null {
  if (!street) return null;
  const s = normalizeStreet(street);
  const n = housenumber ? normalizeHousenumber(housenumber) : null;
  let streetOnly = false;
  for (const a of list) {
    if (a.street !== s) continue;
    if (a.numbers === null) streetOnly = true;
    else if (n && a.numbers.includes(n)) return 'outage_address';
  }
  return streetOnly ? 'outage_street' : null;
}
