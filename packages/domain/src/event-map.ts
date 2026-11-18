import { z } from 'zod';

/**
 * "Visa på karta" for local events: the affected stretch, point or area of an event near a
 * property. Live data is Trafikverket's own published geometry (WGS84 LineString/Point), so
 * the map shows exactly where the source says the event is – nothing is geocoded from text.
 */

export const EVENT_MAP_ICONS = ['roadwork', 'closed', 'lanes', 'accident', 'obstacle', 'animal', 'queue', 'speed', 'signal', 'ferry', 'transit', 'water', 'crowd', 'fire', 'frost', 'air', 'info', 'power', 'heat'] as const;
export const EventMapIconSchema = z.enum(EVENT_MAP_ICONS);
export type EventMapIcon = z.infer<typeof EventMapIconSchema>;

/** Colour family of the highlighted stretch: red = closed/blocked/work, orange = disturbed, blue = water/cold. */
export const EventMapHueSchema = z.enum(['red', 'orange', 'blue', 'violet']);
export type EventMapHue = z.infer<typeof EventMapHueSchema>;

/** GeoJSON position [lon, lat]. */
const Position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export const EventMapGeometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: Position }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(Position).min(2) }),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(Position).min(2)).min(1) }),
  // Areas: a grid operator's outage area or postal area (outer ring first, holes are ignored when drawing).
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(Position).min(4)).min(1) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(z.array(Position).min(4)).min(1)).min(1) }),
]);
export type EventMapGeometry = z.infer<typeof EventMapGeometrySchema>;

export const EventMapItemSchema = z.object({
  /** Same id as the event in the property snapshot. */
  eventId: z.string(),
  geometry: EventMapGeometrySchema,
  /** Circle radius for area events (a Point with a radius); null for stretches and exact points. */
  radiusM: z.number().positive().nullable(),
  /** Length of the affected stretch in metres; null for points and areas. */
  lengthM: z.number().nonnegative().nullable(),
  /** Short type label, e.g. "Vägarbete", "Vägen avstängd", "Olycka". */
  label: z.string(),
  icon: EventMapIconSchema,
  hue: EventMapHueSchema,
  /** Source's impact text, e.g. "Stor påverkan". */
  impact: z.string().nullable(),
  /** Road or place, e.g. "Väg 75" or "Götgatan". */
  where: z.string().nullable(),
  description: z.string().nullable(),
  validFrom: z.iso.datetime().nullable(),
  validTo: z.iso.datetime().nullable(),
  /** How exact the area is, e.g. "Område enligt nätbolaget" or "Postnummerområde (ungefärligt)". */
  extent: z.string().nullable().optional(),
});
export type EventMapItem = z.infer<typeof EventMapItemSchema>;

export const PropertyEventMapSchema = z.object({ propertyId: z.string(), items: z.array(EventMapItemSchema) });
export type PropertyEventMap = z.infer<typeof PropertyEventMapSchema>;

/**
 * One event of the property's feed on the map – also after it has ended (its stretch is kept for a
 * week), so the dashboard can show where it was, greyed out.
 */
export const PropertyEventMapEventSchema = z.object({
  propertyId: z.string(),
  item: EventMapItemSchema,
  title: z.string(),
  sourceId: z.string(),
  /** Who published it when it is not the source itself, e.g. the grid operator "Ellevio". */
  sourceLabel: z.string().nullable().optional(),
  active: z.boolean(),
  endedAt: z.string().nullable(),
  /** Shortest distance from the property to the stretch/point, metres. */
  distanceM: z.number().nonnegative().nullable(),
});
export type PropertyEventMapEvent = z.infer<typeof PropertyEventMapEventSchema>;

const RED_CODES = new Set(['roadClosed', 'roadworks', 'resurfacingWork', 'maintenanceWork', 'constructionWork', 'laneClosures', 'accident', 'accidentInvolvingHeavyLorries', 'vehicleOnFire']);

/** Icon and colour for a Trafikverket deviation (MessageCodeValue / IconId) or an SL deviation. */
export function trafficMapStyle(x: { sourceId: string; messageCodeValue?: string | null; iconId?: string | null; transportMode?: string | null }): { icon: EventMapIcon; hue: EventMapHue } {
  if (x.sourceId === 'sl_deviations') return { icon: 'transit', hue: 'orange' };
  const code = x.messageCodeValue ?? '';
  const iconId = x.iconId ?? '';
  const hue: EventMapHue = RED_CODES.has(code) ? 'red' : 'orange';
  if (x.transportMode === 'road_ferry' || code === 'ferry' || iconId.startsWith('ferry')) return { icon: 'ferry', hue: 'blue' };
  if (code.startsWith('accident') || iconId === 'roadAccident' || code === 'vehicleOnFire') return { icon: 'accident', hue: 'red' };
  if (code === 'roadClosed' || iconId === 'roadClosed') return { icon: 'closed', hue: 'red' };
  if (iconId === 'roadwork' || /work/i.test(code)) return { icon: 'roadwork', hue: 'red' };
  if (code === 'laneClosures' || code === 'entrySlipRoad' || code === 'exitSlipRoad') return { icon: 'lanes', hue };
  if (code === 'animalsOnTheRoad') return { icon: 'animal', hue };
  if (code === 'objectOnTheRoad' || code === 'brokenDownVehicle' || code === 'obstruction') return { icon: 'obstacle', hue };
  if (code === 'queuingTraffic' || iconId === 'trafficJamMessage') return { icon: 'queue', hue };
  if (code === 'speedRestrictionInOperation') return { icon: 'speed', hue };
  if (code === 'trafficSignals' || code === 'notWorking') return { icon: 'signal', hue };
  if (/slippery|ice|snow|frost/i.test(code)) return { icon: 'frost', hue: 'blue' };
  return { icon: 'info', hue };
}

/** "Väg 75 på Södra Länken mellan …" from a "Vägarbete: Väg 75 på …" headline; null when the headline is only the type. */
export function eventPlaceFromHeadline(headline: string, eventType: string | null): string | null {
  const prefix = eventType ? `${eventType}: ` : null;
  if (prefix && headline.startsWith(prefix)) return headline.slice(prefix.length).trim() || null;
  const i = headline.indexOf(': ');
  return i > 0 ? headline.slice(i + 2).trim() || null : null;
}
