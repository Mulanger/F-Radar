import { z } from 'zod';
import { httpRequest } from '../http';
import type { AdapterContext, AdapterResult } from '../types';
import { parseConcessionKml, parseDigproKml } from './platforms/digpro';
import { parseVattenfall } from './platforms/vattenfall';
import { goteborgKmlUrl } from './platforms/goteborg-url';
import { EllevioPostalShapes, EllevioTickets, ellevioPostalAreas, parseEllevio } from './platforms/ellevio';
import { parseTekniskaVerken, tekniskaVerkenShapeIds, TvList } from './platforms/tekniskaverken';
import { parseTrimble, trimbleDistricts, trimbleStations, trimbleTileRanges, type TrimbleDistrict } from './platforms/trimble';
import { EI_LOCAL_CONCESSIONS_URL, parseEiConcessionZip, type EiConcessionArea } from './ei-concessions';
import { decodeEonOutstat, parseEon, parseEonDetailText } from './platforms/eon';
import { parseServiceAlert } from './platforms/servicealert';
import { GOTEBORG_ADDRESS_AREA, parseGoteborgUpcoming } from './platforms/goteborg';
import { hasFewSkippedOutages, type ConcessionArea, type OutageFetchResult, type UtilityOperator } from './types';
import { withOperatorTransport } from './transport';
import { parseUmea, parseSkekraft } from './platforms/published-json';
import { operatorWithEnabledUtilities } from './operators';
import { parseSvoa, SvoaPage } from './platforms/svoa';
import { parseNsva } from './platforms/nsva';
export { parseSvoa, waterNoticeHeading } from './platforms/svoa';
export { parseNsva } from './platforms/nsva';

export * from './types';
export * from './time';
export * from './geometry';
export * from './operators';
export * from './transport';
export { parseUmea, parseSkekraft, publishedLocalTime } from './platforms/published-json';
export { parseVattenfall, plannedEndFromText, VATTENFALL_ONGOING_FAULT, VATTENFALL_ONGOING_PLANNED, VATTENFALL_UPCOMING_PLANNED } from './platforms/vattenfall';
export { parseDigproKml, parseConcessionKml, digproPlacemarkToOutage } from './platforms/digpro';
export { goteborgKmlUrl } from './platforms/goteborg-url';
export { parseEllevio, ellevioShapeToRings, ellevioPostalAreas } from './platforms/ellevio';
export { parseTekniskaVerken, polygonsFromGeoJson } from './platforms/tekniskaverken';
export { parseTrimble, trimbleDistricts, trimbleStations, trimbleTileRanges, pointInRing, type TrimbleDistrict } from './platforms/trimble';
export * from './ei-concessions';
export { decodeEonOutstat, parseEon, parseEonDetailText, type EonRecord } from './platforms/eon';
export { parseServiceAlert, serviceAlertAreas, serviceAlertProfile, htmlToText } from './platforms/servicealert';
export { parseGoteborgUpcoming, parseGoteborgTime, GOTEBORG_ADDRESS_AREA } from './platforms/goteborg';

/**
 * Grid operators' public outage maps (docs/plans/stromavbrott.md). The feeds are the JSON/KML the
 * operators' own map pages load; they are undocumented, so every payload is validated and anything
 * unexpected is skipped (never guessed). Polled at most every 5 min per operator.
 */
export const UTILITY_OUTAGE_USER_AGENT = 'FastighetsRadar-avbrottsbevakning/1.0';
export const UTILITY_OUTAGE_ATTRIBUTION = 'Källa: respektive nätbolags avbrottskarta';
const TIMEOUT_MS = 30_000;
const MAX_BYTES = 8_000_000;
const conditionalBodies = new WeakMap<typeof fetch, Map<string, { etag: string; text: string }>>();

