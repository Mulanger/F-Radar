import {
  formatClock,
  formatOutageWindow,
  formatWeekdayClock,
  outageHeadline,
  utilityNoun,
  type PropertySnapshot,
  type PropertyUtilityStatus,
  type UtilityOutageView,
} from '@fastighetsradar/domain';
import { SEV, type SeverityStyle } from '../design/tokens';

/**
 * View-model for the "Elnät" panel (docs/plans/stromavbrott.md §8). Never says "Inga registrerade
 * avbrott" unless the property lies in a monitored, current operator's grid (coverage 'monitored').
 */

export interface OutageRowVM {
  id: string;
  title: string;
  tone: SeverityStyle;
  badge: string;
  precision: string;
  facts: Array<[string, string]>;
  operatorText: string | null;
  sourceLine: string;
  sourceUrl: string | null;
}

export interface OutagePanelVM {
  /** False when the snapshot has no outage section (demo, old payload, migration missing). */
  available: boolean;
  title: string;
  subtitle: string;
  /** Headline state shown at the top of the panel. */
  state: { label: string; detail: string; tone: SeverityStyle } | null;
  current: OutageRowVM[];
  upcoming: OutageRowVM[];
  restored: OutageRowVM[];
  nearby: OutageRowVM[];
  footer: string;
}

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

const badgeOf = (v: UtilityOutageView): string => {
  if (v.state === 'restored') return 'Återställt';
  if (v.state === 'withdrawn') return 'Borttaget';
  if (v.state === 'upcoming') return 'Planerat';
  if (v.kind === 'unplanned') return 'Oplanerat';
  if (v.kind === 'planned') return 'Planerat pågår';
  return 'Typ okänd';
};

const num = (n: number | null) => (n === null ? '—' : n.toLocaleString('sv-SE'));

export function outageRowVM(v: UtilityOutageView): OutageRowVM {
  const facts: Array<[string, string]> = [];
  if (v.state === 'upcoming') {
    facts.push(['Tid', formatOutageWindow(v.plannedStart, v.plannedEnd) || '—']);
  } else {
    facts.push(['Start', v.actualStart ? formatWeekdayClock(v.actualStart, '—') : v.plannedStart ? formatWeekdayClock(v.plannedStart, '—') : '—']);
    if (v.state === 'restored') facts.push(['Återställt', v.restoredAt ? formatWeekdayClock(v.restoredAt, '—') : '—']);
    else if (v.kind === 'planned') facts.push(['Planerat slut', v.plannedEnd ? formatWeekdayClock(v.plannedEnd, '—') : '—']);
    else facts.push(['Beräknat klart', v.estimatedRestore ? formatWeekdayClock(v.estimatedRestore, '—') : '—']);
  }
  facts.push(['Berörda kunder', v.areaCustomerTotal ? `${num(v.affectedCustomers)} av ${num(v.areaCustomerTotal)}` : num(v.affectedCustomers)]);
  if (v.placeLabel) facts.push(['Område', v.placeLabel]);
  if (v.cause) facts.push(['Orsak (nätbolaget)', v.cause]);
  return {
    id: v.id,
    title: outageHeadline({ utility: v.utility, kind: v.kind, state: v.state, plannedStart: v.plannedStart, plannedEnd: v.plannedEnd }, v.operatorName),
    tone: tone(v),
    badge: badgeOf(v),
    precision: v.precisionLabel,
    facts,
    operatorText: v.operatorText,
    sourceLine: `Källa: ${v.operatorName} – avbrottskarta`,
    sourceUrl: v.sourceUrl,
  };
}

