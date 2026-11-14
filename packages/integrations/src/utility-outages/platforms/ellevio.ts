import { z } from 'zod';
import type { OutageKind, OutageState } from '@fastighetsradar/domain';
import { closeRing, polygonsToGeoJson, type LonLat } from '../geometry';
import { parseSwedishLocal } from '../time';
import type { NormalizedUtilityOutage, OutageFetchResult, UtilityOperator } from '../types';

/**
 * Ellevio – https://avbrottskarta.ellevio.se/avbrottskartan/load.php?v=<version>&t=<type>
 * (verified 2026-11-14):
 *  - t=today    → interrupts.list[{id, p, u, pc, mid, cid, ie}]: one row per (ticket, postal area);
 *                 `ie` = ended, `u`/`p` = affected sites in that postal area, `pc` = internal postal-area id
 *  - t=forecast → forecast_interrupts.list[{id, c, pc, mid, cid}]: planned work per postal area
 *  - t=ticket&ticketIDList=a,b → ticketList[] with type 'interrupt' | 'planned_work', times "YYYY-MM-DD HH.MM",
 *                 affected_site_count (now), affected_site_total_count (over the outage's life – NOT a
 *                 postal-area total), affected_site_forecast_count (planned), customer texts
 *  - t=postalCodes&codes=a,b → postal_code_shapes{id: {coord: Polygon in [lat, lon] order}}
 * Ellevio publishes no outage geometry: precision is the postal area – dashboard only, never SMS.
 */
const Row = z.object({ id: z.number().int(), pc: z.number().int(), ie: z.boolean().optional() }).passthrough();
export const EllevioToday = z.object({ interrupts: z.object({ list: z.array(z.unknown()) }).passthrough() }).passthrough();
export const EllevioForecast = z.object({ forecast_interrupts: z.object({ list: z.array(z.unknown()) }).passthrough() }).passthrough();
const Ticket = z
  .object({
    id: z.number().int(),
    is_hidden: z.union([z.number(), z.boolean()]).nullish(),
    is_ended: z.union([z.number(), z.boolean()]).nullish(),
    type: z.string(),
    status: z.string().nullish(),
    planned_start_time: z.string().nullish(),
    planned_end_time: z.string().nullish(),
    outage_start_time: z.string().nullish(),
    outage_end_time: z.string().nullish(),
    electricity_back: z.string().nullish(),
    customer_information: z.string().nullish(),
    customer_information_short: z.string().nullish(),
    customer_information_forecast: z.string().nullish(),
    affected_site_count: z.number().nullish(),
    affected_site_total_count: z.number().nullish(),
    affected_site_forecast_count: z.number().nullish(),
    counties_and_municipalities_string: z.string().nullish(),
  })
  .passthrough();
export const EllevioTickets = z.object({ ticketList: z.array(z.unknown()) }).passthrough();
export const EllevioPostalShapes = z.object({ postal_code_shapes: z.record(z.string(), z.unknown()) }).passthrough();

/** Postal-area polygon from Ellevio ([lat, lon] pairs) → GeoJSON rings in lon/lat, or null. */
export function ellevioShapeToRings(shape: unknown): LonLat[][][] | null {
  const s = shape as { coord?: { type?: string; coordinates?: unknown } } | null;
  const g = s?.coord;
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return null;
  const polys = (g.type === 'Polygon' ? [g.coordinates] : (g.coordinates as unknown[])) as unknown[];
  const out: LonLat[][][] = [];
  for (const poly of polys) {
    if (!Array.isArray(poly)) return null;
    const rings: LonLat[][] = [];
    for (const ring of poly) {
      if (!Array.isArray(ring)) return null;
      const swapped = ring.map((p) => (Array.isArray(p) && p.length >= 2 ? ([Number(p[1]), Number(p[0])] as LonLat) : ([NaN, NaN] as LonLat)));
      const closed = closeRing(swapped);
      if (!closed) return null;
      rings.push(closed);
    }
    if (rings.length) out.push(rings);
  }
  return out.length ? out : null;
}