async function fetchText(url: string, ctx: AdapterContext, label: string, init?: { method?: 'GET' | 'POST'; body?: string; accept?: string }): Promise<AdapterResult<string>> {
  let bodies = conditionalBodies.get(ctx.fetch);
  if (!bodies) { bodies = new Map(); conditionalBodies.set(ctx.fetch, bodies); }
  const canCache = !init?.method || init.method === 'GET';
  const cached = canCache ? bodies.get(url) : undefined;
  const r = await httpRequest(url, ctx, {
    acceptNotModified: true,
    label,
    method: init?.method ?? 'GET',
    body: init?.body,
    timeoutMs: TIMEOUT_MS,
    attempts: 2,
    headers: {
      'User-Agent': UTILITY_OUTAGE_USER_AGENT,
      Accept: init?.accept ?? '*/*',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cached ? { 'If-None-Match': cached.etag } : {}),
    },
  });
  if (!r.ok) return r;
  if (r.data.status === 304) return cached ? { ok: true, data: cached.text, fetchedAt: r.fetchedAt } : { ok: false, error: 'invalid_payload', detail: `${label}: 304 without a cached body` };
  const text = await r.data.text();
  if (text.length > MAX_BYTES) return { ok: false, error: 'invalid_payload', detail: `${label}: response too large` };
  const etag = r.data.headers.get('etag');
  if (canCache && etag) {
    bodies.delete(url); bodies.set(url, { etag, text });
    while (bodies.size > 32 || [...bodies.values()].reduce((n, e) => n + e.text.length, 0) > 32_000_000) bodies.delete(bodies.keys().next().value!);
  } else bodies.delete(url);
  return { ok: true, data: text, fetchedAt: r.fetchedAt };
}

const TrimbleTile = z.object({ points: z.array(z.unknown()) }).passthrough();

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

async function fetchSvoa(op: Extract<UtilityOperator, { platform: 'svoa' }>, ctx: AdapterContext): Promise<AdapterResult<OutageFetchResult>> {
  const rows: unknown[] = [];
  let firstPage: string | null = null;
  let total: number | null = null;
  let fetchedAt = ctx.now().toISOString();
  do {
    const url = `${op.dataUrl}?skip=${rows.length}&query=&useCurrentLocation=false&latitude=undefined&longitude=undefined`;
    const r = await fetchText(url, ctx, `${op.id} page`, { accept: 'application/json' });
    if (!r.ok) return r;
    fetchedAt = r.fetchedAt;
    if (firstPage === null) firstPage = r.data;
    const p = SvoaPage.safeParse(json(r.data));
    if (!p.success || p.data.totalCount > 2000 || total !== null && total !== p.data.totalCount || !p.data.disturbances.length && rows.length < p.data.totalCount) {
      return { ok: false, error: 'invalid_payload', detail: `${op.id}: inconsistent pagination` };
    }
    total = p.data.totalCount;
    rows.push(...p.data.disturbances);
  } while (rows.length < total);
  const ids = rows.map((r) => (r as { pageId?: unknown })?.pageId);
  if (rows.length !== total || new Set(ids).size !== rows.length || ids.some((id) => typeof id !== 'string')) return { ok: false, error: 'invalid_payload', detail: `${op.id}: incomplete or repeated pages` };
  if (rows.length > 10) {
    const recheck = await fetchText(`${op.dataUrl}?skip=0&query=&useCurrentLocation=false&latitude=undefined&longitude=undefined`, ctx, `${op.id} pagination recheck`, { accept: 'application/json' });
    if (!recheck.ok) return recheck;
    if (recheck.data !== firstPage) return { ok: false, error: 'invalid_payload', detail: `${op.id}: pages changed during fetch` };
  }
  return { ok: true, data: parseSvoa(rows, op), fetchedAt };
}

