import type { UtilityOperator } from './types';

/**
 * Grid operators collected in Fas 1 (docs/plans/stromavbrott.md §4). Every entry was verified live
 * on 2026-11-14 (outage endpoint HTTP 200 + parseable). Concession KML is listed only where it
 * answered 200; the others return 404 and get coverage 'unknown' in the dashboard.
 *
 * To stop collecting from one operator without a deploy, leave it out of UTILITY_OUTAGE_OPERATORS.
 */
const digpro = (name: string, host: string, cust: string, concession: boolean): UtilityOperator => ({
  id: `digpro:${cust}`,
  name,
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
    mapUrl: 'https://www.goteborgenergi.se/kundservice/avbrott/aktuella',
  },
  digpro('Växjö Energi Elnät', 'driftinformation.veab.se', 'vax', false),
  digpro('Falu Elnät', 'webmap.fev.se', 'fev', true),
  digpro('Hedemora Energi', 'webmap.hedemoraenergi.se', 'hed', true),
  digpro('Halmstads Energi och Miljö Nät', 'dpwebmap.hem.se', 'hsd', true),
  digpro('Härnösand Elnät', 'dpwebmap.hemab.se', 'hem', false),
  digpro('Bergs Tingslags Elektriska', 'dpweb.btea.se', 'bte', false),
  digpro('Lerum Energi', 'lerumel.lerum.se', 'lme', false),
  digpro('Linde Energi', 'webmap.lindeenergi.se', 'lie', false),
  digpro('Södra Hallands Kraft', 'shkwebmap.sodrahallandskraft.se', 'shk', true),
  digpro('Uddevalla Energi Elnät', 'nisweb.uddevallaenergi.se', 'udd', false),
  digpro('Västerbergslagens Elnät', 'status.vbenergi.se', 'vbe', false),
  digpro('Dala Energi Elnät', 'dedpweb.dalaenergi.se', 'lre', true),
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
