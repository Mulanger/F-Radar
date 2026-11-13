import { z } from 'zod';
import { httpJson, iso } from '../http';
import type { AdapterContext, AdapterResult, NormalizedSourceEvent } from '../types';

/**
 * Krisinformation.se API v3 (verified live 2026-11-13).
 *
 *  - /v3/news?format=json&allcounties=true – current crisis news (newspage). Area = list of
 *    { type: 'County' | 'Municipality' | 'Country', description: 'Västerbottens län' }; coordinates are usually null.
 *  - /v3/vmas?format=json – active VMA (Viktigt meddelande till allmänheten). Usually empty.
 *  - /v3/features – evergreen preparedness articles, NOT events (deliberately not collected).
 *
 * Classification:
 *  - VMA → OFFICIAL_WARNING, level 'VMA', severity 'critical'.
 *  - News → PUBLIC_EVENT, severity 'info' (regional information, not a local incident).
 * Matching is by county / municipality name only (no distance is shown).
 */
export const KRISINFORMATION_ATTRIBUTION = 'Källa: Krisinformation.se';

const Area = z.object({ type: z.string().nullish(), description: z.string().nullish(), coordinate: z.unknown().nullish() }).passthrough();
const Item = z
  .object({
    identifier: z.union([z.string(), z.number()]),
    headline: z.string(),
    preamble: z.string().nullish(),
    bodyText: z.string().nullish(),
    published: z.string().nullish(),
    updated: z.string().nullish(),
    area: z.array(Area).nullish(),
    event: z.string().nullish(),
    senderName: z.string().nullish(),
    web: z.string().nullish(),
    language: z.string().nullish(),
  })
  .passthrough();

function areas(item: z.infer<typeof Item>) {
  const counties: string[] = [];
  const municipalities: string[] = [];
  let national = false;
  for (const a of item.area ?? []) {
    const t = (a.type ?? '').toLowerCase();
    const d = a.description?.trim();
    if (!d) continue;
    if (t === 'county') counties.push(d);
    else if (t === 'municipality') municipalities.push(d);
    else if (t === 'country' || /^sverige$/i.test(d)) national = true;
  }
  return { counties: national ? ['*', ...counties] : counties, municipalities };
}

export function parseKrisinformation(raw: unknown, kind: 'news' | 'vma'): { events: NormalizedSourceEvent[]; skipped: number } | null {
  const list = z.array(z.unknown()).safeParse(raw);
  if (!list.success) return null;
  const events: NormalizedSourceEvent[] = [];
  let skipped = 0;
  for (const r of list.data) {
    const p = Item.safeParse(r);
    if (!p.success) {
      skipped++;
      continue;
    }
    const it = p.data;
    const { counties, municipalities } = areas(it);
    if (!counties.length && !municipalities.length) {
      // No geographic scope → cannot be matched to a property; never shown as local.
      skipped++;
      continue;
    }
    const vma = kind === 'vma';
    events.push({
      sourceId: 'krisinformation',
      externalId: `${kind}:${it.identifier}`,
      dataClass: vma ? 'OFFICIAL_WARNING' : 'PUBLIC_EVENT',
      category: 'Crisis',
      level: vma ? 'VMA' : 'Info',
      severity: vma ? 'critical' : 'info',
      eventType: vma ? 'VMA' : (it.event ?? 'News'),
      headline: it.headline,
      description: it.preamble ?? null,
      areaLabel: [...counties.filter((c) => c !== '*'), ...municipalities].join(', ') || 'Hela Sverige',
      countyNames: counties,
      geometry: null,
      publishedAt: iso(it.published),
      sourceUpdatedAt: iso(it.updated ?? it.published),
      validFrom: iso(it.published),
      validTo: null,
      status: 'active',
      sourceUrl: it.web ?? 'https://www.krisinformation.se/',
      attribution: KRISINFORMATION_ATTRIBUTION,
      extra: { municipalities, sender: it.senderName ?? null, language: it.language ?? null },
    });
  }
  return { events, skipped };
}

export async function fetchKrisinformation(ctx: AdapterContext): Promise<AdapterResult<{ events: NormalizedSourceEvent[]; skipped: number }>> {
  const base = ctx.env.KRISINFORMATION_BASE_URL.replace(/\/+$/, '');
  const news = await httpJson(`${base}/news?format=json&allcounties=true`, ctx, { label: 'krisinformation_news', timeoutMs: 20_000 });
  if (!news.ok) return news;
  const vmas = await httpJson(`${base}/vmas?format=json`, ctx, { label: 'krisinformation_vmas', timeoutMs: 20_000 });
  if (!vmas.ok) return vmas;
  const a = parseKrisinformation(news.data, 'news');
  const b = parseKrisinformation(vmas.data, 'vma');
  if (!a || !b) return { ok: false, error: 'invalid_payload', detail: 'krisinformation: expected arrays' };
  return { ok: true, data: { events: [...b.events, ...a.events], skipped: a.skipped + b.skipped }, fetchedAt: news.fetchedAt };
}
