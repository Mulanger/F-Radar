import { z } from 'zod';
import { parseAddressList, type UtilityKind } from '@fastighetsradar/domain';
import { stockholmLocalToIso } from '../time';
import type { NormalizedUtilityOutage, OutageFetchResult, UtilityOperator } from '../types';

/**
 * Göteborg Energi – planned work listed as street addresses (verified 2026-11-14):
 *   POST https://www.goteborgenergi.se/external-web/api/outages-map-element/upcoming-outages  body {}
 *   → { status: 'Ok', result: { types: [{ type: 'Gas' | 'Fjarrvarme' | 'Fjarrkyla' | …, items: [
 *        { id, addresses: "Stora Nygatan 1, 3\r\nSlussgatan 1", time: "2026-11-15 kl 11:00 till 2026-11-16 kl 02:00",
 *          area, information } ] }] } }
 * No geometry: precision 'address_list', matched against the property's stored street address within
 * the operator's address area (Göteborg). Times: "YYYY-MM-DD kl HH:MM till [YYYY-MM-DD] kl HH:MM".
 */
export const GOTEBORG_ADDRESS_AREA = { lat: 57.7089, lon: 11.9746, radiusM: 25_000 } as const;

const TYPE_UTILITY: Record<string, UtilityKind> = {
  gas: 'gas',
  fjarrvarme: 'district_heating',
  fjarrkyla: 'district_cooling',
  elnat: 'electricity',
  el: 'electricity',
};

const Upcoming = z
  .object({
    status: z.literal('Ok'),
    result: z.object({
      types: z.array(
        z
          .object({
            type: z.string(),
            items: z.array(z.object({ id: z.string(), addresses: z.string().nullish(), time: z.string().nullish(), area: z.string().nullish(), information: z.string().nullish() }).passthrough()),
          })
          .passthrough(),
      ),
    }),
  })
  .passthrough();

/** "2026-11-15 kl 11:00 till 2026-11-16 kl 02:00" / "2026-11-16 kl 07:00 till kl 18:00" → ISO pair, else null. */
export function parseGoteborgTime(text: string | null | undefined): { start: string; end: string | null } | null {
  if (!text) return null;
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})\s+kl\s+(\d{1,2})[:.](\d{2})(?:\s+till\s+(?:(\d{4})-(\d{2})-(\d{2})\s+)?kl\s+(\d{1,2})[:.](\d{2}))?\s*$/i.exec(text);
  if (!m) return null;
  const start = stockholmLocalToIso(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!);
  if (!start) return null;
  if (!m[9]) return { start, end: null };
  const end = m[6] ? stockholmLocalToIso(+m[6]!, +m[7]!, +m[8]!, +m[9]!, +m[10]!) : stockholmLocalToIso(+m[1]!, +m[2]!, +m[3]!, +m[9]!, +m[10]!);
  return end && Date.parse(end) > Date.parse(start) ? { start, end } : null;
}

export function parseGoteborgUpcoming(raw: unknown, op: UtilityOperator, utilities: UtilityKind[], now: Date): OutageFetchResult | null {
  const p = Upcoming.safeParse(raw);
  if (!p.success) return null;
  const outages: NormalizedUtilityOutage[] = [];
  let skipped = 0;
  let ignored = 0;
  for (const t of p.data.result.types) {
    const utility = TYPE_UTILITY[t.type.toLowerCase()];
    for (const item of t.items) {
      if (!utility || !utilities.includes(utility)) {
        ignored++;
        continue;
      }
      const time = parseGoteborgTime(item.time);
      const addresses = parseAddressList(item.addresses);
      if (!time || !addresses) {
        skipped++;
        continue;
      }
      const nowMs = now.getTime();
      const state = Date.parse(time.start) > nowMs ? 'upcoming' : time.end && Date.parse(time.end) <= nowMs ? 'restored' : 'ongoing';
      outages.push({
        operatorId: op.id,
        utility,
        externalId: `${op.id}:upcoming:${item.id}`,
        kind: 'planned',
        state,
        affectedCustomers: null,
        areaCustomerTotal: null,
        reportedAt: null,
        plannedStart: time.start,
        plannedEnd: time.end,
        actualStart: state === 'upcoming' ? null : time.start,
        estimatedRestore: null,
        restoredAt: state === 'restored' ? time.end : null,
        precision: 'address_list',
        geometry: null,
        addresses,
        postalCodes: [],
        municipalityCode: '1480',
        placeLabel: item.area?.trim() || null,
        operatorText: item.information?.replace(/\s+/g, ' ').trim() || null,
        cause: null,
        sourceUrl: op.mapUrl,
        upstream: { type: t.type },
      });
    }
  }
  return { outages, skipped, ignored, sourceUpdatedAt: null };
}
