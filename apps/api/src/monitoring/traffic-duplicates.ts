/**
 * Trafikverket reports one road closure several times: one situation per direction of travel, and
 * within each situation one message per aspect ("Vägarbete" – the cause, "Vägen avstängd" – the
 * effect). Bergiusvägen at Frescati (2026-11) came as four rows for one ~95 m stretch. These helpers
 * fold such duplicates into one, so the property's list, its count and the feed show it once.
 *
 * Two traffic events are the same when they belong to the same situation, or when they are the
 * same kind of message on the same road valid over the same time, give or take an hour (the other
 * direction) – and, where
 * positions are known, lie within 50 m of each other. Different roads are never merged.
 */

export interface DuplicateKey {
  sourceId: string;
  situationId: string | null;
  eventType: string | null;
  headline: string;
  validFrom: number | null;
  validTo: number | null;
  point?: { lat: number; lon: number } | null;
}

const NEAR_M = 50;
const SAME_TIME_MS = 60 * 60_000;
const PLACE_SPLIT = / (?:nära|mellan|från|på|vid|i|mot|norr om|söder om|öster om|väster om) /;

/** "Vägarbete: Bergiusvägen nära Frescativägen i …" → "Bergiusvägen nära Frescativägen i …". */
export const trafficPlace = (headline: string) => (headline.includes(':') ? headline.slice(headline.indexOf(':') + 1).trim() : '');
/** The road the message is about, lower-cased: "bergiusvägen", "väg 75". */
export const trafficRoad = (headline: string) => trafficPlace(headline).split(PLACE_SPLIT)[0]!.trim().toLowerCase();

function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lon - a.lon) * kx, (b.lat - a.lat) * 110_540);
}

export function sameTrafficEvent(a: DuplicateKey, b: DuplicateKey): boolean {
  if (a.sourceId !== 'trafikverket' || b.sourceId !== 'trafikverket') return false;
  const road = trafficRoad(a.headline);
  if (!road || road !== trafficRoad(b.headline)) return false;
  if (a.situationId && a.situationId === b.situationId) return true;
  // The other direction is entered separately, minutes apart (Bergiusvägen: 08:28 and 08:31).
  const close = (x: number | null, y: number | null) => (x === null || y === null ? x === y : Math.abs(x - y) <= SAME_TIME_MS);
  if (!a.eventType || a.eventType !== b.eventType || !close(a.validFrom, b.validFrom) || !close(a.validTo, b.validTo)) return false;
  return !a.point || !b.point || metres(a.point, b.point) <= NEAR_M;
}

/** Groups of duplicates (union–find); `extra` adds a condition both rows must meet (e.g. same batch). */
export function groupDuplicates<T>(items: T[], key: (t: T) => DuplicateKey, extra: (a: T, b: T) => boolean = () => true): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const keys = items.map(key);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (sameTrafficEvent(keys[i]!, keys[j]!) && extra(items[i]!, items[j]!)) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, T[]>();
  items.forEach((t, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(t);
  });
  return [...groups.values()];
}

/** "Vägarbete, vägen avstängd: Bergiusvägen nära Frescativägen i Stockholm kommun" – the shortest place wins. */
export function mergedTrafficTitle(items: Array<{ eventType: string | null; headline: string }>): string {
  const types = [...new Set(items.map((i) => (i.eventType ?? i.headline.split(':')[0]!).trim()).filter(Boolean))];
  const place = items.map((i) => trafficPlace(i.headline)).filter(Boolean).sort((a, b) => a.length - b.length)[0];
  const type = types.map((t, i) => (i ? t[0]!.toLowerCase() + t.slice(1) : t)).join(', ');
  return place ? `${type}: ${place}` : type;
}

export const SEVERITY_RANK: Record<string, number> = { critical: 4, warning: 3, monitor: 2, info: 1, unknown: 0 };
