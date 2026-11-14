import { z } from 'zod';
import type { OutageKind, OutageState } from '@fastighetsradar/domain';
import { ringFromFlatLatLon } from '../geometry';
import { parseSwedishLocal, stockholmLocalToIso, stockholmParts } from '../time';
import type { NormalizedUtilityOutage, OutageFetchResult, UtilityOperator } from '../types';

/**
 * Vattenfall Eldistribution – https://arkmap.vattenfalleldistribution.se/incidents.json
 * (whole country in one response). Status codes are taken from the map's own code (verified
 * 2026-11-14 in assets/index-*.js): 1–4 = ongoing fault, 6 = ongoing planned, 7 = upcoming planned.
 * Any other code → kind 'unknown' (shown, never sent as SMS) and logged.
 *
 * `polygon` is a flat [lat, lon, lat, lon, …] array – swapped into GeoJSON lon/lat.
 */
export const VATTENFALL_ONGOING_FAULT = [1, 2, 3, 4];
export const VATTENFALL_ONGOING_PLANNED = [6];
export const VATTENFALL_UPCOMING_PLANNED = [7];

const Warning = z
  .object({
    id: z.string().min(1),
    status: z.number().int(),
    placenames: z.string().nullish(),
    affectedAreas: z.array(z.object({ affected: z.number().nullish(), areacode: z.union([z.number(), z.string()]).nullish(), muni: z.union([z.number(), z.string()]).nullish() }).passthrough()).nullish(),
    description: z.string().nullish(),
    affectedCustomers: z.number().nullish(),
    polygon: z.array(z.number()).nullish(),
    freeText: z.string().nullish(),
    startTime: z.string().nullish(),
    completionTime: z.string().nullish(),
  })
  .passthrough();
const Payload = z.object({ warnings: z.object({ lastUpdate: z.string().nullish(), warning: z.array(z.unknown()) }).passthrough() }).passthrough();

const pad = (v: number | string | null | undefined, n: number) => (v === null || v === undefined || v === '' ? null : String(v).padStart(n, '0'));

/**
 * Planned work has no completionTime; the customer text says "… mellan 09:00 och 14:00". The end
 * time is taken from that text only when its first clock equals the published start time.
 */
export function plannedEndFromText(text: string | null | undefined, startIso: string | null): string | null {
  if (!text || !startIso) return null;
  const m = /mellan\s+(\d{1,2})[:.](\d{2})\s+och\s+(\d{1,2})[:.](\d{2})/i.exec(text);
  if (!m) return null;
  const s = stockholmParts(startIso);
  if (+m[1]! !== s.hour || +m[2]! !== s.minute) return null;
  const [y, mo, d] = s.date.split('-').map(Number);
  const end = stockholmLocalToIso(y!, mo!, d!, +m[3]!, +m[4]!);
  return end && Date.parse(end) > Date.parse(startIso) ? end : null;
}

export function parseVattenfall(raw: unknown, op: UtilityOperator, now: Date): OutageFetchResult | null {
  const p = Payload.safeParse(raw);
  if (!p.success) return null;
  const outages: NormalizedUtilityOutage[] = [];
  let skipped = 0;
  const unknownCodes = new Set<number>();
  for (const r of p.data.warnings.warning) {
    const w = Warning.safeParse(r);
    if (!w.success) {
      skipped++;
      continue;
    }
    const x = w.data;
    const ring = ringFromFlatLatLon(x.polygon);
    if (!ring) {
      skipped++;
      continue;
    }
    const start = parseSwedishLocal(x.startTime);
    const completion = parseSwedishLocal(x.completionTime);
    let kind: OutageKind;
    let state: OutageState;
    if (VATTENFALL_ONGOING_FAULT.includes(x.status)) [kind, state] = ['unplanned', 'ongoing'];
    else if (VATTENFALL_ONGOING_PLANNED.includes(x.status)) [kind, state] = ['planned', 'ongoing'];
    else if (VATTENFALL_UPCOMING_PLANNED.includes(x.status)) [kind, state] = ['planned', start && Date.parse(start) <= now.getTime() ? 'ongoing' : 'upcoming'];
    else {
      unknownCodes.add(x.status);
      kind = 'unknown';
      state = start && Date.parse(start) <= now.getTime() ? 'ongoing' : 'unknown';
    }
    const planned = kind === 'planned';
    const plannedEnd = planned ? (completion ?? plannedEndFromText(x.freeText, start)) : null;
    const munis = [...new Set((x.affectedAreas ?? []).map((a) => pad(a.muni, 4)).filter((v): v is string => !!v))];
    outages.push({
      operatorId: op.id,
      utility: 'electricity',
      externalId: `${op.id}:${x.id}`,
      kind,
      state,
      affectedCustomers: x.affectedCustomers && x.affectedCustomers > 0 ? Math.round(x.affectedCustomers) : null,
      areaCustomerTotal: null,
      reportedAt: null,
      plannedStart: planned ? start : null,
      plannedEnd,
      actualStart: planned ? (state === 'ongoing' ? start : null) : start,
      estimatedRestore: planned ? null : completion,
      restoredAt: null,
      precision: 'polygon',
      geometry: { type: 'Polygon', coordinates: [ring] },
      addresses: null,
      postalCodes: [...new Set((x.affectedAreas ?? []).map((a) => pad(a.areacode, 5)).filter((v): v is string => !!v && /^\d{5}$/.test(v)))],
      municipalityCode: munis.length === 1 ? munis[0]! : null,
      placeLabel: x.placenames?.trim() || null,
      operatorText: x.freeText?.trim() || null,
      cause: null,
      sourceUrl: op.mapUrl,
      upstream: { status: x.status, description: x.description ?? null },
    });
  }
  return {
    outages,
    skipped,
    ignored: 0,
    sourceUpdatedAt: parseSwedishLocal(p.data.warnings.lastUpdate),
    ...(unknownCodes.size ? { unknownStatusCodes: [...unknownCodes].map(String) } : {}),
  };
}
