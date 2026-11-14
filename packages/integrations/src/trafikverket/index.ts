import { z } from 'zod';
import type { Severity } from '@fastighetsradar/domain';
import { httpJson, iso } from '../http';
import type { AdapterContext, AdapterResult, NormalizedSourceEvent } from '../types';

/**
 * Trafikverket open API v2 (verified live 2026-11-13).
 *
 * POST {TRAFIKVERKET_API_URL} with an XML query: objecttype "Situation", namespace
 * "road.trafficinfo", schemaversion 1.6. We query only around customer properties
 * (WITHIN radius on Deviation.Geometry.Point.WGS84, several points OR-ed per request), so
 * the payload stays small. Deviation geometry is WKT (WGS84 Point and/or LineString).
 *
 * Requires TRAFIKVERKET_ENABLED=true and TRAFIKVERKET_API_KEY. The key is never logged.
 * Licence: CC0 (attribution appreciated).
 */
export const TRAFIKVERKET_ATTRIBUTION = 'Källa: Trafikverket (CC0)';
export const TRAFIKVERKET_API_URL = 'https://api.trafikinfo.trafikverket.se/v2/data.json';
export const TRAFIKVERKET_RADIUS_M = 2_000;
export const TRAFIKVERKET_POINTS_PER_REQUEST = 20;

const xmlAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildTrafikverketQuery(key: string, points: Array<{ lat: number; lon: number }>, radiusM = TRAFIKVERKET_RADIUS_M): string {
  const within = points
    .map((p) => `<WITHIN name="Deviation.Geometry.Point.WGS84" shape="center" value="${p.lon.toFixed(5)} ${p.lat.toFixed(5)}" radius="${Math.round(radiusM)}m"/>`)
    .join('');
  return (
    `<REQUEST><LOGIN authenticationkey="${xmlAttr(key)}"/>` +
    `<QUERY objecttype="Situation" namespace="road.trafficinfo" schemaversion="1.6" limit="500">` +
    `<FILTER>${points.length > 1 ? `<OR>${within}</OR>` : within}</FILTER>` +
    `</QUERY></REQUEST>`
  );
}

