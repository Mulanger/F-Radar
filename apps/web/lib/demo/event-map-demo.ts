import type { EventMapItem } from '@fastighetsradar/domain';

/**
 * Demo geometry for "Visa på karta" (fictional events from the demo portfolio), taken from the
 * approved design's fixture: simplified start–end stretches, areas and points. Live data instead uses
 * the source's own published geometry (Trafikverket LineString/Point).
 */
type DemoGeo = Pick<EventMapItem, 'geometry' | 'radiusM' | 'label' | 'icon' | 'hue' | 'impact' | 'where'>;

const DEMO_GEO: Record<string, DemoGeo> = {
  'demo-sjostaden-kaj-event-0': { geometry: {"type":"Point","coordinates":[18.1165,59.304]}, radiusM: 170, label: 'Dagvatten', icon: 'water', hue: 'blue', impact: 'Hög belastning', where: 'Sickla kanal' },
  'demo-sjostaden-kaj-event-1': { geometry: {"type":"LineString","coordinates":[[18.0985,59.3058],[18.106,59.3061]]}, radiusM: null, label: 'Vägarbete', icon: 'roadwork', hue: 'red', impact: 'Ett körfält avstängt', where: 'Hammarby allé' },
  'demo-sjostaden-kaj-event-2': { geometry: {"type":"LineString","coordinates":[[18.088,59.3016],[18.096,59.301]]}, radiusM: null, label: 'Kollektivtrafik', icon: 'transit', hue: 'orange', impact: 'Glesare trafik', where: 'Tvärbanan, Luma–Sickla' },
  'demo-strandhuset-event-0': { geometry: {"type":"LineString","coordinates":[[18.03,59.3333],[18.042,59.3335]]}, radiusM: null, label: 'Luftkvalitet', icon: 'air', hue: 'violet', impact: 'Förhöjd NO₂', where: 'Fleminggatan' },
  'demo-strandhuset-event-1': { geometry: {"type":"LineString","coordinates":[[18.0452,59.3372],[18.0474,59.338]]}, radiusM: null, label: 'Avstängning', icon: 'closed', hue: 'red', impact: 'Helt avstängd', where: 'Barnhusbron' },
  'demo-gotgarden-event-0': { geometry: {"type":"LineString","coordinates":[[18.078,59.311],[18.084,59.3112]]}, radiusM: null, label: 'Ledningsarbete', icon: 'roadwork', hue: 'orange', impact: 'Planerat arbete', where: 'Åsögatan' },
  'demo-odenplan-atrium-event-0': { geometry: {"type":"LineString","coordinates":[[18.04,59.3414],[18.05,59.3416]]}, radiusM: null, label: 'Omledning', icon: 'transit', hue: 'orange', impact: 'Buss 4 omleds', where: 'Karlbergsvägen' },
  'demo-arenastaden-hus-c-event-0': { geometry: {"type":"Point","coordinates":[17.9975,59.3745]}, radiusM: 260, label: 'Evenemang', icon: 'crowd', hue: 'orange', impact: 'Köer väntas', where: 'Arenaområdet' },
  'demo-arenastaden-hus-c-event-1': { geometry: {"type":"LineString","coordinates":[[18.02,59.364],[18.0215,59.37]]}, radiusM: null, label: 'Avstängt körfält', icon: 'roadwork', hue: 'red', impact: 'Ett körfält norrut', where: 'E4 vid Haga' },
  'demo-arenastaden-hus-c-event-2': { geometry: {"type":"Point","coordinates":[18.0111,59.3645]}, radiusM: null, label: 'Kollektivtrafik', icon: 'transit', hue: 'orange', impact: 'Förseningar', where: 'Solna station' },
  'demo-augustendal-brygga-event-0': { geometry: {"type":"Point","coordinates":[18.1606,59.3183]}, radiusM: 100, label: 'Översvämning', icon: 'water', hue: 'blue', impact: 'Vatten på kajen', where: 'Augustendals brygga' },
  'demo-augustendal-brygga-event-1': { geometry: {"type":"Point","coordinates":[18.1599,59.3179]}, radiusM: null, label: 'Inställd trafik', icon: 'ferry', hue: 'red', impact: 'Färjor inställda', where: 'Nacka Strand brygga' },
  'demo-augustendal-brygga-event-2': { geometry: {"type":"LineString","coordinates":[[18.155,59.3134],[18.1562,59.3137]]}, radiusM: null, label: 'Hinder på väg', icon: 'obstacle', hue: 'red', impact: 'Delvis blockerad', where: 'Augustendalsvägen' },
  'demo-ulvsunda-lager-event-0': { geometry: {"type":"Point","coordinates":[17.9821,59.3535]}, radiusM: 160, label: 'Brand', icon: 'fire', hue: 'red', impact: 'Håll fönster stängda', where: 'Ulvsunda industriområde' },
  'demo-ulvsunda-lager-event-1': { geometry: {"type":"LineString","coordinates":[[17.9668,59.3488],[17.968,59.3508]]}, radiusM: null, label: 'Avstängning', icon: 'closed', hue: 'red', impact: 'Avstängd vid Bällstavägen', where: 'Ulvsundavägen' },
  'demo-ulvsunda-lager-event-2': { geometry: {"type":"Point","coordinates":[17.961,59.3445]}, radiusM: 1100, label: 'Frostrisk', icon: 'frost', hue: 'blue', impact: 'Halka möjlig', where: 'Bromma' },
};

/** Map items for a demo property's events (keyed by the demo event id). */
export function demoEventMap(propertyId: string): EventMapItem[] {
  return Object.entries(DEMO_GEO)
    .filter(([id]) => id.startsWith(`${propertyId}-event-`))
    .map(([eventId, g]) => ({ eventId, ...g, lengthM: null, description: null, validFrom: null, validTo: null }));
}
