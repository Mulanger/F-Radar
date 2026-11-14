import type { UtilityOperator } from './types';

/**
 * Grid operators collected in Fas 1 (docs/plans/stromavbrott.md §4). Every entry was verified live
 * on 2026-11-14 (outage endpoint HTTP 200 + parseable). Concession KML is listed only where it
 * answered 200; the others return 404 and get coverage 'unknown' in the dashboard.
 *
 * To stop collecting from one operator without a deploy, leave it out of UTILITY_OUTAGE_OPERATORS.
 */
const digpro = (name: string, host: string, cust: string, concession: boolean, eiName: string): UtilityOperator => ({
  id: `digpro:${cust}`,
  name,
  eiNames: [eiName],
  platform: 'digpro',
  host,
  cust,
  utilities: ['electricity'],
  mapUrl: `https://${host}/outagemap2/?cust=${cust}&app=fpp`,
  concessionUrl: concession ? `https://${host}/bios/site/concession.kml` : null,
});

export const UTILITY_OPERATORS: UtilityOperator[] = [
  {
    id: 'vattenfall',
    name: 'Vattenfall Eldistribution',
    platform: 'vattenfall',
    utilities: ['electricity'],
    dataUrl: 'https://arkmap.vattenfalleldistribution.se/incidents.json',
    eiNames: ['Vattenfall Eldistribution AB'],
    mapUrl: 'https://www.vattenfalleldistribution.se/stromavbrott/pagaende-stromavbrott/',
  },
  {
    id: 'goteborg_energi',
    name: 'Göteborg Energi Nät',
    platform: 'goteborg_energi',
    utilities: ['electricity'],
    apiBase: 'https://www.goteborgenergi.se',
    // Fjärrvärme 50935483 / fjärrkyla 50935477 are added in Fas 4.
    utilityTypeIds: { electricity: '36857905' },
    eiNames: ['Göteborg Energi Nät AB'],
    mapUrl: 'https://www.goteborgenergi.se/kundservice/avbrott/aktuella',
  },
  digpro('Växjö Energi Elnät', 'driftinformation.veab.se', 'vax', false, 'Växjö Energi Elnät AB'),
  digpro('Falu Elnät', 'webmap.fev.se', 'fev', true, 'Falu Elnät AB'),
  digpro('Hedemora Energi', 'webmap.hedemoraenergi.se', 'hed', true, 'Hedemora Elnät AB'),
  digpro('Halmstads Energi och Miljö Nät', 'dpwebmap.hem.se', 'hsd', true, 'Halmstads Energi och Miljö Nät AB'),
  digpro('Härnösand Elnät', 'dpwebmap.hemab.se', 'hem', false, 'Härnösand Elnät AB'),
  digpro('Bergs Tingslags Elektriska', 'dpweb.btea.se', 'bte', false, 'Bergs Tingslags Elektriska AB'),
  digpro('Lerum Energi', 'lerumel.lerum.se', 'lme', false, 'Lerum Nät AB'),
  digpro('Linde Energi', 'webmap.lindeenergi.se', 'lie', false, 'Linde Energi Elnät AB'),
  digpro('Södra Hallands Kraft', 'shkwebmap.sodrahallandskraft.se', 'shk', true, 'Södra Hallands Kraft ek. för.'),
  digpro('Uddevalla Energi Elnät', 'nisweb.uddevallaenergi.se', 'udd', false, 'Uddevalla Energi Elnät AB'),
  digpro('Västerbergslagens Elnät', 'status.vbenergi.se', 'vbe', false, 'Västerbergslagens Elnät AB'),
  digpro('Dala Energi Elnät', 'dedpweb.dalaenergi.se', 'lre', true, 'Dala Energi Elnät AB'),
  // Fas 2 (docs/plans/stromavbrott.md): Ellevio publishes postal areas only (dashboard, never SMS).
  {
    id: 'ellevio',
    name: 'Ellevio',
    platform: 'ellevio',
    utilities: ['electricity'],
    loadUrl: 'https://avbrottskarta.ellevio.se/avbrottskartan/load.php',
    version: '1.4.5',
    mapUrl: 'https://avbrottskarta.ellevio.se/',
    eiNames: ['Ellevio AB'],
  },
  {
    id: 'tekniskaverken',
    name: 'Tekniska verken Linköping Nät',
    platform: 'tekniskaverken',
    utilities: ['electricity'],
    apiBase: 'https://avbrott.tekniskaverken.se/api/service-information',
    brand: 'tekniskaverken',
    mapUrl: 'https://avbrott.tekniskaverken.se/?tab=map',
    eiNames: ['Tekniska verken Linköping Nät AB'],
  },
  ...(
    [
      ['malarenergi', 'Mälarenergi Elnät', 'https://driftinfo.malarenergi.se/NisOutageMap', 'https://www.malarenergi.se/avbrott/', 'Mälarenergi Elnät AB'],
      ['jamtkraft', 'Jämtkraft Elnät', 'https://avbrottskarta.jamtkraft.se', 'https://avbrottskarta.jamtkraft.se/', 'Jämtkraft Elnät AB'],
      ['sundsvall', 'Sundsvall Elnät', 'https://avbrottskarta.sundsvallelnat.se', 'https://avbrottskarta.sundsvallelnat.se/', 'Sundsvall Elnät AB'],
      ['gavle', 'Gävle Energi Elnät', 'https://avbrottskartan.gavleenergi.se', 'https://avbrottskartan.gavleenergi.se/', 'Gävle Energi Elnät AB'],
    ] as const
  ).map(([id, name, base, mapUrl, eiName]): UtilityOperator => ({ id: `trimble:${id}`, name, platform: 'trimble', base, scope: 'p', utilities: ['electricity'], mapUrl, eiNames: [eiName] })),
];

/** Operators enabled by UTILITY_OUTAGE_OPERATORS ("" = all, "none" = none, else comma list of ids). */
export function enabledOperators(setting: string | undefined, all: UtilityOperator[] = UTILITY_OPERATORS): UtilityOperator[] {
  const v = (setting ?? '').trim();
  if (!v) return all;
  if (v.toLowerCase() === 'none') return [];
  const ids = new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
  return all.filter((o) => ids.has(o.id));
}

export const operatorById = (id: string) => UTILITY_OPERATORS.find((o) => o.id === id) ?? null;

/** Ei concession holder name → our operator id (unmapped holders get `ei:<name>`, shown as "not monitored"). */
export function operatorIdForEiName(eiName: string, all: UtilityOperator[] = UTILITY_OPERATORS): string {
  const hit = all.find((o) => o.eiNames.includes(eiName.trim()));
  return hit ? hit.id : `ei:${eiName.trim()}`;
}
