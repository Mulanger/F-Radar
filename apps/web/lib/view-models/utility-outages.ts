import {
  formatWeekdayClock,
  outageHeadline,
  type PropertySnapshot,
  type UtilityKind,
  type UtilityOutageView,
} from '@fastighetsradar/domain';
import { SEV, type SeverityStyle } from '../design/tokens';

/**
 * Grid operators' outages on the property page (docs/plans/stromavbrott.md). They are listed among
 * the property's events ONLY when the property itself is shown to be affected: the address lies in
 * the outage area or is named by the operator (precision high/medium). Postal-area, operating-area
 * and near matches are not listed. Grid coverage ("bevakas / kunde inte kontrolleras") is shown by
 * the risk factor "El och värme", not here.
 */

export interface OutageEventVM {
  id: string;
  /** Chip label: Ström, Fjärrvärme, … */
  kind: string;
  title: string;
  /** "Oplanerat · start tis 14:05 · beräknat klart 16:00" */
  when: string;
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
  const pick = (k: 'current' | 'upcoming' | 'recentlyRestored') => sections.flatMap((u) => u[k]).filter(affectsProperty).sort(byStart);
  return [...pick('current'), ...pick('upcoming'), ...pick('recentlyRestored')].map((v) => {
    const t = tone(v);
    return {
      id: v.id,
      kind: KIND_SV[v.utility] ?? 'Avbrott',
      title: outageHeadline({ utility: v.utility, kind: v.kind, state: v.state, plannedStart: v.plannedStart, plannedEnd: v.plannedEnd }, v.operatorName),
      when: whenOf(v),
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
