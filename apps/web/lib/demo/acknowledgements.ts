import { ACKNOWLEDGEMENT_EXPORT_MAX, ACKNOWLEDGEMENT_PAGE_SIZE, type AcknowledgementExport, type AcknowledgementHistoryEntry, type AcknowledgementHistoryFilters, type AcknowledgementHistoryPage } from '@fastighetsradar/domain';
import { acknowledgementDay } from '@/lib/acknowledgements/presentation';

const arena = { propertyId: 'demo-arenastaden-hus-c', propertyName: 'Arenastaden Hus C', propertyAddress: 'Evenemangsgatan 21, Solna' };
const strand = { propertyId: 'demo-strandhuset', propertyName: 'Strandhuset', propertyAddress: 'Hantverkargatan 29, Stockholm' };
const sjostaden = { propertyId: 'demo-sjostaden-kaj', propertyName: 'Sjöstaden Kaj', propertyAddress: 'Hammarby kaj 14, Stockholm' };

export const demoAcknowledgements: AcknowledgementHistoryEntry[] = [
  {
    id: '104', ...strand, source: 'SMHI', severity: 'warning', area: 'Stockholms län',
    title: 'Snöfall i kombination med vind',
    description: 'Snöfall och tilltagande vind väntas från sen eftermiddag. Snödrev kan ge dålig sikt och snabbt försämrat väglag. Avsätt extra tid för resor och kontrollera att entréer och utrymningsvägar är framkomliga.',
    eventAt: '2026-11-19T14:44:00Z', acknowledgedAt: '2026-11-19T15:22:00Z', undoneAt: null, imported: false,
  },
  {
    id: '103', ...arena, source: 'Vattenfall Eldistribution', severity: 'critical', area: 'Arenastaden, Solna',
    title: 'Oplanerat elavbrott i Arenastaden',
    description: 'Ett fel i elnätet har orsakat strömavbrott i delar av Arenastaden. Felsökning pågår. Preliminär tid för återställning är kl. 18.30.\n\nKontrollera fastighetens reservkraft och följ nätbolagets information när prognosen uppdateras.',
    eventAt: '2026-11-18T13:02:00Z', acknowledgedAt: '2026-11-18T13:12:00Z', undoneAt: null, imported: false,
  },
  {
    id: '102', ...sjostaden, source: 'Stockholm Exergi', severity: 'warning', area: 'Hammarby Sjöstad',
    title: 'Avbrott i fjärrvärmeleveransen',
    description: 'Ett ledningsfel kan ge tillfälligt lägre temperatur på värme och varmvatten. Reparationsarbetet pågår vid Hammarby kaj.',
    eventAt: '2026-11-18T07:55:00Z', acknowledgedAt: '2026-11-18T08:04:00Z',
    undoneAt: '2026-11-18T08:16:00Z', imported: false,
  },
  {
    id: '101', ...strand, source: 'Stockholm Vatten och Avfall', severity: 'warning', area: 'Kungsholmen',
    title: 'Kokningsrekommendation för dricksvatten',
    description: 'Fastigheter i det berörda området rekommenderas att koka vatten som ska drickas eller användas vid matlagning tills ett nytt besked publiceras.',
    eventAt: '2026-11-17T07:40:00Z', acknowledgedAt: '2026-11-17T08:07:00Z', undoneAt: null, imported: true,
  },
];

/** The whole demo selection for the report, like `/v1/feed/acknowledgements/export` live. */
export function demoAcknowledgementExport(all: AcknowledgementHistoryEntry[], filters: AcknowledgementHistoryFilters, members?: ReadonlySet<string>): AcknowledgementExport {
  const entries = all.filter((entry) => {
    const day = acknowledgementDay(entry.acknowledgedAt);
    return (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to)
      && (!filters.property || entry.propertyId === filters.property)
      && (!filters.group || !members || members.has(entry.propertyId));
  });
  return { entries: entries.slice(0, ACKNOWLEDGEMENT_EXPORT_MAX), truncated: entries.length > ACKNOWLEDGEMENT_EXPORT_MAX };
}

/** `members`: the properties of `filters.group` (the demo portfolio's groups; S-20). */
export function demoAcknowledgementPage(all: AcknowledgementHistoryEntry[], filters: AcknowledgementHistoryFilters, members?: ReadonlySet<string>): AcknowledgementHistoryPage {
  const properties = new Map<string, AcknowledgementHistoryPage['properties'][number]>();
  for (const { propertyId, propertyName, propertyAddress } of all) {
    if (!properties.has(propertyId)) properties.set(propertyId, { id: propertyId, name: propertyName, address: propertyAddress });
  }
  const filtered = all.filter((entry) => {
    const day = acknowledgementDay(entry.acknowledgedAt);
    return (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to)
      && (!filters.property || entry.propertyId === filters.property)
      && (!filters.group || !members || members.has(entry.propertyId));
  });
  const start = filters.cursor ? filtered.findIndex(({ id }) => id === filters.cursor) + 1 : 0;
  const entries = filtered.slice(start, start + ACKNOWLEDGEMENT_PAGE_SIZE);
  return {
    entries,
    nextCursor: filtered.length > start + entries.length ? entries.at(-1)!.id : null,
    properties: [...properties.values()].sort((a, b) => a.name.localeCompare(b.name, 'sv')),
  };
}
