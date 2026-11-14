import { z } from 'zod';
import { httpJson, iso } from '../http';
import type { AdapterContext, AdapterResult, NormalizedSourceEvent } from '../types';

const Sites = z.array(z.object({ id: z.number(), name: z.string(), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), stop_areas: z.array(z.number()) }));
const Message = z.object({
  deviation_case_id: z.number(), created: z.string(), modified: z.string(),
  publish: z.object({ from: z.string(), upto: z.string().nullish() }),
  message_variants: z.array(z.object({ header: z.string(), details: z.string().optional(), language: z.string(), weblink: z.string().optional() })),
  scope: z.object({ stop_areas: z.array(z.object({ id: z.number() })).default([]), lines: z.array(z.object({ transport_mode: z.string() })).default([]) }),
});

export function parseSlDeviations(raw: unknown, sitesRaw: unknown): { events: NormalizedSourceEvent[]; unlocated: number; invalid: number } | null {
  const messages = z.array(z.unknown()).safeParse(raw), sites = Sites.safeParse(sitesRaw);
  if (!messages.success || !sites.success) return null;
  const events: NormalizedSourceEvent[] = [];
  let unlocated = 0, invalid = 0;
  for (const value of messages.data) {
    const r = Message.safeParse(value);
    if (!r.success) { invalid++; continue; }
    const m = r.data, text = m.message_variants.find((v) => v.language === 'sv');
    if (!text || !m.scope.lines.some((l) => ['SHIP', 'FERRY'].includes(l.transport_mode))) continue;
    const matched = sites.data.filter((s) => s.stop_areas.some((id) => m.scope.stop_areas.some((a) => a.id === id)));
    if (!matched.length) { unlocated++; continue; }
    for (const s of matched) events.push({
      sourceId: 'sl_deviations', externalId: `${m.deviation_case_id}:${s.id}`, dataClass: 'PUBLIC_EVENT', category: 'Traffic',
      level: null, severity: 'info', eventType: 'Båttrafik', headline: text.header, description: text.details ?? null,
      areaLabel: s.name, countyNames: [], geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      publishedAt: iso(m.created), sourceUpdatedAt: iso(m.modified), validFrom: iso(m.publish.from), validTo: iso(m.publish.upto),
      status: 'active', sourceUrl: text.weblink ?? 'https://sl.se', attribution: 'Källa: SL via Trafiklab',
      extra: { siteId: s.id, note: 'Avstånd till berörd hållplats, inte till en båt eller byggnadspåverkan.' },
    });
  }
  return { events, unlocated, invalid };
}

export async function fetchSlDeviations(ctx: AdapterContext): Promise<AdapterResult<{ events: NormalizedSourceEvent[]; unlocated: number; invalid: number }>> {
  // The current official API is keyless. Keep the explicit local opt-in gate requested by the owner;
  // never send this local value to SL or reuse the Trafikverket key.
  if (!ctx.env.SL_DEVIATIONS_API_KEY) return { ok: false, error: 'access_required', detail: 'SL_DEVIATIONS_API_KEY saknas (lokal aktiveringsspärr)' };
  if (!ctx.env.SOURCE_SL_DEVIATIONS_ENABLED) return { ok: false, error: 'disabled' };
  const messages = await httpJson('https://deviations.integration.sl.se/v1/messages?transport_mode=SHIP&transport_mode=FERRY', ctx, { label: 'sl_messages' });
  if (!messages.ok) return messages;
  const sites = await httpJson('https://transport.integration.sl.se/v1/sites?expand=true', ctx, { label: 'sl_sites' });
  if (!sites.ok) return sites;
  const data = parseSlDeviations(messages.data, sites.data);
  return data ? { ok: true, data, fetchedAt: messages.fetchedAt } : { ok: false, error: 'invalid_payload' };
}
