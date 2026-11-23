import { isOfferedUtility } from '@fastighetsradar/domain';
import type { UtilityOperator } from './types';
import type { ServerEnv } from '@fastighetsradar/config';

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
    id: 'svoa', name: 'Stockholm Vatten och Avfall', platform: 'svoa', utilities: ['water'],
    dataUrl: 'https://www.stockholmvattenochavfall.se/driftinfo/Search', mapUrl: 'https://www.stockholmvattenochavfall.se/driftinfo',
    eiNames: [], enableFlag: 'SOURCE_UTILITY_SVOA_ENABLED', utilityFlags: { water: 'SOURCE_UTILITY_WATER_ENABLED' },
    reportsRestored: true, pollSeconds: 900,
  },
  {
    id: 'stockholm_exergi', name: 'Stockholm Exergi', platform: 'digpro',
    host: 'avbrott.stockholmexergi.com', cust: 'fov', concessionUrl: null,
    utilities: ['district_heating'], eiNames: [], reportsRestored: true,
    mapUrl: 'https://www.stockholmexergi.se/driftinformation/', enableFlag: 'SOURCE_UTILITY_EXERGI_ENABLED',
  },
  {
    id: 'vattenfall_heat', name: 'Vattenfall Värme', platform: 'trimble', scope: 'h',
    base: 'https://heatoutagemap.vattenfall.se/NisOutageMap', utilities: ['district_heating'],
    mapUrl: 'https://www.vattenfall.se/fjarrvarme/avbrott/', eiNames: [], reportsRestored: true,
    enableFlag: 'SOURCE_UTILITY_VATTENFALL_HEAT_ENABLED',
  },
  {
    id: 'solor', name: 'Solör Bioenergi', platform: 'servicealert', apiBase: 'https://se.sms-service.dk/api',
    customerIds: '8db0da40-30d0-46f1-9edf-3ce22a771f48,eea230aa-0ed3-4d19-8681-d46b1f32c4d7',
    utilities: ['district_heating'], eiNames: [], pollSeconds: 900,
    mapUrl: 'https://solorbioenergi.se/driftinformation/', enableFlag: 'SOURCE_UTILITY_SOLOR_ENABLED',
    profileUtilities: Object.fromEntries(['Region Syd', 'Region Stockholm – Sandudden', 'Region Väst - Driftområde Falköping', 'Region Stockholm', 'Region Mellan', 'Region Nordväst', 'Region Norr', 'Region Öst', 'Region Småland', 'Region Väst - Driftområde Härryda', 'Region Väst - Driftområde Örebro', 'Region Väst - Driftområde Svenljunga'].map((p) => [p, 'district_heating' as const])),
  },
  {
    id: 'oresundskraft', name: 'Öresundskraft Elnät', platform: 'trimble', scope: 'p',
    base: 'https://driftinformation.oresundskraft.se/OutageMap', utilities: ['electricity'],
    mapUrl: 'https://www.oresundskraft.se/avbrottsinformation/', eiNames: ['Öresundskraft Elnät AB'],
    enableFlag: 'SOURCE_UTILITY_ORESUND_ENABLED',
  },
  {
    id: 'kraftringen_elnat', name: 'Kraftringen Nät', platform: 'digpro',
    host: 'stavbrottskartan.blob.core.windows.net', cust: 'lnd', concessionUrl: null,
    outageUrls: { electricity: 'https://stavbrottskartan.blob.core.windows.net/xml/fpp_lnd_outages.kml' },
    utilities: ['electricity'], mapUrl: 'https://www.kraftringen.se/kundservice/avbrott-och-felanmalan/stromavbrott/',
    eiNames: ['Kraftringen Nät AB'], enableFlag: 'SOURCE_UTILITY_KRAFTRINGEN_ENABLED',
  },
  {
    id: 'umea', name: 'Umeå Energi', platform: 'umea', utilities: ['electricity', 'district_heating', 'district_cooling'],
    utilityFlags: { district_heating: 'SOURCE_UTILITY_UMEA_HEAT_ENABLED', district_cooling: 'SOURCE_UTILITY_UMEA_HEAT_ENABLED' },
    dataUrl: 'https://uewebstorage.blob.core.windows.net/disturbance-data-prod/disturbances.json',
    mapUrl: 'https://driftinfo.umeaenergi.se/', eiNames: ['Umeå Energi Elnät AB'], enableFlag: 'SOURCE_UTILITY_UMEA_ENABLED',
  },
  {
    id: 'skekraft', name: 'Skellefteå Kraft Elnät', platform: 'skekraft', utilities: ['electricity'],
    dataUrl: 'https://driftinfo3-api.skekraft.se/api/disturbances',
    mapUrl: 'https://driftinfo.skekraft.se/', eiNames: ['Skellefteå Kraft Elnät AB'], enableFlag: 'SOURCE_UTILITY_SKEKRAFT_ENABLED',
  },
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
    utilities: ['electricity', 'district_heating', 'district_cooling', 'gas'],
    utilityFlags: { gas: 'SOURCE_UTILITY_GAS_ENABLED' },
    apiBase: 'https://www.goteborgenergi.se',
    utilityTypeIds: { electricity: '36857905', district_heating: '50935483', district_cooling: '50935477', gas: '36857929' },
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
    utilities: ['electricity', 'district_heating', 'district_cooling', 'water'],
    utilityFlags: { water: 'SOURCE_UTILITY_WATER_ENABLED' },
    apiBase: 'https://avbrott.tekniskaverken.se/api/service-information',
    brand: 'tekniskaverken',
    mapUrl: 'https://avbrott.tekniskaverken.se/?tab=map',
    eiNames: ['Tekniska verken Linköping Nät AB'],
  },
  ...(
    [
      ['malarenergi', 'Mälarenergi', 'https://driftinfo.malarenergi.se/NisOutageMap', 'https://www.malarenergi.se/avbrott/', 'Mälarenergi Elnät AB'],
      ['jamtkraft', 'Jämtkraft Elnät', 'https://avbrottskarta.jamtkraft.se', 'https://avbrottskarta.jamtkraft.se/', 'Jämtkraft Elnät AB'],
      ['sundsvall', 'Sundsvall Elnät', 'https://avbrottskarta.sundsvallelnat.se', 'https://avbrottskarta.sundsvallelnat.se/', 'Sundsvall Elnät AB'],
      ['gavle', 'Gävle Energi Elnät', 'https://avbrottskartan.gavleenergi.se', 'https://avbrottskartan.gavleenergi.se/', 'Gävle Energi Elnät AB'],
    ] as const
  ).map(([id, name, base, mapUrl, eiName]): UtilityOperator => ({ id: `trimble:${id}`, requiresSwedishEgress: id === 'jamtkraft', name, platform: 'trimble', base, scope: 'p', utilities: id === 'malarenergi' ? ['electricity', 'district_heating'] : ['electricity'],
    ...(id === 'malarenergi' ? { utilityFlags: { district_heating: 'SOURCE_UTILITY_MALAR_HEAT_ENABLED' as const }, utilityScopes: { electricity: 'p', district_heating: 'h' } } : {}), mapUrl, eiNames: [eiName] })),
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
    utilities: ['electricity', 'district_heating', 'district_cooling', ...(['soderhamn', 'oxelo', 'emmaboda', 'eem', 'ljusdal', 'ulricehamn'].includes(id) ? ['water' as const] : [])],
    utilityFlags: { water: 'SOURCE_UTILITY_WATER_ENABLED' },
    mapUrl,
    eiNames: [eiName],
  })),
  {
    id: 'nsva', name: 'Nordvästra Skånes Vatten och Avlopp', platform: 'nsva', utilities: ['water'],
    mapUrl: 'https://nsva.se/driftinformation/', pollSeconds: 900, reportsRestored: true, eiNames: [],
  },
  ...([
    ['goteborg', 'Göteborgs Stad, Kretslopp och vatten', 'se.sms-service.dk', 'fa77564a-b727-49a0-ac51-5c748b1d17a5', 'https://goteborg.se/wps/portal/start/bygga-bo-och-leva-hallbart/vatten-och-avlopp/vattenavstangningar-och-andra-storningar/vattenavstangningar', true],
    ['malarenergi-va', 'Mälarenergi Vatten', 'se.sms-service.dk', '7a1b4c7f-3bfb-4c16-b801-e9fa041fb3fa', 'https://www.malarenergi.se/avbrott/', true],
    ['gastrike-vatten', 'Gästrike Vatten', 'servicealert.se', 'dc76ea07-473a-4766-a084-bbc7919f1e85', 'https://www.gastrikevatten.se/vattenavlopp/driftstorningar.202.html', false],
    ['msva', 'MittSverige Vatten & Avfall', 'se.sms-service.dk', '6b6db1c5-bcfa-437b-917d-64a63f77d67c', 'https://msva.se/driftstorningar', false],
    ['vaxjo-va', 'Växjö kommun', 'se.sms-service.dk', 'e8060849-abad-4481-8327-3afeaeb4feb0', 'https://www.vaxjo.se/sidor/bygga-och-bo/vatten-och-avlopp/aktuella-driftstorningar-for-vatten-och-avlopp.html', false],
    ['lumire', 'Luleå Miljöresurs', 'se.sms-service.dk', '0e6aba9c-c50e-433f-84d0-a4be23491e89', 'https://lumire.se/driftinformation/', true],
    ['molndal-va', 'Mölndals stad', 'se.sms-service.dk', 'ad04ffd5-0030-4d77-af1a-bf08680dc18a', 'https://www.molndal.se/bygga-bo-och-miljo/vatten-och-avlopp/vattenavstangningar-och-avbrott', false],
  ] as const).map(([id, name, host, customerIds, mapUrl, waterAddressPoints]): UtilityOperator => ({
    id: `servicealert:${id}`, name, platform: 'servicealert', apiBase: `https://${host}/api`,
    customerIds, mapUrl, utilities: ['water'], eiNames: [],
    ...(waterAddressPoints ? { waterAddressPoints: true } : {}),
  })),
];