/** Postal-area shapes rarely change: cached per process (id → shape). */
const ellevioShapes = new Map<number, unknown>();
/** Trimble districts change rarely: cached per operator for 24 h. */
const trimbleDistrictCache = new Map<string, { at: number; districts: TrimbleDistrict[] }>();
const trimbleStaticCache = new Map<string, { at: number; data: unknown }>();

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
  const kinds = op.utilities.map((u) => ({ electricity: 'electricity', district_heating: 'districtheating', district_cooling: 'districtcooling', gas: 'gas', water: 'water' })[u]).join(',');
  const list = await fetchText(`${op.apiBase}/outage/list/?utility=${kinds}&brand=${encodeURIComponent(op.brand)}`, ctx, `${op.id} list`, { accept: 'application/json' });
  if (!list.ok) return list;
  const l = TvList.safeParse(json(list.data));
  if (!l.success) return { ok: false, error: 'invalid_payload', detail: `${op.id}: unexpected list shape` };
  const ids = tekniskaVerkenShapeIds(l.data.outages, op);
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
  if (op.utilityScopes) {
    const decoded = typeof appData === 'string' ? json(appData) : appData;
    const scopes = (decoded as { scopes?: Record<string, { areas?: Array<{ id?: unknown }>; outages?: unknown }> } | undefined)?.scopes;
    const selected = op.utilities.map((utility) => ({ utility, scope: op.utilityScopes![utility] }));
    if (!scopes || selected.some((s) => !s.scope || !Array.isArray(scopes[s.scope]?.areas) || !Array.isArray(scopes[s.scope]?.outages))) return { ok: false, error: 'invalid_payload', detail: `${op.id}: missing utility scope` };
    let st = trimbleStaticCache.get(op.id);
    if (!st || ctx.now().getTime() - st.at > 24 * 3600000) {
      const r = await fetchText(`${api}/content/StaticObjects`, ctx, `${op.id} shared districts`);
      if (!r.ok) return r;
      st = { at: ctx.now().getTime(), data: json(r.data) }; trimbleStaticCache.set(op.id, st);
    }
    const layers = selected.map(({ utility, scope }) => ({ utility, scope: scope!, districts: trimbleDistricts(st!.data, scope!, new Set(scopes[scope!]!.areas!.map((a) => a.id).filter((id): id is number => typeof id === 'number'))) }));
    if (layers.some((l) => !l.districts?.length)) return { ok: false, error: 'invalid_payload', detail: `${op.id}: no published districts` };
    const ranges = [...new Set(layers.filter((l) => (scopes[l.scope]!.outages as unknown[]).length).flatMap((l) => trimbleTileRanges(l.districts!)))];
    const tiles: unknown[] = [];
    for (const rows of chunks(ranges, 25)) {
      const r = await fetchText(`${api}/GetObjectsByTiles?zoom=10&tiles=${rows.join(',')}`, ctx, `${op.id} shared tiles`);
      if (!r.ok) return r;
      const tile = TrimbleTile.safeParse(json(r.data));
      if (!tile.success) return { ok: false, error: 'invalid_payload', detail: `${op.id}: unexpected tile payload` };
      tiles.push(tile.data);
    }
    const parts = layers.map((l) => parseTrimble(appData, l.districts!, trimbleStations(tiles, l.scope), { ...op, scope: l.scope, utilities: [l.utility] }, ctx.now()));
    if (parts.some((p) => !p)) return { ok: false, error: 'invalid_payload', detail: `${op.id}: invalid utility layer` };
    return { ok: true, data: combine(parts as OutageFetchResult[]), fetchedAt: app.fetchedAt };
  }
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
      const tile = TrimbleTile.safeParse(json(r.data));
      if (!tile.success) return { ok: false, error: 'invalid_payload', detail: `${op.id}: unexpected tile payload` };
      tiles.push(tile.data);
    }
  }
  const parsed = parseTrimble(appData, cached.districts, trimbleStations(tiles, op.scope), op, ctx.now());
  return parsed ? { ok: true, data: parsed, fetchedAt: app.fetchedAt } : { ok: false, error: 'invalid_payload', detail: `${op.id}: scope ${op.scope} missing` };
}

/** E.ON area geometry files rarely change: cached per process for 24 h. */
const eonAreaCache = new Map<string, { at: number; geom: unknown }>();
const EON_MAX_DETAILS = 600;

