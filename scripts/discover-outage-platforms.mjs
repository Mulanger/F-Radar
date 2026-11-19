#!/usr/bin/env node
/**
 * Finds grid operators whose public outage pages use a platform we already support
 * (docs/plans/stromavbrott.md, Fas 3). Read-only and polite: sequential requests,
 * plus at most 3 follow-up links per operator that look like outage pages.
 *
 *   node scripts/discover-outage-platforms.mjs > outage-platforms.json
 *   node scripts/discover-outage-platforms.mjs --catalog docs/sources/utility-outage-candidates.json
 *
 * Source list: Elsamverkan's operator directory (name, homepage, "Störningssida").
 * Signatures:
 *   digpro        …/outagemap2/?cust=<code>
 *   trimble       …/geoserver-api/… or …/NisOutageMap/…
 *   servicealert  sms-service.dk / servicealert.se iFrame/driftstatus…customerId(s)=<uuid>
 * The output lists candidates only. Verify each endpoint before adding it to
 * packages/integrations/src/utility-outages/operators.ts.
 */
import { readFileSync } from 'node:fs';
const DIRECTORY = 'https://elsamverkan.se/umbraco/surface/OrganizationList/GetOrganizationList';
const UA = 'FastighetsRadar-avbrottsbevakning/1.0';

const decode = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&').trim();
const fixUrl = (u) => {
  let v = (u || '').trim().replace(/^https?:\/\/(https?:\/\/)/i, '$1');
  if (!v || v === '-' || /^https?:\/\/-$/.test(v)) return null;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    return new URL(v).toString();
  } catch {
    return null;
  }
};

async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') ?? '';
    if (!/html|text|json|javascript/.test(type)) return null;
    return { url: r.url, text: (await r.text()).slice(0, 2_000_000) };
  } catch {
    return null;
  }
}

export function detect(html, base) {
  const out = [];
  for (const m of html.matchAll(/https?:\/\/([a-z0-9.-]+)(?::\d+)?\/outagemap2\/?\?[^"'\s<>]*?cust=([a-z0-9]+)/gi))
    out.push({ platform: 'digpro', host: m[1].toLowerCase(), cust: m[2].toLowerCase() });
  for (const m of html.matchAll(/https?:\/\/([a-z0-9.-]+)((?:\/[A-Za-z0-9_-]+)*?)\/(?:geoserver-api|NisOutageMap)\b/g))
    out.push({ platform: 'trimble', base: `https://${m[1].toLowerCase()}${m[2] ?? ''}` });
  for (const m of html.matchAll(/(https?:\/\/(?:se\.sms-service\.dk|servicealert\.se))\/iFrame\/driftstatus[^"'\s<>]*?customerIds?=([0-9a-f-]{36}(?:,[0-9a-f-]{36})*)/gi))
    out.push({ platform: 'servicealert', apiBase: `${m[1]}/api`, customerIds: m[2].toLowerCase() });
  if (/geoserver-api\/GetApplicationData|NisOutageMap/i.test(html) && !out.some((o) => o.platform === 'trimble') && base)
    out.push({ platform: 'trimble', base: new URL(base).origin });
  return out;
}

async function main() {
  const catalogIndex = process.argv.indexOf('--catalog');
  const catalog = catalogIndex >= 0 ? JSON.parse(readFileSync(process.argv[catalogIndex + 1], 'utf8')) : null;
  if (catalog && (!Array.isArray(catalog) || catalog.some((c) => !c.name || !fixUrl(c.page)))) throw new Error('invalid catalog');
  const dir = catalog ? null : await get(DIRECTORY);
  if (!catalog && !dir) throw new Error('directory unavailable; use --catalog with verified public pages');
  const companies = catalog ?? dir.text
    .split('class="company-item"')
    .slice(1)
    .map((b) => ({
      name: decode((/ca-title[^>]*>([^<]*)</.exec(b) || [])[1] || ''),
      home: fixUrl((/webpage[\s\S]*?href="([^"]*)"/.exec(b) || [])[1]),
      page: fixUrl(decode((/disturbance-page[\s\S]*?href="([^"]*)"/.exec(b) || [])[1] || '')),
    }))
    .filter((c) => c.page || c.home);
  const results = [];
  const queue = [...companies];
  await Promise.all(
    Array.from({ length: 1 }, async () => {
      while (queue.length) {
        const c = queue.shift();
        const found = [];
        const first = await get(c.page ?? c.home);
        if (first) {
          found.push(...detect(first.text, first.url));
          if (!found.length) {
            const links = [...first.text.matchAll(/href="([^"#]+)"/g)]
              .map((m) => {
                try {
                  return new URL(m[1], first.url).toString();
                } catch {
                  return null;
                }
              })
              .filter((u) => u && /avbrott|driftst|driftinfo|stromavbrott|strömavbrott|outage|karta/i.test(u) && new URL(u).host === new URL(first.url).host);
            for (const u of [...new Set(links)].slice(0, 3)) {
              const p = await get(u);
              if (p) found.push(...detect(p.text, p.url));
              if (found.length) break;
            }
          }
        }
        const unique = [...new Map(found.map((f) => [JSON.stringify(f), f])).values()];
        results.push({ name: c.name, utility: c.utility ?? 'electricity', customers: c.customers ?? null, page: c.page ?? c.home, reachable: !!first, platforms: unique });
      }
    }),
  );
  results.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  const summary = results.reduce((acc, r) => {
    for (const p of r.platforms) acc[p.platform] = (acc[p.platform] ?? 0) + 1;
    return acc;
  }, {});
  process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), summary, results }, null, 2) + '\n');
}

if (process.argv[1]?.endsWith('discover-outage-platforms.mjs')) main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
