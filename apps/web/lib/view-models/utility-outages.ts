import {
  formatWeekdayClock,
  isOfferedUtility,
  outageFeedTitle,
  outageHeadline,
  outageVanished,
  type PropertySnapshot,
  type UtilityKind,
  type UtilityOutageView,
} from '@fastighetsradar/domain';
import { SEV, type SeverityStyle } from '../design/tokens';

/**
 * Grid operators' outages on the property page (docs/plans/stromavbrott.md). Listed among the
 * property's events when the property itself is shown to be affected (precision high/medium), and –
 * with a caveat – ongoing unplanned outages in its postal or operating area (precision 'area', which
 * the operator publishes instead of outage geometry, e.g. Ellevio). Water point notices are listed
 * as nearby information. Adjacent polygon and electrical point matches stay off this list.
 */

export interface OutageEventVM {
  id: string;
  /** Chip label: Ström, Fjärrvärme, … */
  kind: string;
  title: string;
  /** "Oplanerat · start tis 14:05 · beräknat klart 16:00" */
  when: string;
  /** "Berör fastigheten", or the area caveat ("I fastighetens postnummerområde – inte säkert …"). */
  scope: string;
  /** True for matches shown with a caveat instead of "Berör fastigheten". */
  areaOnly: boolean;
  /** Operator's free text, verbatim (never rewritten). */
  operatorText: string | null;
  source: string;
  sourceUrl: string | null;
  c: string;
  bg: string;
  /** The outage's event id when it has an area to show in "Visa på karta" (null: addresses only). */
  mapEventId: string | null;
  /** Over (restored or no longer listed): the map shows it greyed out. */
  mapEnded: boolean;
}

const KIND_SV: Record<UtilityKind, string> = { electricity: 'Ström', district_heating: 'Fjärrvärme', district_cooling: 'Fjärrkyla', gas: 'Gas', water: 'Vatten och avlopp' };

const tone = (v: UtilityOutageView): SeverityStyle =>
  (v.noticeKind === 'information' || v.noticeKind === 'water_restriction') && v.state !== 'restored' && v.state !== 'withdrawn' ? SEV.monitor :
  // Green only when the operator says it is over; a vanished outage stays neutral grey.
  outageVanished(v)
    ? SEV.unknown
    : v.state === 'restored' || v.state === 'withdrawn'
    ? SEV.normal
    : v.severity === 'critical'
      ? SEV.critical
      : v.severity === 'warning'
        ? SEV.warning
        : v.severity === 'monitor'
          ? SEV.monitor
          : SEV.unknown;

/** True when the outage is shown to cover the property itself (not only its postal area or vicinity). */
export const affectsProperty = (v: UtilityOutageView) => v.precisionLevel === 'high' || v.precisionLevel === 'medium';

/** Listed on the property page: affects the property, or an area-level outage that reaches the feed (has a severity). */
export const listedForProperty = (v: UtilityOutageView) => affectsProperty(v) || (v.precisionLevel === 'area' && v.severity !== null);

const customers = (v: UtilityOutageView) =>
  v.affectedCustomers === null ? null : `${v.affectedCustomers.toLocaleString('sv-SE')} ${v.affectedCustomers === 1 ? 'kund' : 'kunder'} berörda`;

function whenOf(v: UtilityOutageView): string {
  if (v.noticeKind === 'information' || v.noticeKind === 'water_restriction') return v.reportedAt ? `Publicerat ${formatWeekdayClock(v.reportedAt, '—')}` : 'Tid ej angiven av leverantören';
  if (v.noticeKind === 'boil_water') return v.state === 'restored' ? (v.restoredAt ? `Upphörd ${formatWeekdayClock(v.restoredAt, '—')}` : 'Upphörd enligt leverantören · tid ej angiven') : v.state === 'withdrawn' ? 'Visas inte längre · inget besked om att rekommendationen upphört' : 'Rekommendation från leverantören';
  const at = (iso: string | null) => (iso ? formatWeekdayClock(iso, '—') : '—');
  // The planned window is already part of the headline.
  if (v.state === 'upcoming') return v.plannedStart ? 'Planerat arbete' : 'Planerat arbete · tid ej angiven';
  if (v.state === 'restored') return v.restoredInferred ? `Borttaget från kartan ${at(v.restoredAt)}` : `Åter ${at(v.restoredAt)}`;
  if (v.state === 'withdrawn') return outageVanished(v) ? 'Visas inte längre hos nätbolaget' : 'Borttaget av nätbolaget';
  const start = `start ${at(v.actualStart ?? v.plannedStart)}`;
  if (v.kind === 'planned') return `Planerat arbete pågår · ${start} · planerat slut ${at(v.plannedEnd)}`;
  return `${v.kind === 'unplanned' ? 'Oplanerat' : 'Avbrott'} · ${start} · beräknat klart ${at(v.estimatedRestore)}`;
}

