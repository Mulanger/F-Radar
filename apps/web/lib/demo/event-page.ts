import type { EventPage, Portfolio } from '@fastighetsradar/domain';

/**
 * The event page of a demo event, built from the demo feed like `/v1/events/:id` is built live
 * (docs/plans/skalning.md, Fas 2 / S-09): every property whose feed has a row of the event, the
 * official text once (from a matching warning when the demo has one). Null for an unknown event.
 */
export function demoEventPage(portfolio: Portfolio, eventId: string): EventPage | null {
  const rows = portfolio.feed.filter((f) => f.eventId === eventId);
  const first = rows[0];
  if (!first) return null;
  const byId = new Map(portfolio.properties.map((s) => [s.property.id, s]));
  const warning = rows
    .flatMap((r) => byId.get(r.propertyId)?.warnings ?? [])
    .find((w) => w.sourceId === first.sourceId && first.title.toLocaleLowerCase('sv').includes(w.type.toLocaleLowerCase('sv')));
  const seen = new Set<string>();
  const properties: EventPage['properties'] = [];
  for (const r of rows) {
    const s = byId.get(r.propertyId);
    if (!s || seen.has(r.propertyId)) continue;
    seen.add(r.propertyId);
    properties.push({
      propertyId: s.property.id,
      name: s.property.name,
      address: s.property.address,
      location: s.property.location,
      changeId: r.id,
      changeType: null,
      matched: true,
      ackRequired: r.ackRequired === true,
      acknowledgedAt: r.acknowledgedAt ?? null,
    });
  }
  properties.sort((a, b) => a.name.localeCompare(b.name, 'sv') || a.propertyId.localeCompare(b.propertyId));
  return {
    generatedAt: portfolio.generatedAt,
    event: {
      id: eventId,
      sourceId: first.sourceId,
      sourceLabel: first.sourceLabel,
      title: first.title,
      level: warning?.level ?? null,
      severity: first.severity,
      description: warning?.summary ?? null,
      areaLabel: warning?.region ?? null,
      publishedAt: first.publishedAt,
      validFrom: warning?.validFrom ?? null,
      validTo: warning?.validTo ?? null,
      active: true,
      sourceUrl: warning?.sourceUrl ?? null,
      origin: 'demo_fixture',
    },
    properties,
  };
}