async function fetchEon(op: Extract<UtilityOperator, { platform: 'eon' }>, ctx: AdapterContext): Promise<AdapterResult<OutageFetchResult>> {
  const conf = async (name: string) => {
    const r = await fetchText(`${op.base}/conf/${name}.json`, ctx, `${op.id} ${name}`, { accept: 'application/json' });
    if (!r.ok) return r;
    const j = json(r.data) as Record<string, unknown> | undefined;
    return j ? ({ ok: true as const, data: j }) : ({ ok: false as const, error: 'invalid_payload' as const, detail: `${op.id}: ${name} not JSON` });
  };
  const h01 = await conf('h01_config');
  if (!h01.ok) return h01;
  const h02 = await conf('h02_config');
  if (!h02.ok) return h02;
  const res = await conf('res');
  if (!res.ok) return res;
  const [p1, p2, g] = [h01.data.path, h02.data.path, res.data.g];
  const safe = (s: unknown) => typeof s === 'string' && /^[A-Za-z0-9_]+$/.test(s);
  if (!safe(p1) || !safe(p2) || !safe(g)) return { ok: false, error: 'invalid_payload', detail: `${op.id}: unexpected config paths` };
  const bin = await httpRequest(`${op.base}/${p1}/outstat.bin`, ctx, { label: `${op.id} outstat`, timeoutMs: TIMEOUT_MS, attempts: 2, headers: { 'User-Agent': UTILITY_OUTAGE_USER_AGENT, Accept: 'application/octet-stream' } });
  if (!bin.ok) return bin;
  const records = decodeEonOutstat(Buffer.from(await bin.data.arrayBuffer()));
  if (!records) return { ok: false, error: 'invalid_payload', detail: `${op.id}: outstat.bin has an unexpected size` };
  const ids = [...new Set(records.map((r) => r.outageId))];
  if (ids.length > EON_MAX_DETAILS) return { ok: false, error: 'invalid_payload', detail: `${op.id}: ${ids.length} outages exceed the per-run limit` };
  const details = new Map<number, unknown>();
  let missingDetails = false;
  for (const id of ids) {
    const r = await fetchText(`${op.base}/${p2}/${id}.json`, ctx, `${op.id} detail`, { accept: 'application/json' });
    const detail = r.ok ? parseEonDetailText(r.data) : undefined;
    if (detail !== undefined) details.set(id, detail);
    else missingDetails = true;
  }
  const areas = new Map<string, unknown>();
  for (const path of [...new Set(records.map((r) => r.areaPath))]) {
    if (!/^01\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{2}$/.test(path)) continue;
    const cached = eonAreaCache.get(`${g}/${path}`);
    if (cached && ctx.now().getTime() - cached.at < 24 * 3_600_000) {
      areas.set(path, cached.geom);
      continue;
    }
    const r = await fetchText(`${op.base}/static_geom/${g}/${path}.json`, ctx, `${op.id} area geometry`, { accept: 'application/json' });
    if (!r.ok) return r;
    const geom = json(r.data);
    eonAreaCache.set(`${g}/${path}`, { at: ctx.now().getTime(), geom });
    areas.set(path, geom);
  }
  const data = parseEon(records, details, areas, op, ctx.now());
  return { ok: true, data: missingDetails ? { ...data, incomplete: true } : data, fetchedAt: bin.fetchedAt };
}