export function outageEventsFor(s: Pick<PropertySnapshot, 'utilityOutages'>): OutageEventVM[] {
  const sections = s.utilityOutages ?? [];
  const byStart = (a: UtilityOutageView, b: UtilityOutageView) => Date.parse(a.plannedStart ?? a.actualStart ?? '') - Date.parse(b.plannedStart ?? b.actualStart ?? '');
  const pick = (k: 'current' | 'upcoming' | 'recentlyRestored') => sections.flatMap((u) => u[k]).filter((v) => isOfferedUtility(v.utility) && listedForProperty(v)).sort(byStart);
  const current = pick('current');
  const waterPoints = sections.flatMap((u) => u.nearby).filter((v) => v.utility === 'water' && v.matchMethod === 'outage_point');
  // A ticket that vanished while another from the same operator still covers the property was replaced.
  const replaced = (v: UtilityOutageView) => outageVanished(v) && current.some((c) => c.operatorId === v.operatorId && c.utility === v.utility);
  return [...current, ...pick('upcoming'), ...pick('recentlyRestored').filter((v) => !replaced(v)), ...waterPoints].map((v) => {
    const t = tone(v);
    const near = v.matchMethod === 'outage_point';
    const areaOnly = v.precisionLevel === 'area' || near;
    const headline = outageHeadline({ utility: v.utility, noticeKind: v.noticeKind, kind: v.kind, state: v.state, plannedStart: v.plannedStart, plannedEnd: v.plannedEnd, restoredInferred: v.restoredInferred }, v.operatorName);
    return {
      id: v.id,
      kind: KIND_SV[v.utility] ?? 'Avbrott',
      title: near ? `Vatten- och avloppsmeddelande i närheten – ${v.operatorName}`
        : areaOnly && v.state !== 'restored' && v.state !== 'withdrawn' ? outageFeedTitle(headline, v.precisionLevel, v.matchMethod, v.placeLabel, v.noticeKind) : headline,
      when: [whenOf(v), areaOnly ? customers(v) : null].filter(Boolean).join(' · '),
      scope: near ? 'Leverantören har markerat en plats i närheten. Det är oklart om fastigheten berörs.'
        : areaOnly ? v.precisionLabel : 'Berör fastigheten',
      areaOnly,
      operatorText: v.operatorText,
      source: `${v.operatorName} · avbrottskarta`,
      sourceUrl: v.sourceUrl,
      c: t.c,
      bg: t.bg,
      mapEventId: v.geometry && !near ? v.id : null,
      mapEnded: v.state === 'restored' || v.state === 'withdrawn',
    };
  });
}

/** Polygons to draw on the property map – only outages that cover the property. */
export function outageShapes(s: Pick<PropertySnapshot, 'utilityOutages'>): Array<{ id: string; geometry: unknown; color: string; label: string; dashed: boolean }> {
  return (s.utilityOutages ?? [])
    .flatMap((u) => [...u.current, ...u.upcoming])
    .filter((v) => isOfferedUtility(v.utility) && v.geometry && affectsProperty(v))
    .map((v) => ({
      id: v.id,
      geometry: v.geometry,
      color: tone(v).hx,
      label: outageHeadline({ utility: v.utility, noticeKind: v.noticeKind, kind: v.kind, state: v.state, plannedStart: v.plannedStart, plannedEnd: v.plannedEnd }, v.operatorName),
      dashed: v.state === 'upcoming',
    }));
}
