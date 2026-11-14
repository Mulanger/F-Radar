import { z } from 'zod';
import { httpRequest } from '../http';
import type { AdapterContext, AdapterResult } from '../types';
import { parseConcessionKml, parseDigproKml } from './platforms/digpro';
import { parseVattenfall } from './platforms/vattenfall';
import { goteborgKmlUrl } from './platforms/goteborg-url';
import { EllevioPostalShapes, EllevioTickets, ellevioPostalAreas, parseEllevio } from './platforms/ellevio';
import { parseTekniskaVerken, TvList } from './platforms/tekniskaverken';
import { parseTrimble, trimbleDistricts, trimbleStations, trimbleTileRanges, type TrimbleDistrict } from './platforms/trimble';
import { EI_LOCAL_CONCESSIONS_URL, parseEiConcessionZip, type EiConcessionArea } from './ei-concessions';
import type { ConcessionArea, OutageFetchResult, UtilityOperator } from './types';

export * from './types';
export * from './time';
export * from './geometry';
export * from './operators';
export { parseVattenfall, plannedEndFromText, VATTENFALL_ONGOING_FAULT, VATTENFALL_ONGOING_PLANNED, VATTENFALL_UPCOMING_PLANNED } from './platforms/vattenfall';
export { parseDigproKml, parseConcessionKml, digproPlacemarkToOutage } from './platforms/digpro';
export { goteborgKmlUrl } from './platforms/goteborg-url';
export { parseEllevio, ellevioShapeToRings, ellevioPostalAreas } from './platforms/ellevio';
export { parseTekniskaVerken, polygonsFromGeoJson } from './platforms/tekniskaverken';
export { parseTrimble, trimbleDistricts, trimbleStations, trimbleTileRanges, pointInRing, type TrimbleDistrict } from './platforms/trimble';
export * from './ei-concessions';

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

const json = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Postal-area shapes rarely change: cached per process (id → shape). */
const ellevioShapes = new Map<number, unknown>();
/** Trimble districts change rarely: cached per operator for 24 h. */
const trimbleDistrictCache = new Map<string, { at: number; districts: TrimbleDistrict[] }>();

async function fetchEllevio(op: Extract<UtilityOperator, { platform: 'ellevio' }>, ctx: AdapterContext): Promise<AdapterResult<OutageFetchResult>> {
  const url = (params: string) => `${op.loadUrl}?v=${encodeURIComponent(op.version)}&${params}`;
  const today = await fetchText(url('t=today'), ctx, `${op.id} today`, { accept: 'application/json' });
  if (!today.ok) return today;
  const forecast = await fetchText(url('t=forecast'), ctx, `${op.id} forecast`, { accept: 'application/json' });
  if (!forecast.ok) return forecast;
  const [t, f] = [json(today.data), json(forecast.data)];
  const areas = ellevioPostalAreas(t, f);
  if (!areas) return { ok: false, error: 'invalid_payload', detail: `${op.id}: unexpected list shape` };
  const tickets: unknown[] = [];
  for (const ids of chunks([...areas.keys()], 40)) {
    const r = await fetchText(url(`t=ticket&ticketIDList=${ids.join(',')}`), ctx, `${op.id} tickets`, { accept: 'application/json' });
    if (!r.ok) return r;
    const p = EllevioTickets.safeParse(json(r.data));
    if (!p.success) return { ok: false, error: 'invalid_payload', detail: `${op.id}: unexpected ticket shape` };
    tickets.push(...p.data.ticketList);
  }
  const missing = [...new Set([...areas.values()].flatMap((s) => [...s]))].filter((pc) => !ellevioShapes.has(pc));
  for (const pcs of chunks(missing, 40)) {
    const r = await fetchText(url(`t=postalCodes&codes=${pcs.join(',')}`), ctx, `${op.id} postal areas`, { accept: 'application/json' });
    if (!r.ok) return r;
    const p = EllevioPostalShapes.safeParse(json(r.data));
    if (!p.success) return { ok: false, error: 'invalid_payload', detail: `${op.id}: unexpected postal shape` };
    for (const [k, v] of Object.entries(p.data.postal_code_shapes)) ellevioShapes.set(Number(k), v);
  }
  const parsed = parseEllevio({ today: t, forecast: f, tickets, shapes: ellevioShapes }, op, ctx.now());
  return parsed ? { ok: true, data: parsed, fetchedAt: today.fetchedAt } : { ok: false, error: 'invalid_payload', detail: `${op.id}: unexpected shape` };
}