function headState(u: PropertyUtilityStatus): OutagePanelVM['state'] {
  const worst = [...u.current].sort((a, b) => rank(b) - rank(a))[0];
  if (worst) {
    const t = tone(worst);
    return { label: worst.kind === 'unplanned' ? 'Oplanerat strömavbrott' : worst.kind === 'planned' ? 'Planerat strömavbrott pågår' : 'Avbrott registrerat', detail: worst.precisionLabel, tone: t };
  }
  if (u.coverage === 'stale') return { label: 'Ej bedömd', detail: `${u.operator?.name ?? 'Nätbolagets'} avbrottskarta kunde inte hämtas nyligen. Det betyder inte att avbrott saknas.`, tone: SEV.unknown };
  if (u.coverage === 'not_monitored') return { label: 'Nätet bevakas inte ännu', detail: `Fastigheten ligger i nätet hos ${u.operator?.name ?? 'ett nätbolag'}, vars avbrottskarta inte är ansluten ännu.`, tone: SEV.unknown };
  if (u.operatorCandidates && u.operatorCandidates.length > 1)
    return { label: 'Osäkert nätbolag', detail: `Fastigheten ligger nära gränsen mellan ${u.operatorCandidates.join(' och ')}. Avbrott visas om de publiceras för adressen.`, tone: SEV.unknown };
  if (u.coverage === 'unknown')
    return { label: 'Nätbolaget är okänt', detail: 'Avbrott visas om ett bevakat nätbolag publicerar dem för adressen. Avsaknad av avbrott kan inte bekräftas.', tone: SEV.unknown };
  return { label: 'Inga registrerade avbrott', detail: `${u.operator!.name} har inga pågående avbrott som omfattar adressen.`, tone: SEV.normal };
}
const RANK: Record<string, number> = { critical: 3, warning: 2, monitor: 1 };
const rank = (v: UtilityOutageView) => RANK[v.severity ?? ''] ?? 0;

export function buildUtilityOutageVM(s: PropertySnapshot): OutagePanelVM {
  const u = s.utilityOutages?.find((x) => x.utility === 'electricity');
  if (!u) {
    return { available: false, title: 'Elnät', subtitle: 'Nätbolagens avbrottskartor', state: null, current: [], upcoming: [], restored: [], nearby: [], footer: '' };
  }
  // District heating/cooling sections exist only when an outage matched (Fas 4); their rows join the
  // electricity panel, while coverage wording stays about the power grid.
  const heat = (s.utilityOutages ?? []).filter((x) => x.utility !== 'electricity');
  const all = [u, ...heat];
  const pick = (k: 'current' | 'upcoming' | 'recentlyRestored' | 'nearby') => all.flatMap((x) => x[k]);
  const current = pick('current');
  const worst = [...current].sort((a, b) => rank(b) - rank(a))[0];
  const state = worst && worst.utility !== 'electricity' && !u.current.length
    ? { label: worst.kind === 'unplanned' ? `Oplanerat ${utilityNoun(worst.utility)}` : worst.kind === 'planned' ? `Planerat ${utilityNoun(worst.utility)} pågår` : 'Avbrott registrerat', detail: worst.precisionLabel, tone: tone(worst) }
    : headState(u);
  return {
    available: true,
    title: heat.length ? 'El och fjärrvärme' : 'Elnät',
    subtitle: u.operator ? `${u.operator.name} · avbrottskarta` : 'Nätbolagens avbrottskartor',
    state,
    current: current.map(outageRowVM),
    upcoming: pick('upcoming').sort((a, b) => Date.parse(a.plannedStart ?? '') - Date.parse(b.plannedStart ?? '')).map(outageRowVM),
    restored: pick('recentlyRestored').map(outageRowVM),
    nearby: pick('nearby').map(outageRowVM),
    footer: `Uppgifter från nätbolagets publika avbrottskarta${u.updatedAt ? `, hämtad ${formatClock(u.updatedAt)}` : ''}. Visar registrerade avbrott i området – inte en mätning av fastighetens el eller värme. Nätområde enligt Energimarknadsinspektionen (ungefärliga gränser).`,
  };
}

/** Polygons to draw on the property map (matched outages only). */
export function outageShapes(s: PropertySnapshot): Array<{ id: string; geometry: unknown; color: string; label: string; dashed: boolean }> {
  return (s.utilityOutages ?? [])
    .flatMap((u) => [...u.current, ...u.upcoming, ...u.nearby])
    .filter((v) => v.geometry)
    .map((v) => ({
      id: v.id,
      geometry: v.geometry,
      color: tone(v).hx,
      label: outageHeadline({ utility: v.utility, kind: v.kind, state: v.state, plannedStart: v.plannedStart, plannedEnd: v.plannedEnd }, v.operatorName),
      dashed: v.matchMethod === 'outage_postal_area' || v.matchMethod === 'outage_area' || v.state === 'upcoming',
    }));
}