async function fetchServiceAlert(op: Extract<UtilityOperator, { platform: 'servicealert' }>, ctx: AdapterContext): Promise<AdapterResult<OutageFetchResult>> {
  const r = await fetchText(`${op.apiBase}/WebMessage/GetDriftstatusWebMessagesMapModel`, ctx, `${op.id} messages`, {
    method: 'POST',
    body: JSON.stringify({ customerIds: op.customerIds }),
    accept: 'application/json',
  });
  if (!r.ok) return r;
  const parsed = parseServiceAlert(json(r.data), op, op.utilities, ctx.now());
  return parsed ? { ok: true, data: parsed, fetchedAt: r.fetchedAt } : { ok: false, error: 'invalid_payload', detail: `${op.id}: unexpected shape` };
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
  op = operatorWithEnabledUtilities(op, ctx.env);
  if (!op.utilities.length) return { ok: false, error: 'disabled', detail: `${op.id}: no enabled utility` };
  ctx = withOperatorTransport(op, ctx);
  const now = ctx.now();
  if (op.platform === 'umea' || op.platform === 'skekraft') {
    const r = await fetchText(op.dataUrl, ctx, `${op.id} outages`, { accept: 'application/json' });
    if (!r.ok) return r;
    const parsed = op.platform === 'umea' ? parseUmea(json(r.data), op, now) : parseSkekraft(json(r.data), op);
    return parsed ? { ok: true, data: parsed, fetchedAt: r.fetchedAt } : { ok: false, error: 'invalid_payload', detail: `${op.id}: unexpected published outage payload` };
  }
  if (op.platform === 'svoa') return fetchSvoa(op, ctx);
  if (op.platform === 'nsva') {
    const r = await fetchText(op.mapUrl, ctx, `${op.id} map`, { accept: 'text/html' });
    if (!r.ok) return r;
    const parsed = parseNsva(r.data, op);
    return parsed ? { ok: true, data: parsed, fetchedAt: r.fetchedAt } : { ok: false, error: 'invalid_payload', detail: `${op.id}: missing or invalid map data` };
  }
  if (op.platform === 'ellevio') return fetchEllevio(op, ctx);
  if (op.platform === 'tekniskaverken') return fetchTekniskaVerken(op, ctx);
  if (op.platform === 'trimble') return fetchTrimble(op, ctx);
  if (op.platform === 'eon') return fetchEon(op, ctx);
  if (op.platform === 'servicealert') return fetchServiceAlert(op, ctx);
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
    // One KML per map layer: 'fpp' = power, 'fpdh' = district heating (Fas 4).
    const layers = [
      ...(op.utilities.includes('electricity') ? [{ app: 'fpp', utility: 'electricity' as const, prefix: op.id }] : []),
      ...(op.utilities.includes('district_heating') ? [{ app: 'fpdh', utility: 'district_heating' as const, prefix: `${op.id}:dh` }] : []),
    ];
    const parts: OutageFetchResult[] = [];
    let fetchedAt = now.toISOString();
    for (const l of layers) {
      const url = op.outageUrls?.[l.utility] ?? `https://${op.host}/bios/servlet/sys.outagemap.servlets.api.GetOutagesKML?app=${l.app}_${op.cust}`;
      const r = await fetchText(url, ctx, `${op.id} kml ${l.app}`, { accept: 'application/vnd.google-earth.kml+xml, application/xml, */*' });
      if (!r.ok) return r;
      const parsed = parseDigproKml(r.data, { operatorId: op.id, utility: l.utility, mapUrl: op.mapUrl, now, externalPrefix: l.prefix });
      if (!parsed) return { ok: false, error: 'invalid_payload', detail: `${op.id}: ${l.app} not KML` };
      parts.push(parsed);
      fetchedAt = r.fetchedAt;
    }
    return { ok: true, data: combine(parts), fetchedAt };
  }
  // Göteborg Energi: Digpro KML behind the company's own API. The JSON lists a KML URL per utility;
  // ongoing/published outages come with active=1, recently restored ones with active=0. Planned
  // heating/cooling work is also listed by street address (upcoming-outages, Fas 4).
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
  const parts: OutageFetchResult[] = [];
  for (const utility of op.utilities) {
    const typeId = op.utilityTypeIds[utility];
    if (!typeId) continue;
    const listed = c.data.result.types.find((t) => t.id === typeId);
    if (!listed) return { ok: false, error: 'invalid_payload', detail: `${op.id}: ${utility} type missing` };
    const activeUrl = goteborgKmlUrl(op.apiBase, listed.kml, typeId, 1);
    if (!activeUrl) return { ok: false, error: 'invalid_payload', detail: `${op.id}: unexpected KML URL` };
    const [active, inactive] = [await fetchText(activeUrl, ctx, `${op.id} kml active`), await fetchText(goteborgKmlUrl(op.apiBase, null, typeId, 0)!, ctx, `${op.id} kml inactive`)];
    if (!active.ok) return active;
    if (!inactive.ok) return inactive;
    const opts = { operatorId: op.id, utility, mapUrl: op.mapUrl, now, externalPrefix: utility === 'electricity' ? op.id : `${op.id}:${utility}` };
    const a = parseDigproKml(active.data, opts);
    const b = parseDigproKml(inactive.data, opts);
    if (!a || !b) return { ok: false, error: 'invalid_payload', detail: `${op.id}: not KML` };
    parts.push(parseMerge(a, b));
  }
  if (op.utilities.some((u) => u !== 'electricity')) {
    const up = await fetchText(`${op.apiBase}/external-web/api/outages-map-element/upcoming-outages`, ctx, `${op.id} upcoming`, { method: 'POST', body: '{}', accept: 'application/json' });
    if (!up.ok) return up;
    const parsed = parseGoteborgUpcoming(json(up.data), op, op.utilities.filter((u) => u !== 'electricity'), now);
    if (!parsed) return { ok: false, error: 'invalid_payload', detail: `${op.id}: upcoming-outages unexpected shape` };
    parts.push({ ...parsed, outages: parsed.outages.map((o) => ({ ...o, addressArea: GOTEBORG_ADDRESS_AREA })) });
  }
  return { ok: true, data: combine(parts), fetchedAt: cur.fetchedAt };
}