// Keep installations with an unset allowlist on their existing sources.
const DEFAULT_WATER_OPERATORS = new Set([
  'svoa', 'tekniskaverken', 'servicealert:soderhamn', 'servicealert:oxelo', 'servicealert:emmaboda',
  'servicealert:eem', 'servicealert:ljusdal', 'servicealert:ulricehamn',
]);

export function isWaterOutageEnabled(operatorId: string, flags?: Partial<ServerEnv>): boolean {
  const setting = flags?.UTILITY_OUTAGE_WATER_OPERATORS?.trim();
  return flags?.SOURCE_UTILITY_WATER_ENABLED === true
    && (setting ? setting.split(',').some((id) => id.trim() === operatorId) : DEFAULT_WATER_OPERATORS.has(operatorId));
}

export function operatorWithEnabledUtilities(op: UtilityOperator, flags?: Partial<ServerEnv>): UtilityOperator {
  return { ...op, utilities: op.utilities.filter((u) =>
    isOfferedUtility(u) && (u !== 'water' || isWaterOutageEnabled(op.id, flags)) && (!op.utilityFlags?.[u] || flags?.[op.utilityFlags[u]!] === true)) };
}

/** Operators enabled by UTILITY_OUTAGE_OPERATORS ("" = all, "none" = none, else comma list of ids). */
export function enabledOperators(setting: string | undefined, all: UtilityOperator[] = UTILITY_OPERATORS, flags?: Partial<ServerEnv>): UtilityOperator[] {
  all = all.filter((o) => !o.enableFlag || flags?.[o.enableFlag] === true);
  all = all.map((o) => operatorWithEnabledUtilities(o, flags)).filter((o) => o.utilities.length > 0);
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
