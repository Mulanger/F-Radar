import { z } from 'zod';
import { httpRequest } from '../http';
import type { AdapterContext, AdapterResult } from '../types';
import { parseConcessionKml, parseDigproKml } from './platforms/digpro';
import { parseVattenfall } from './platforms/vattenfall';
import { goteborgKmlUrl } from './platforms/goteborg-url';
import type { ConcessionArea, OutageFetchResult, UtilityOperator } from './types';

export * from './types';
export * from './time';
export * from './geometry';
export * from './operators';
export { parseVattenfall, plannedEndFromText, VATTENFALL_ONGOING_FAULT, VATTENFALL_ONGOING_PLANNED, VATTENFALL_UPCOMING_PLANNED } from './platforms/vattenfall';
export { parseDigproKml, parseConcessionKml, digproPlacemarkToOutage } from './platforms/digpro';
export { goteborgKmlUrl } from './platforms/goteborg-url';

/**
 * Grid operators' public outage maps (docs/plans/stromavbrott.md). The feeds are the JSON/KML the
 * operators' own map pages load; they are undocumented, so every payload is validated and anything
 * unexpected is skipped (never guessed). Polled at most every 5 min per operator.
 */
export const UTILITY_OUTAGE_USER_AGENT = 'FastighetsRadar-avbrottsbevakning/1.0';
export const UTILITY_OUTAGE_ATTRIBUTION = 'Källa: respektive nätbolags avbrottskarta';
const TIMEOUT_MS = 30_000;
const MAX_BYTES = 8_000_000;

async function fetchText(url: string, ctx: AdapterContext, label: string, init?: { method?: 'GET' | 'POST'; body?: string; accept?: string }): Promise<AdapterResult<string>> {
  const r = await httpRequest(url, ctx, {
    label,
    method: init?.method ?? 'GET',
    body: init?.body,
    timeoutMs: TIMEOUT_MS,
    attempts: 2,
    headers: {
      'User-Agent': UTILITY_OUTAGE_USER_AGENT,
      Accept: init?.accept ?? '*/*',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!r.ok) return r;
  const text = await r.data.text();
  if (text.length > MAX_BYTES) return { ok: false, error: 'invalid_payload', detail: `${label}: response too large` };
  return { ok: true, data: text, fetchedAt: r.fetchedAt };
}

const GbgCurrent = z
  .object({
    status: z.literal('Ok'),
    result: z.object({ types: z.array(z.object({ id: z.string(), name: z.string(), kml: z.string() }).passthrough()) }).passthrough(),
  })
  .passthrough();

/** Fetches and normalises one operator's current outages. */
export async function fetchOperatorOutages(op: UtilityOperator, ctx: AdapterContext): Promise<AdapterResult<OutageFetchResult>> {
  const now = ctx.now();
  if (op.platform === 'vattenfall') {
    const r = await fetchText(op.dataUrl, ctx, `${op.id} incidents`, { accept: 'application/json' });
    if (!r.ok) return r;
    let raw: unknown;
    try {
      raw = JSON.parse(r.data);
    } catch {
      return { ok: false, error: 'invalid_payload', detail: `${op.id}: not JSON` };
    }
    const parsed = parseVattenfall(raw, op, now);
    return parsed ? { ok: true, data: parsed, fetchedAt: r.fetchedAt } : { ok: false, error: 'invalid_payload', detail: `${op.id}: unexpected shape` };
  }
  if (op.platform === 'digpro') {
    const url = `https://${op.host}/bios/servlet/sys.outagemap.servlets.api.GetOutagesKML?app=fpp_${op.cust}`;
    const r = await fetchText(url, ctx, `${op.id} kml`, { accept: 'application/vnd.google-earth.kml+xml, application/xml, */*' });
    if (!r.ok) return r;
    const parsed = parseDigproKml(r.data, { operatorId: op.id, utility: 'electricity', mapUrl: op.mapUrl, now });
    return parsed ? { ok: true, data: parsed, fetchedAt: r.fetchedAt } : { ok: false, error: 'invalid_payload', detail: `${op.id}: not KML` };
  }
  // Göteborg Energi: Digpro KML behind the company's own API. The JSON lists a KML URL per utility;
  // ongoing/published outages come with active=1, recently restored ones with active=0.
  const typeId = op.utilityTypeIds.electricity;
  if (!typeId) return { ok: false, error: 'not_implemented', detail: `${op.id}: no electricity type` };
  const cur = await fetchText(`${op.apiBase}/external-web/api/outages-map-element/current-outages`, ctx, `${op.id} current`, { method: 'POST', body: '{}', accept: 'application/json' });
  if (!cur.ok) return cur;
  let curJson: unknown;
  try {
    curJson = JSON.parse(cur.data);
  } catch {
    return { ok: false, error: 'invalid_payload', detail: `${op.id}: current-outages not JSON` };
  }
  const c = GbgCurrent.safeParse(curJson);
  if (!c.success) return { ok: false, error: 'invalid_payload', detail: `${op.id}: current-outages unexpected shape` };
  const listed = c.data.result.types.find((t) => t.id === typeId);
  if (!listed) return { ok: false, error: 'invalid_payload', detail: `${op.id}: electricity type missing` };
  const activeUrl = goteborgKmlUrl(op.apiBase, listed.kml, typeId, 1);
  if (!activeUrl) return { ok: false, error: 'invalid_payload', detail: `${op.id}: unexpected KML URL` };
  const [active, inactive] = [await fetchText(activeUrl, ctx, `${op.id} kml active`), await fetchText(goteborgKmlUrl(op.apiBase, null, typeId, 0)!, ctx, `${op.id} kml inactive`)];
  if (!active.ok) return active;
  if (!inactive.ok) return inactive;
  const opts = { operatorId: op.id, utility: 'electricity' as const, mapUrl: op.mapUrl, now };
  const a = parseDigproKml(active.data, opts);
  const b = parseDigproKml(inactive.data, opts);
  if (!a || !b) return { ok: false, error: 'invalid_payload', detail: `${op.id}: not KML` };
  const merged = parseMerge(a, b);
  return { ok: true, data: merged, fetchedAt: active.fetchedAt };
}

/** Active feed wins unless the inactive feed says the same outage was restored. */
function parseMerge(active: OutageFetchResult, inactive: OutageFetchResult): OutageFetchResult {
  const byId = new Map(active.outages.map((o) => [o.externalId, o]));
  for (const o of inactive.outages) {
    const prev = byId.get(o.externalId);
    if (!prev || o.state === 'restored') byId.set(o.externalId, o);
  }
  return { outages: [...byId.values()], skipped: active.skipped + inactive.skipped, ignored: active.ignored + inactive.ignored, sourceUpdatedAt: null };
}

/** Concession areas published by the operator itself (Digpro concession.kml). */
export async function fetchOperatorConcessions(op: UtilityOperator, ctx: AdapterContext): Promise<AdapterResult<ConcessionArea[]>> {
  if (op.platform !== 'digpro' || !op.concessionUrl) return { ok: false, error: 'not_implemented', detail: `${op.id}: no published concession areas` };
  const r = await fetchText(op.concessionUrl, ctx, `${op.id} concession`);
  if (!r.ok) return r;
  const areas = parseConcessionKml(r.data);
  if (!areas || !areas.length) return { ok: false, error: 'invalid_payload', detail: `${op.id}: concession KML without polygons` };
  return { ok: true, data: areas, fetchedAt: r.fetchedAt };
}