function combine(parts: OutageFetchResult[]): OutageFetchResult {
  const codes = parts.flatMap((p) => p.unknownStatusCodes ?? []);
  // Records read but ignored (another type, a watering ban) prove the feed parses: count them as read.
  const incomplete = parts.some((p) => p.incomplete || p.skipped > 0 && !hasFewSkippedOutages(p.outages.length + p.ignored, p.skipped));
  return {
    outages: parts.flatMap((p) => p.outages),
    skipped: parts.reduce((a, p) => a + p.skipped, 0),
    ignored: parts.reduce((a, p) => a + p.ignored, 0),
    sourceUpdatedAt: parts.find((p) => p.sourceUpdatedAt)?.sourceUpdatedAt ?? null,
    ...(incomplete ? { incomplete: true } : {}),
    ...(codes.length ? { unknownStatusCodes: [...new Set(codes)] } : {}),
  };
}

/** Active feed wins unless the inactive feed says the same outage was restored. */
function parseMerge(active: OutageFetchResult, inactive: OutageFetchResult): OutageFetchResult {
  const byId = new Map(active.outages.map((o) => [o.externalId, o]));
  for (const o of inactive.outages) {
    const prev = byId.get(o.externalId);
    if (!prev || o.state === 'restored') byId.set(o.externalId, o);
  }
  return { ...combine([active, inactive]), outages: [...byId.values()] };
}

/** Concession areas published by the operator itself (Digpro concession.kml). */
export async function fetchOperatorConcessions(op: UtilityOperator, ctx: AdapterContext): Promise<AdapterResult<ConcessionArea[]>> {
  ctx = withOperatorTransport(op, ctx);
  if (op.platform !== 'digpro' || !op.concessionUrl) return { ok: false, error: 'not_implemented', detail: `${op.id}: no published concession areas` };
  const r = await fetchText(op.concessionUrl, ctx, `${op.id} concession`);
  if (!r.ok) return r;
  const areas = parseConcessionKml(r.data);
  if (!areas || !areas.length) return { ok: false, error: 'invalid_payload', detail: `${op.id}: concession KML without polygons` };
  return { ok: true, data: areas, fetchedAt: r.fetchedAt };
}