const Deviation = z
  .object({
    Id: z.string(),
    Message: z.string().nullish(),
    Header: z.string().nullish(),
    MessageType: z.string().nullish(),
    MessageTypeValue: z.string().nullish(),
    MessageCode: z.string().nullish(),
    MessageCodeValue: z.string().nullish(),
    SeverityCode: z.number().nullish(),
    SeverityText: z.string().nullish(),
    LocationDescriptor: z.string().nullish(),
    RoadName: z.string().nullish(),
    RoadNumber: z.string().nullish(),
    StartTime: z.string().nullish(),
    EndTime: z.string().nullish(),
    ValidUntilFurtherNotice: z.boolean().nullish(),
    Suspended: z.boolean().nullish(),
    CountyNo: z.array(z.number()).nullish(),
    IconId: z.string().nullish(),
    WebLink: z.string().nullish(),
    VersionTime: z.string().nullish(),
    Geometry: z
      .object({
        Point: z.object({ WGS84: z.string().nullish() }).passthrough().nullish(),
        Line: z.object({ WGS84: z.string().nullish() }).passthrough().nullish(),
        WGS84: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();
const Situation = z
  .object({ Id: z.string(), Deleted: z.boolean().nullish(), PublicationTime: z.string().nullish(), ModifiedTime: z.string().nullish(), Deviation: z.array(z.unknown()).default([]) })
  .passthrough();
const ResponseSchema = z.object({
  RESPONSE: z.object({
    RESULT: z.array(z.object({ Situation: z.array(z.unknown()).optional(), ERROR: z.object({ MESSAGE: z.string().optional() }).passthrough().optional() }).passthrough()),
  }),
});

/** SeverityCode 1–5 (ingen … mycket stor påverkan). Traffic never raises 'critical'. */
export function trafikverketSeverity(code: number | null | undefined): Severity {
  if (code === null || code === undefined) return 'unknown';
  if (code >= 5) return 'warning';
  if (code >= 3) return 'monitor';
  return 'info';
}

const WKT_OK = /^(POINT|LINESTRING|MULTILINESTRING|MULTIPOINT)\s*\(/i;

export function parseTrafikverket(raw: unknown): { events: NormalizedSourceEvent[]; skipped: number; deletedIds: string[] } | { error: string } {
  const r = ResponseSchema.safeParse(raw);
  if (!r.success) return { error: 'schema mismatch' };
  const res = r.data.RESPONSE.RESULT[0];
  if (res?.ERROR) return { error: res.ERROR.MESSAGE ?? 'API error' };
  const events: NormalizedSourceEvent[] = [];
  const deletedIds: string[] = [];
  let skipped = 0;
  for (const s of res?.Situation ?? []) {
    const sp = Situation.safeParse(s);
    if (!sp.success) {
      skipped++;
      continue;
    }
    for (const d of sp.data.Deviation) {
      const dp = Deviation.safeParse(d);
      if (!dp.success) {
        skipped++;
        continue;
      }
      const x = dp.data;
      if (sp.data.Deleted) {
        deletedIds.push(x.Id);
        continue;
      }
      const ferry = x.MessageTypeValue === 'TransitInformation' || x.MessageCodeValue === 'ferry';
      // The feed also contains ordinary ferry services. A timetable is not a disruption.
      if (ferry && (!x.Message?.trim() || x.IconId === 'ferryDepartureOnSchedule')) continue;
      const wkt = x.Geometry?.Line?.WGS84 ?? x.Geometry?.Point?.WGS84 ?? x.Geometry?.WGS84 ?? null;
      if (!wkt || !WKT_OK.test(wkt)) {
        skipped++;
        continue;
      }
      const type = ferry ? x.Header ?? x.MessageCode ?? 'Färjeinformation' : x.MessageCode ?? x.MessageType ?? 'Trafikhändelse';
      const where = x.LocationDescriptor ?? x.RoadName ?? x.RoadNumber ?? null;
      events.push({
        sourceId: 'trafikverket',
        externalId: x.Id,
        dataClass: 'PUBLIC_EVENT',
        category: 'Traffic',
        level: null,
        severity: trafikverketSeverity(x.SeverityCode),
        eventType: type,
        headline: where ? `${type}: ${where}` : type,
        description: x.Message ?? null,
        areaLabel: x.RoadName ?? x.RoadNumber ?? null,
        countyNames: [],
        geometry: null,
        geometryWkt: wkt,
        publishedAt: iso(sp.data.PublicationTime),
        sourceUpdatedAt: iso(x.VersionTime ?? sp.data.ModifiedTime),
        validFrom: iso(x.StartTime),
        validTo: x.ValidUntilFurtherNotice ? null : iso(x.EndTime),
        status: 'active',
        sourceUrl: x.WebLink ?? 'https://www.trafikverket.se/trafikinformation/',
        attribution: TRAFIKVERKET_ATTRIBUTION,
        extra: {
          situationId: sp.data.Id,
          messageCodeValue: x.MessageCodeValue ?? null,
          severityCode: x.SeverityCode ?? null,
          severityText: x.SeverityText ?? null,
          suspended: x.Suspended ?? false,
          iconId: x.IconId ?? null,
          transportMode: ferry ? 'road_ferry' : 'road',
        },
      });
    }
  }
  return { events, skipped, deletedIds };
}

export function trafikverketReady(ctx: AdapterContext): boolean {
  return Boolean(ctx.env.TRAFIKVERKET_ENABLED && ctx.env.TRAFIKVERKET_API_KEY);
}

export async function fetchTrafikverketNear(
  points: Array<{ lat: number; lon: number }>,
  ctx: AdapterContext,
): Promise<AdapterResult<{ events: NormalizedSourceEvent[]; skipped: number; deletedIds: string[] }>> {
  if (!trafikverketReady(ctx)) return { ok: false, error: 'access_required', detail: 'TRAFIKVERKET_API_KEY missing or source disabled' };
  if (!points.length) return { ok: true, data: { events: [], skipped: 0, deletedIds: [] }, fetchedAt: ctx.now().toISOString() };
  const r = await httpJson(TRAFIKVERKET_API_URL, ctx, {
    label: 'trafikverket',
    method: 'POST',
    body: buildTrafikverketQuery(ctx.env.TRAFIKVERKET_API_KEY!, points),
    headers: { 'Content-Type': 'text/xml' },
    timeoutMs: 20_000,
  });
  if (!r.ok) return r;
  const parsed = parseTrafikverket(r.data);
  if ('error' in parsed) return { ok: false, error: 'invalid_payload', detail: `trafikverket: ${parsed.error}` };
  return { ok: true, data: parsed, fetchedAt: r.fetchedAt };
}
