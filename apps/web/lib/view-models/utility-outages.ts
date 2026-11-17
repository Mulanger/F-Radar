import {
  formatWeekdayClock,
  outageFeedTitle,
  outageHeadline,
  type PropertySnapshot,
  type UtilityKind,
  type UtilityOutageView,
} from '@fastighetsradar/domain';
import { SEV, type SeverityStyle } from '../design/tokens';

/**
 * Grid operators' outages on the property page (docs/plans/stromavbrott.md). Listed among the
 * property's events when the property itself is shown to be affected (precision high/medium), and –
 * with a caveat – ongoing unplanned outages in its postal or operating area (precision 'area', which
 * the operator publishes instead of outage geometry, e.g. Ellevio). Near matches are not listed. Grid
 * coverage ("bevakas / kunde inte kontrolleras") is shown by the risk factor "El och värme".
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
  /** True for area-level matches (shown with the caveat instead of "Berör fastigheten"). */
  areaOnly: boolean;
  /** Operator's free text, verbatim (never rewritten). */
  operatorText: string | null;
  source: string;
  sourceUrl: string | null;
  c: string;
  bg: string;
}

const KIND_SV: Record<UtilityKind, string> = { electricity: 'Ström', district_heating: 'Fjärrvärme', district_cooling: 'Fjärrkyla', gas: 'Gas' };

const tone = (v: UtilityOutageView): SeverityStyle =>
  v.state === 'restored' || v.state === 'withdrawn'
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
  const at = (iso: string | null) => (iso ? formatWeekdayClock(iso, '—') : '—');
  // The planned window is already part of the headline.
  if (v.state === 'upcoming') return v.plannedStart ? 'Planerat arbete' : 'Planerat arbete · tid ej angiven';
  if (v.state === 'restored') return `Åter ${at(v.restoredAt)}`;
  if (v.state === 'withdrawn') return 'Borttaget av nätbolaget';
  const start = `start ${at(v.actualStart ?? v.plannedStart)}`;
  if (v.kind === 'planned') return `Planerat arbete pågår · ${start} · planerat slut ${at(v.plannedEnd)}`;
  return `${v.kind === 'unplanned' ? 'Oplanerat' : 'Avbrott'} · ${start} · beräknat klart ${at(v.estimatedRestore)}`;
}

export function outageEventsFor(s: PropertySnapshot): OutageEventVM[] {
  const sections = s.utilityOutages ?? [];
  const byStart = (a: UtilityOutageView, b: UtilityOutageView) => Date.parse(a.plannedStart ?? a.actualStart ?? '') - Date.parse(b.plannedStart ?? b.actualStart ?? '');
  const pick = (k: 'current' | 'upcoming' | 'recentlyRestored') => sections.flatMap((u) => u[k]).filter(listedForProperty).sort(byStart);
  return [...pick('current'), ...pick('upcoming'), ...pick('recentlyRestored')].map((v) => {
    const t = tone(v);
    const areaOnly = v.precisionLevel === 'area';
    const headline = outageHeadline({ utility: v.utility, kind: v.kind, state: v.state, plannedStart: v.plannedStart, plannedEnd: v.plannedEnd }, v.operatorName);
    return {
      id: v.id,
      kind: KIND_SV[v.utility] ?? 'Avbrott',
      title: areaOnly && v.state !== 'restored' && v.state !== 'withdrawn' ? outageFeedTitle(headline, v.precisionLevel, v.matchMethod, v.placeLabel) : headline,
      when: [whenOf(v), areaOnly ? customers(v) : null].filter(Boolean).join(' · '),
      scope: areaOnly ? v.precisionLabel : 'Berör fastigheten',
      areaOnly,
      operatorText: v.operatorText,
      source: `${v.operatorName} · avbrottskarta`,
      sourceUrl: v.sourceUrl,
      c: t.c,
      bg: t.bg,
    };
  });
}

/** Polygons to draw on the property map – only outages that cover the property. */
export function outageShapes(s: PropertySnapshot): Array<{ id: string; geometry: unknown; color: string; label: string; dashed: boolean }> {
  return (s.utilityOutages ?? [])
    .flatMap((u) => [...u.current, ...u.upcoming])
    .filter((v) => v.geometry && affectsProperty(v))
    .map((v) => ({
      id: v.id,
      geometry: v.geometry,
      color: tone(v).hx,
      label: outageHeadline({ utility: v.utility, kind: v.kind, state: v.state, plannedStart: v.plannedStart, plannedEnd: v.plannedEnd }, v.operatorName),
      dashed: v.state === 'upcoming',
    }));
}