const truthy = (v: number | boolean | null | undefined) => v === true || v === 1;
const positive = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? Math.round(n) : null);
const text = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export interface EllevioPayload {
  today: unknown;
  forecast: unknown;
  tickets: unknown[];
  /** postal-area id → shape (as returned by t=postalCodes). */
  shapes: Map<number, unknown>;
}

/** Postal-area ids per ticket id from today + forecast lists (null when a list has the wrong shape). */
export function ellevioPostalAreas(today: unknown, forecast: unknown): Map<number, Set<number>> | null {
  const t = EllevioToday.safeParse(today);
  const f = EllevioForecast.safeParse(forecast);
  if (!t.success || !f.success) return null;
  const byTicket = new Map<number, Set<number>>();
  for (const raw of [...t.data.interrupts.list, ...f.data.forecast_interrupts.list]) {
    const r = Row.safeParse(raw);
    if (!r.success) continue;
    if (!byTicket.has(r.data.id)) byTicket.set(r.data.id, new Set());
    byTicket.get(r.data.id)!.add(r.data.pc);
  }
  return byTicket;
}

export function parseEllevio(p: EllevioPayload, op: UtilityOperator, now: Date): OutageFetchResult | null {
  const areas = ellevioPostalAreas(p.today, p.forecast);
  if (!areas) return null;
  const outages: NormalizedUtilityOutage[] = [];
  let skipped = 0;
  let ignored = 0;
  const seen = new Set<number>();
  for (const raw of p.tickets) {
    const r = Ticket.safeParse(raw);
    if (!r.success) {
      skipped++;
      continue;
    }
    const t = r.data;
    seen.add(t.id);
    if (truthy(t.is_hidden)) {
      ignored++;
      continue;
    }
    const pcs = [...(areas.get(t.id) ?? [])];
    const polys = pcs.flatMap((pc) => ellevioShapeToRings(p.shapes.get(pc)) ?? []);
    const geometry = polygonsToGeoJson(polys);
    if (!geometry) {
      skipped++;
      continue;
    }
    const ended = truthy(t.is_ended);
    const planned = t.type === 'planned_work';
    const kind: OutageKind = planned ? 'planned' : t.type === 'interrupt' ? 'unplanned' : 'unknown';
    const plannedStart = parseSwedishLocal(t.planned_start_time);
    const plannedEnd = parseSwedishLocal(t.planned_end_time);
    const outageStart = parseSwedishLocal(t.outage_start_time);
    const back = parseSwedishLocal(t.electricity_back) ?? parseSwedishLocal(t.outage_end_time);
    let state: OutageState;
    if (ended) state = 'restored';
    else if (planned) state = plannedStart && Date.parse(plannedStart) > now.getTime() && !outageStart ? 'upcoming' : 'ongoing';
    else state = 'ongoing';
    const affected =
      state === 'restored'
        ? positive(t.affected_site_total_count)
        : state === 'upcoming'
          ? positive(t.affected_site_forecast_count)
          : (positive(t.affected_site_count) ?? (planned ? positive(t.affected_site_forecast_count) : null));
    outages.push({
      operatorId: op.id,
      utility: 'electricity',
      externalId: `${op.id}:${t.id}`,
      kind,
      state,
      affectedCustomers: affected,
      areaCustomerTotal: null,
      reportedAt: null,
      plannedStart: planned ? plannedStart : null,
      plannedEnd: planned ? plannedEnd : null,
      actualStart: state === 'upcoming' ? null : (outageStart ?? (planned ? plannedStart : null)),
      estimatedRestore: planned ? null : plannedEnd,
      restoredAt: state === 'restored' ? back : null,
      precision: 'postal_area',
      geometry,
      addresses: null,
      postalCodes: [],
      municipalityCode: null,
      placeLabel: text(t.counties_and_municipalities_string),
      operatorText: planned ? (text(t.customer_information_forecast) ?? text(t.customer_information)) : text(t.customer_information),
      cause: planned ? null : text(t.customer_information_short),
      sourceUrl: op.mapUrl,
      upstream: { type: t.type, status: t.status ?? null, postalAreas: pcs.length },
    });
  }
  // A ticket listed by today/forecast but missing from the ticket details is a data gap.
  for (const id of areas.keys()) if (!seen.has(id)) skipped++;
  return { outages, skipped, ignored, sourceUpdatedAt: null };
}
