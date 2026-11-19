import type { UtilityOperator } from './types';

/**
 * Grid operators collected in Fas 1 (docs/plans/stromavbrott.md §4). Every entry was verified live
 * on 2026-11-14 (outage endpoint HTTP 200 + parseable). Concession KML is listed only where it
 * answered 200; the others return 404 and get coverage 'unknown' in the dashboard.
 *
 * To stop collecting from one operator without a deploy, leave it out of UTILITY_OUTAGE_OPERATORS.
 */
const digpro = (name: string, host: string, cust: string, concession: boolean, eiName: string, heating = false): UtilityOperator => ({
  id: `digpro:${cust}`,
  requiresSwedishEgress: ['fev', 'hsd', 'hem', 'bte', 'lul', 'nac'].includes(cust),
  name,
  eiNames: [eiName],
  platform: 'digpro',
  host,
  cust,
  // 'fpdh' = district-heating layer (Fas 4), verified live where enabled.
  utilities: heating ? ['electricity', 'district_heating'] : ['electricity'],
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
    utilities: ['electricity', 'district_heating', 'district_cooling'],
    apiBase: 'https://www.goteborgenergi.se',
    utilityTypeIds: { electricity: '36857905', district_heating: '50935483', district_cooling: '50935477' },
    eiNames: ['Göteborg Energi Nät AB'],
    mapUrl: 'https://www.goteborgenergi.se/kundservice/avbrott/aktuella',
  },
  digpro('Växjö Energi Elnät', 'driftinformation.veab.se', 'vax', false, 'Växjö Energi Elnät AB'),
  digpro('Falu Elnät', 'webmap.fev.se', 'fev', true, 'Falu Elnät AB'),
  digpro('Hedemora Energi', 'webmap.hedemoraenergi.se', 'hed', true, 'Hedemora Elnät AB'),
  digpro('Halmstads Energi och Miljö Nät', 'dpwebmap.hem.se', 'hsd', true, 'Halmstads Energi och Miljö Nät AB', true),
  digpro('Härnösand Elnät', 'dpwebmap.hemab.se', 'hem', false, 'Härnösand Elnät AB'),
  digpro('Bergs Tingslags Elektriska', 'dpweb.btea.se', 'bte', false, 'Bergs Tingslags Elektriska AB'),
  digpro('Lerum Energi', 'lerumel.lerum.se', 'lme', false, 'Lerum Nät AB'),
  digpro('Linde Energi', 'webmap.lindeenergi.se', 'lie', false, 'Linde Energi Elnät AB'),
  digpro('Södra Hallands Kraft', 'shkwebmap.sodrahallandskraft.se', 'shk', true, 'Södra Hallands Kraft ek. för.'),
  digpro('Uddevalla Energi Elnät', 'nisweb.uddevallaenergi.se', 'udd', false, 'Uddevalla Energi Elnät AB', true),
  digpro('Västerbergslagens Elnät', 'status.vbenergi.se', 'vbe', false, 'Västerbergslagens Elnät AB'),
  digpro('Dala Energi Elnät', 'dedpweb.dalaenergi.se', 'lre', true, 'Dala Energi Elnät AB'),
  // Fas 3: found by scripts/discover-outage-platforms.mjs and verified live 2026-11-14.
  digpro('Borlänge Energi Elnät', 'dpwebmap.borlange-energi.se', 'bee', false, 'AB Borlänge Energi Elnät'),
  digpro('Luleå Energi Elnät', 'webmap.luleaenergi.se', 'lul', false, 'Luleå Energi Elnät AB', true),
  digpro('Nacka Energi', 'dp-prod.nackaenergi.se', 'nac', false, 'Nacka Energi AB'),
  digpro('Partille Energi Nät', 'avbrottskarta.partilleenergi.se', 'pen', false, 'Partille Energi Nät AB', true),
  // Kraftringen: only its district-heating map is a Digpro installation (power map not supported).
  {
    id: 'digpro:lnd',
    name: 'Kraftringen',
    platform: 'digpro',
    host: 'avbrott-fjv.kraftringen.se',
    cust: 'lnd',
    utilities: ['district_heating'],
    mapUrl: 'https://avbrott-fjv.kraftringen.se/outagemap2/?cust=lnd&app=fpdh',
    concessionUrl: null,
    eiNames: [],
  },
  digpro('Sala-Heby Energi Elnät', 'webmap.sheab.se', 'she', false, 'Sala-Heby Energi Elnät AB'),
  digpro('Varbergsortens Elnät', 'vbgwebmap.digpro.se', 'vbo', false, 'Varbergsortens Elnät AB'),
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
    utilities: ['electricity', 'district_heating', 'district_cooling'],
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
  ).map(([id, name, base, mapUrl, eiName]): UtilityOperator => ({ id: `trimble:${id}`, requiresSwedishEgress: id === 'jamtkraft', name, platform: 'trimble', base, scope: 'p', utilities: ['electricity'], mapUrl, eiNames: [eiName] })),
  // Fas 3: E.ON decoded from its map bundle (station areas → area precision).
  {
    id: 'eon',
    name: 'E.ON Energidistribution',
    platform: 'eon',
    utilities: ['electricity'],
    base: 'https://avbrott.eon.se',
    mapUrl: 'https://www.eon.se/el/stromavbrott/avbrottskarta',
    eiNames: ['E.ON Energidistribution AB'],
  },
  // Fas 3: ServiceAlert notices (free text, panel only).
  ...(
    [
      ['karlstad', 'Karlstads Elnät', 'https://se.sms-service.dk/api', 'fa39c3a2-d576-40c3-bfa5-ae15f9117d90', 'https://www.karlstadsenergi.se/', 'Karlstads Elnät AB'],
      ['soderhamn', 'Söderhamn Elnät', 'https://servicealert.se/api', 'f3474119-d249-4f27-ae7b-6678cc0d13b7', 'https://www.soderhamnnara.se/', 'Söderhamn Elnät AB'],
      ['oxelo', 'Oxelö Energi', 'https://se.sms-service.dk/api', '30fd736a-94e0-45df-a2b0-23c0d166e18e', 'https://www.oxeloenergi.se/', 'Oxelö Energi AB'],
      ['emmaboda', 'Emmaboda Elnät', 'https://se.sms-service.dk/api', '2fa2eb2b-9e54-4127-94f6-8deaa51be9c4', 'https://www.emmabodaenergi.se/kundservice/driftstorningar.html', 'Emmaboda Elnät AB'],
      ['eem', 'Eskilstuna Energi och Miljö Elnät', 'https://se.sms-service.dk/api', '85d4733d-c1dc-4e4f-8af1-ae9937e58e12', 'https://www.eem.se/privat/kundservice/driftinformation', 'Eskilstuna Energi och Miljö Elnät AB'],
      ['habo', 'Habo Kraft', 'https://se.sms-service.dk/api', '13ffa115-3abc-4fd5-bc58-0db7da9892f7', 'https://www.habokraft.se/', 'Habo Energi Kraft AB'],
      ['ljusdal', 'Ljusdal Elnät', 'https://servicealert.se/api', '3e5cc8fa-9d3c-481b-874c-b8cf15915e0c', 'https://ljusdalenergi.se/kundservice/driftinformation.html', 'Ljusdal Elnät AB'],
      ['molndal', 'Mölndal Energi Nät', 'https://se.sms-service.dk/api', '1f744d4a-5f2d-494d-b942-a8d6b198c6d5', 'https://www.molndalenergi.se/se-avbrott', 'Mölndal Energi Nät AB'],
      ['tranas', 'Tranås Energi Elnät', 'https://se.sms-service.dk/api', 'cc551bb5-6411-4cdf-b3b2-726c6dd8d9d2', 'https://tranasenergi.se/privat/driftinformation/driftstatus/', 'Tranås Energi Elnät AB'],
      ['ulricehamn', 'Ulricehamns Energi Elnät', 'https://se.sms-service.dk/api', '6b77048d-8683-4229-8f1e-8969f6a10e40', 'https://www.ulricehamnsenergi.se/', 'Ulricehamns Energi Elnät AB'],
      ['osterlen', 'Österlens Kraft Elnät', 'https://se.sms-service.dk/api', 'a3490c54-15ad-40d1-9b56-4436370fde5a', 'https://www.osterlenskraft.se/elnat/driftinfo-felanmalan/', 'Österlens Kraft Elnät AB'],
    ] as const
  ).map(([id, name, apiBase, customerIds, mapUrl, eiName]): UtilityOperator => ({
    id: `servicealert:${id}`,
    name,
    platform: 'servicealert',
    apiBase,
    customerIds,
    // Profiles decide: "Elnät…", "Fjärrvärme", "Fjärrkyla" (Fas 4).
    utilities: ['electricity', 'district_heating', 'district_cooling'],
    mapUrl,
    eiNames: [eiName],
  })),
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
  // Ei's dataset is electricity concessions: only operators we collect power outages from count.
  const hit = all.find((o) => o.utilities.includes('electricity') && o.eiNames.includes(eiName.trim()));
  return hit ? hit.id : `ei:${eiName.trim()}`;
}