async function fetchTekniskaVerken(op: Extract<UtilityOperator, { platform: 'tekniskaverken' }>, ctx: AdapterContext): Promise<AdapterResult<OutageFetchResult>> {
  const list = await fetchText(`${op.apiBase}/outage/list/?utility=electricity&brand=${encodeURIComponent(op.brand)}`, ctx, `${op.id} list`, { accept: 'application/json' });
  if (!list.ok) return list;
  const l = TvList.safeParse(json(list.data));
  if (!l.success) return { ok: false, error: 'invalid_payload', detail: `${op.id}: unexpected list shape` };
  const ids = l.data.outages.map((o) => (o as { outageId?: unknown }).outageId).filter((x): x is string => typeof x === 'string');
  let shapes: unknown = { outages: [] };
  if (ids.length) {
    const s = await fetchText(`${op.apiBase}/outage/shapes/`, ctx, `${op.id} shapes`, { method: 'POST', body: JSON.stringify({ ids }), accept: 'application/json' });
    if (!s.ok) return s;
    shapes = json(s.data);
  }
  const parsed = parseTekniskaVerken(json(list.data), shapes, op, ctx.now());
  return parsed ? { ok: true, data: parsed, fetchedAt: list.fetchedAt } : { ok: false, error: 'invalid_payload', detail: `${op.id}: unexpected shape` };
}

async function fetchTrimble(op: Extract<UtilityOperator, { platform: 'trimble' }>, ctx: AdapterContext): Promise<AdapterResult<OutageFetchResult>> {
  const api = `${op.base}/geoserver-api`;
  const app = await fetchText(`${api}/GetApplicationData`, ctx, `${op.id} application data`, { accept: 'application/json' });
  if (!app.ok) return app;
  const appData = json(app.data);
  if (appData === undefined) return { ok: false, error: 'invalid_payload', detail: `${op.id}: application data not JSON` };
  let cached = trimbleDistrictCache.get(op.id);
  if (!cached || ctx.now().getTime() - cached.at > 24 * 3_600_000) {
    const st = await fetchText(`${api}/content/StaticObjects`, ctx, `${op.id} districts`, { accept: 'application/json' });
    if (!st.ok) return st;
    const districts = trimbleDistricts(json(st.data), op.scope);
    if (!districts || !districts.length) return { ok: false, error: 'invalid_payload', detail: `${op.id}: no districts` };
    cached = { at: ctx.now().getTime(), districts };
    trimbleDistrictCache.set(op.id, cached);
  }
  // Station points are only needed when there are outages.
  const decoded = typeof appData === 'string' ? json(appData) : appData;
  const scopeOutages = (decoded as { scopes?: Record<string, { outages?: unknown }> } | undefined)?.scopes?.[op.scope]?.outages;
  const outagesListed = Array.isArray(scopeOutages) && scopeOutages.length > 0;
  const tiles: unknown[] = [];
  if (outagesListed) {
    for (const rows of chunks(trimbleTileRanges(cached.districts), 25)) {
      const r = await fetchText(`${api}/GetObjectsByTiles?zoom=10&tiles=${rows.join(',')}`, ctx, `${op.id} tiles`, { accept: 'application/json' });
      if (!r.ok) return r;
      tiles.push(json(r.data));
    }
  }
  const parsed = parseTrimble(appData, cached.districts, trimbleStations(tiles), op, ctx.now());
  return parsed ? { ok: true, data: parsed, fetchedAt: app.fetchedAt } : { ok: false, error: 'invalid_payload', detail: `${op.id}: scope ${op.scope} missing` };
}

/** National concession areas (Energimarknadsinspektionen ZIP, ~2 MB, weekly). */
export async function fetchEiConcessions(ctx: AdapterContext, url = EI_LOCAL_CONCESSIONS_URL): Promise<AdapterResult<EiConcessionArea[]>> {
  const r = await httpRequest(url, ctx, { label: 'ei concessions', timeoutMs: 120_000, attempts: 2, headers: { 'User-Agent': UTILITY_OUTAGE_USER_AGENT, Accept: 'application/zip' } });
  if (!r.ok) return r;
  const buf = Buffer.from(await r.data.arrayBuffer());
  if (buf.length > 50_000_000) return { ok: false, error: 'invalid_payload', detail: 'ei concessions: too large' };
  try {
    const areas = parseEiConcessionZip(buf);
    if (areas.length < 50) return { ok: false, error: 'invalid_payload', detail: `ei concessions: only ${areas.length} areas` };
    return { ok: true, data: areas, fetchedAt: r.fetchedAt };
  } catch (e) {
    return { ok: false, error: 'invalid_payload', detail: `ei concessions: ${e instanceof Error ? e.message : 'parse error'}` };
  }
}

/** Fetches and normalises one operator's current outages. */
export async function fetchOperatorOutages(op: UtilityOperator, ctx: AdapterContext): Promise<AdapterResult<OutageFetchResult>> {
  const now = ctx.now();
  if (op.platform === 'ellevio') return fetchEllevio(op, ctx);
  if (op.platform === 'tekniskaverken') return fetchTekniskaVerken(op, ctx);
  if (op.platform === 'trimble') return fetchTrimble(op, ctx);
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
