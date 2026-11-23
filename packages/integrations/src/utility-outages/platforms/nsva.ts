import { z } from 'zod';
import { inSweden, type LonLat } from '../geometry';
import type { NormalizedUtilityOutage, OutageFetchResult, UtilityOperator } from '../types';
import { htmlToText } from './servicealert';
import { waterNoticeHeading } from './water-notices';

const MapPayload = z.object({ items: z.array(z.unknown()) });
const Marker = z.object({
  id: z.number().int(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  title: z.string().min(1),
  statusTypeLabel: z.string(),
  url: z.union([z.string(), z.literal(false)]),
  mapIcon: z.string(),
});

/** The public map serializes its marker list into the page. Extract the JSON without executing JS. */
export function parseNsva(html: string, op: UtilityOperator): OutageFetchResult | null {
  const match = /^[\t ]*var nsvaGoogleMaps\s*=\s*(\{[^\r\n]+\});[\t \r]*$/m.exec(html);
  if (!match?.[1]) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return null;
  }
  const parsed = MapPayload.safeParse(raw);
  if (!parsed.success) return null;
  const outages: NormalizedUtilityOutage[] = [];
  let skipped = 0;
  let ignored = 0;
  for (const row of parsed.data.items) {
    const marker = Marker.safeParse(row);
    if (!marker.success) { skipped++; continue; }
    const m = marker.data;
    const title = htmlToText(m.title);
    const notice = waterNoticeHeading(title ?? '');
    if (m.mapIcon === 'incident_finished' || notice === 'water_restriction') { ignored++; continue; }
    // Work markers cover projects as well as maintenance, without stating a service interruption.
    if (m.mapIcon === 'maintenance_publish' || m.mapIcon === 'maintenance_future') { ignored++; continue; }
    const upcoming = m.mapIcon === 'incident_future';
    const coordinates: LonLat = [m.lng ?? NaN, m.lat ?? NaN];
    if ((!upcoming && m.mapIcon !== 'incident_publish') || !title || !inSweden(coordinates) || notice === 'boil_water') {
      skipped++;
      continue;
    }
    outages.push({
      operatorId: op.id, utility: 'water', externalId: `${op.id}:${m.id}`,
      kind: upcoming ? 'planned' : 'unknown', state: upcoming ? 'upcoming' : 'ongoing',
      affectedCustomers: null, areaCustomerTotal: null, reportedAt: null,
      plannedStart: null, plannedEnd: null, actualStart: null, estimatedRestore: null, restoredAt: null,
      precision: 'point', geometry: { type: 'Point', coordinates },
      addresses: null, postalCodes: [], municipalityCode: null, placeLabel: null,
      operatorText: title, cause: null,
      sourceUrl: m.url && m.url.startsWith(op.mapUrl) ? m.url : op.mapUrl,
      upstream: { mapIcon: m.mapIcon },
    });
  }
  return { outages, skipped, ignored, sourceUpdatedAt: null };
}
