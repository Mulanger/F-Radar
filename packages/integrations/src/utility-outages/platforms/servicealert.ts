import { z } from 'zod';
import type { OutageKind, UtilityKind } from '@fastighetsradar/domain';
import { iso } from '../../http';
import { circleRing, closeRing, inSweden, polygonsToGeoJson, type LonLat } from '../geometry';
import { hasIncompleteUtilityLayer } from '../types';
import type { NormalizedUtilityOutage, OutageFetchResult, UtilityOperator } from '../types';
import { waterNoticeHeading, boilingEndedHeading } from './water-notices';

/**
 * ServiceAlert (sms-service.dk) "driftstatus" map – POST https://se.sms-service.dk/api/WebMessage/
 * GetDriftstatusWebMessagesMapModel with body { customerIds: "<uuid>" } (verified 2026-11-14).
 * Messages per profile ("Elnät", "Fjärrvärme", …) with an operator-drawn area (point + radius or
 * polygon), a title and HTML text. Some water profiles publish address coordinates instead.
 * Publication and expiry times describe the message. They do not establish the interruption times.
 */
export const ServiceAlertPayload = z
  .object({
    profileSettingsAndMessages: z.array(
      z
        .object({
          profileTitle: z.string().nullish(),
          webMessages: z.array(z.unknown()).nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const Message = z
  .object({
    id: z.number().int(),
    title: z.string().nullish(),
    text: z.string().nullish(),
    smsGroupGeoObjects: z.string().nullish(),
    smsGroupSendMethod: z.string().nullish(),
    affectedAddressesCoordinates: z.unknown(),
    dateExpireUtc: z.string().nullish(),
    dateDelayUtc: z.string().nullish(),
    criticalStatus: z.boolean().nullish(),
  })
  .passthrough();

/**
 * Profile title → utility and, when the operator splits its profiles (Mölndal: "Elnät - Planerade
 * avbrott" / "Elnät - Akuta avbrott"), the kind. Anything else stays 'unknown'.
 */
export function serviceAlertProfile(title: string | null | undefined): { utility: UtilityKind; kind: OutageKind } | null {
  const t = (title ?? '').trim().toLowerCase();
  const utility: UtilityKind | null = t.startsWith('elnät') || t === 'el' ? 'electricity' : t.startsWith('fjärrvärme') ? 'district_heating' : t.startsWith('fjärrkyla') ? 'district_cooling' : t === 'va' || t === 'va distribution' || /^vatten(?:$|\s)/.test(t) ? 'water' : null;
  if (!utility) return null;
  const kind: OutageKind = /akut|driftstörning|oplanerad/.test(t) ? 'unplanned' : /planer/.test(t) ? 'planned' : 'unknown';
  return { utility, kind };
}

/** Plain text from the message HTML (tags removed, entities decoded, whitespace collapsed). */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const t = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return t || null;
}

/** Areas from smsGroupGeoObjects (GeoJSON Features as a string): Point+radius → circle, Polygon kept. */
export function serviceAlertAreas(geo: string | null | undefined): LonLat[][][] | null {
  if (!geo) return null;
  let features: unknown;
  try {
    features = JSON.parse(geo);
  } catch {
    return null;
  }
  const list = Array.isArray(features) ? features : [features];
  const polys: LonLat[][][] = [];
  for (const f of list) {
    const g = (f as { geometry?: { type?: string; coordinates?: unknown } })?.geometry;
    const radius = Number((f as { properties?: { radius?: unknown } })?.properties?.radius);
    if (g?.type === 'Point' && Array.isArray(g.coordinates)) {
      const ring = circleRing([Number(g.coordinates[0]), Number(g.coordinates[1])], radius);
      if (ring) polys.push([ring]);
    } else if (g?.type === 'Polygon' && Array.isArray(g.coordinates)) {
      const rings = (g.coordinates as unknown[]).map((r) => (Array.isArray(r) ? closeRing(r.map((p) => [Number(p?.[0]), Number(p?.[1])] as LonLat)) : null));
      if (rings.every((r): r is LonLat[] => !!r && r.every(inSweden))) polys.push(rings as LonLat[][]);
    }
  }
  return polys.length ? polys : null;
}

const AddressPoints = z.array(z.object({ lat: z.number(), lng: z.number() })).min(1);

function serviceAlertAddressPoints(raw: unknown): LonLat[] | null {
  const parsed = AddressPoints.safeParse(raw);
  if (!parsed.success) return null;
  const points = parsed.data.map(({ lat, lng }): LonLat => [lng, lat]);
  return points.every(inSweden) ? points : null;
}

export function parseServiceAlert(raw: unknown, op: UtilityOperator, utilities: UtilityKind[], now: Date): OutageFetchResult | null {
  const p = ServiceAlertPayload.safeParse(raw);
  if (!p.success) return null;
  const outages: NormalizedUtilityOutage[] = [];
  const skipped = new Map<UtilityKind, number>();
  let hasWaterProfile = false;
  let ignored = 0;
  for (const profile of p.data.profileSettingsAndMessages) {
    const mapped = op.platform === 'servicealert' ? op.profileUtilities?.[profile.profileTitle ?? ''] : undefined;
    const prof = mapped ? { utility: mapped, kind: 'unknown' as const } : serviceAlertProfile(profile.profileTitle);
    const utility = prof?.utility;
    if (utility === 'water' && Array.isArray(profile.webMessages)) hasWaterProfile = true;
    for (const rawMsg of profile.webMessages ?? []) {
      if (!prof || !utility || !utilities.includes(utility)) {
        ignored++;
        continue;
      }
      const m = Message.safeParse(rawMsg);
      if (!m.success) {
        skipped.set(utility, (skipped.get(utility) ?? 0) + 1);
        continue;
      }
      const end = iso(m.data.dateExpireUtc);
      if (end && Date.parse(end) < now.getTime()) {
        ignored++;
        continue;
      }
      const title = m.data.title?.trim() || null;
      const body = htmlToText(m.data.text);
      const notice = utility === 'water' ? waterNoticeHeading(title ?? '') : null;
      if (notice === 'water_restriction') { ignored++; continue; }
      const boiling = notice === 'boil_water';
      const area = serviceAlertAreas(m.data.smsGroupGeoObjects);
      // Only the documented ByAddress representation may fall back to points. A boiling
      // recommendation needs a published area; a nearby marker cannot establish that scope.
      const points = !area && utility === 'water' && !boiling && m.data.smsGroupSendMethod === 'ByAddress'
        && op.platform === 'servicealert' && op.waterAddressPoints
        ? serviceAlertAddressPoints(m.data.affectedAddressesCoordinates) : null;
      const geometry = area ? polygonsToGeoJson(area) : points ? { type: 'MultiPoint' as const, coordinates: points } : null;
      if (!geometry) {
        skipped.set(utility, (skipped.get(utility) ?? 0) + 1);
        continue;
      }
      const boilingEnded = boiling && boilingEndedHeading(title ?? '');
      outages.push({
        noticeKind: notice ?? (utility === 'water' && prof.kind === 'unknown' ? 'information' : 'outage'),
        operatorId: op.id,
        utility,
        externalId: `${op.id}:${m.data.id}`,
        kind: prof.kind,
        // An "acute" profile message is current by nature; otherwise the start is unknown (free text).
        state: boilingEnded ? 'restored' : boiling || prof.kind === 'unplanned' ? 'ongoing' : 'unknown',
        affectedCustomers: null,
        areaCustomerTotal: null,
        reportedAt: iso(m.data.dateDelayUtc),
        plannedStart: null,
        plannedEnd: null,
        actualStart: null,
        estimatedRestore: utility === 'water' ? null : end,
        restoredAt: null,
        precision: points ? 'point' : 'area',
        geometry,
        addresses: null,
        postalCodes: [],
        municipalityCode: null,
        placeLabel: title,
        operatorText: [title, body].filter(Boolean).join(' – ') || null,
        cause: null,
        sourceUrl: op.mapUrl,
        upstream: { critical: m.data.criticalStatus ?? null },
      });
    }
  }
  if (utilities.includes('water') && !hasWaterProfile) return null;
  return { outages, skipped: [...skipped.values()].reduce((n, count) => n + count, 0), ignored, sourceUpdatedAt: null,
    ...(utilities.length > 1 && hasIncompleteUtilityLayer(outages, skipped) ? { incomplete: true } : {}) };
}
