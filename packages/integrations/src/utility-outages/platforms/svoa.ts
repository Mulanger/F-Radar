import { z } from 'zod';
import type { OutageKind, OutageState } from '@fastighetsradar/domain';
import { closeRing, inSweden, polygonsToGeoJson, type LonLat } from '../geometry';
import type { OutageFetchResult, UtilityOperator } from '../types';
import { htmlToText } from './servicealert';
import { publishedLocalTime } from './published-json';
import { waterNoticeHeading, boilingEndedHeading } from './water-notices';
export { waterNoticeHeading } from './water-notices';

export const SvoaPage = z.object({ totalCount: z.number().int().nonnegative(), disturbances: z.array(z.unknown()) }).passthrough();
const Row = z.object({
  pageId: z.string().min(1), type: z.string(), status: z.string(), title: z.string(),
  event: z.string().nullish(), editorText: z.string().nullish(), linkToPage: z.string(),
  startDate: z.string().nullish(), expectedEndDate: z.string().nullish(), lastUpdated: z.string().nullish(),
  affectedAreaCoordinates: z.array(z.object({ id: z.string(), type: z.string(), latitude: z.string(), longitude: z.string() })).nullish(),
}).passthrough();

export function parseSvoa(rows: unknown[], op: UtilityOperator): OutageFetchResult {
  const out: OutageFetchResult = { outages: [], skipped: 0, ignored: 0, sourceUpdatedAt: null };
  for (const raw of rows) {
    // Unrelated construction/recycling projects must never become water outages.
    const type = (raw as { type?: unknown })?.type;
    if (typeof type === 'string' && !['water', 'drinkingwater'].includes(type)) { out.ignored++; continue; }
    const p = Row.safeParse(raw);
    if (!p.success) { out.skipped++; continue; }
    const r = p.data;
    const notice = waterNoticeHeading(r.title);
    // Water-saving notices already come through Krisinformation: avoid duplicate pipeline alerts.
    if (notice === 'water_restriction') { out.ignored++; continue; }
    const groups = new Map<string, LonLat[]>();
    let bad = false;
    for (const c of r.affectedAreaCoordinates ?? []) {
      if (c.type !== 'Område') { bad = true; break; }
      const point: LonLat = [Number(c.longitude), Number(c.latitude)];
      if (!inSweden(point)) { bad = true; break; }
      if (!groups.has(c.id)) groups.set(c.id, []);
      groups.get(c.id)!.push(point);
    }
    const rings = [...groups.values()].map(closeRing);
    const geometry = !bad && rings.length && rings.every((p): p is LonLat[] => !!p) ? polygonsToGeoJson(rings.map((p) => [p])) : null;
    if (!geometry) { out.skipped++; continue; }
    const status: OutageState = r.status === 'iscompleted' ? 'restored' : r.status === 'isupcoming' ? 'upcoming' : r.status === 'isongoing' ? 'ongoing' : 'unknown';
    // Source's generated event intro is structured prose, distinct from historical editor updates.
    const kind: OutageKind = r.status === 'isupcoming' || /^På grund av underhåll av vattenledningarna/i.test(r.event ?? '') ? 'planned'
      : /^På grund av en oförutsedd vattenläcka/i.test(r.event ?? '') ? 'unplanned' : 'unknown';
    const start = publishedLocalTime(r.startDate), end = publishedLocalTime(r.expectedEndDate);
    const updated = publishedLocalTime(r.lastUpdated);
    const noticeKind = notice ?? (r.type === 'drinkingwater' ? 'information' : 'outage');
    const url = new URL(r.linkToPage, op.mapUrl);
    if (url.origin !== new URL(op.mapUrl).origin || !['https:'].includes(url.protocol)) { out.skipped++; continue; }
    // A negative heading is never turned into an active recommendation; explicit completed status is required.
    const negated = boilingEndedHeading(r.title) || /ingen kokningsrekommendation|inte längre/i.test(r.title);
    if (noticeKind === 'boil_water' && negated && status !== 'restored') { out.skipped++; continue; }
    out.outages.push({
      operatorId: op.id, externalId: `${op.id}:${r.pageId}`, utility: 'water', noticeKind, kind,
      state: status, precision: 'polygon', geometry,
      affectedCustomers: null, areaCustomerTotal: null, reportedAt: updated,
      plannedStart: kind === 'planned' ? start : null, plannedEnd: kind === 'planned' ? end : null,
      actualStart: status === 'upcoming' ? null : start, estimatedRestore: status === 'restored' ? null : end,
      // expectedEndDate is an estimate, even after status completed. Do not invent restoration time.
      restoredAt: null, addresses: null, postalCodes: [], municipalityCode: null,
      placeLabel: r.title, operatorText: [r.title, htmlToText(r.event), htmlToText(r.editorText)].filter(Boolean).join('\n'),
      cause: null, sourceUrl: url.href, upstream: { type: r.type, status: r.status },
    });
  }
  return out;
}
