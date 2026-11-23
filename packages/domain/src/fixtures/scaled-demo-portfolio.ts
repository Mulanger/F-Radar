import { demoUtilityCoverage } from './demo-portfolio';
/**
 * DEMO FIXTURES — NOT REAL DATA. Scale test portfolio (docs/plans/skalning.md, Fas 0).
 *
 * Clones the eight design-prototype properties into a portfolio of `n` properties so the dashboard
 * can be looked at and measured with 200–1000 properties. Deterministic: the same `n` always gives
 * the same ids, names and positions. The first eight properties are the untouched originals.
 *
 * - Clones are spread over Stockholm County (a sunflower spiral around the city), so the demo's
 *   regional warnings ("Stockholms län") still fit. Area and municipality come from the nearest
 *   municipality centre; "Innerstad" is Stockholm, Solna and Sundbyberg.
 * - Each clone copies its original's weather, warnings, events, risk and rules (ids rewritten).
 * - Feed and "Kommande" rows are copied to every clone of the property they belong to.
 * - The orange wind warning becomes ONE county-wide event that reaches every property – the
 *   "länsvarning" case from the plan (S-04, S-05, S-06). The properties' own warnings are not
 *   changed, so status and risk still vary over the portfolio.
 */
import type { FeedItem, Portfolio, PropertySnapshot, UpcomingCondition } from '../entities';

export const DEMO_SCALE_MAX = 2000;

/** Approximate municipality centres in Stockholm County (public geography, rounded). */
const MUNICIPALITIES: Array<{ name: string; lat: number; lon: number; inner?: true }> = [
  { name: 'Stockholm', lat: 59.329, lon: 18.069, inner: true },
  { name: 'Solna', lat: 59.36, lon: 18.0, inner: true },
  { name: 'Sundbyberg', lat: 59.361, lon: 17.971, inner: true },
  { name: 'Nacka', lat: 59.31, lon: 18.164 },
  { name: 'Huddinge', lat: 59.237, lon: 17.982 },
  { name: 'Botkyrka', lat: 59.2, lon: 17.833 },
  { name: 'Haninge', lat: 59.168, lon: 18.144 },
  { name: 'Täby', lat: 59.444, lon: 18.069 },
  { name: 'Danderyd', lat: 59.4, lon: 18.033 },
  { name: 'Lidingö', lat: 59.367, lon: 18.133 },
  { name: 'Järfälla', lat: 59.423, lon: 17.835 },
  { name: 'Sollentuna', lat: 59.428, lon: 17.951 },
  { name: 'Upplands Väsby', lat: 59.518, lon: 17.911 },
  { name: 'Vallentuna', lat: 59.534, lon: 18.078 },
  { name: 'Österåker', lat: 59.479, lon: 18.299 },
  { name: 'Värmdö', lat: 59.326, lon: 18.389 },
  { name: 'Tyresö', lat: 59.244, lon: 18.229 },
  { name: 'Södertälje', lat: 59.196, lon: 17.626 },
  { name: 'Norrtälje', lat: 59.758, lon: 18.705 },
  { name: 'Sigtuna', lat: 59.622, lon: 17.854 },
  { name: 'Ekerö', lat: 59.291, lon: 17.812 },
  { name: 'Salem', lat: 59.2, lon: 17.767 },
  { name: 'Nynäshamn', lat: 58.903, lon: 17.948 },
  { name: 'Upplands-Bro', lat: 59.478, lon: 17.752 },
  { name: 'Vaxholm', lat: 59.402, lon: 18.351 },
  { name: 'Nykvarn', lat: 59.178, lon: 17.432 },
];

const CENTRE = { lat: 59.329, lon: 18.069 };
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Spiral radius in degrees of latitude (~60 km): covers the county's populated part. */
const RADIUS_DEG = 0.55;

/** Shared id of the county-wide warning (every property's feed row points at the same event). */
export const DEMO_COUNTY_WARNING_EVENT_ID = 'demo-scale-county-warning';

const round = (v: number) => Math.round(v * 1e5) / 1e5;

function position(ordinal: number, total: number) {
  const r = RADIUS_DEG * Math.sqrt((ordinal + 0.5) / total);
  const a = ordinal * GOLDEN_ANGLE;
  const lat = CENTRE.lat + r * Math.sin(a);
  const lon = CENTRE.lon + (r * Math.cos(a)) / Math.cos((lat * Math.PI) / 180);
  return { lat: round(lat), lon: round(lon) };
}

function nearestMunicipality(lat: number, lon: number) {
  let best = MUNICIPALITIES[0]!;
  let bestD = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const m of MUNICIPALITIES) {
    const d = (m.lat - lat) ** 2 + ((m.lon - lon) * k) ** 2;
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

/** Rewrites every occurrence of the original property id (ids of warnings, events, rules …). */
function withIds<T>(value: T, from: string, to: string): T {
  return JSON.parse(JSON.stringify(value).split(`"${from}`).join(`"${to}`)) as T;
}

/** Normalizes a requested size: whole number between the base size and DEMO_SCALE_MAX, else null. */
export function demoScaleSize(raw: unknown, baseSize: number): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n <= baseSize) return null;
  return Math.min(n, DEMO_SCALE_MAX);
}

export function scaleDemoPortfolio(base: Portfolio, n: number): Portfolio {
  const size = demoScaleSize(n, base.properties.length);
  if (size === null) return base;
  const originals = base.properties;
  const clonesTotal = size - originals.length;
  /** original property id → clone ids (in order). */
  const clonesOf = new Map<string, string[]>(originals.map((s) => [s.property.id, []]));
  const properties: PropertySnapshot[] = [...originals];

  for (let ordinal = 0; ordinal < clonesTotal; ordinal++) {
    const src = originals[ordinal % originals.length]!;
    const copy = Math.floor(ordinal / originals.length) + 2;
    const id = `${src.property.id}-${copy}`;
    clonesOf.get(src.property.id)!.push(id);
    const s = withIds(src, src.property.id, id);
    const location = position(ordinal, clonesTotal);
    const muni = nearestMunicipality(location.lat, location.lon);
    const street = src.property.address.replace(/\s*\d.*$/, '').trim() || src.property.name;
    s.property = {
      ...s.property,
      name: `${src.property.name} ${copy}`,
      address: `${street} ${copy}, ${muni.name}`,
      area: muni.name,
      municipality: muni.name,
      groupIds: [muni.inner ? 'inner' : 'outer'],
      location,
    };
    properties.push(s);
  }

  const nameOf = new Map(properties.map((s) => [s.property.id, s.property.name]));
  // The first official, acknowledgeable SMHI warning in the feed becomes the county-wide warning.
  const county = base.feed.find((f) => f.sourceId === 'smhi_warnings' && f.ackRequired);
  const feed: FeedItem[] = [];
  for (const item of base.feed) {
    if (item === county) {
      for (const s of properties) {
        feed.push({
          ...item,
          id: s.property.id === item.propertyId ? item.id : `${item.id}-${s.property.id}`,
          propertyId: s.property.id,
          eventId: DEMO_COUNTY_WARNING_EVENT_ID,
          eventGroupId: DEMO_COUNTY_WARNING_EVENT_ID,
        });
      }
      continue;
    }
    feed.push(item);
    for (const cloneId of clonesOf.get(item.propertyId) ?? []) {
      feed.push({ ...withIds(item, item.propertyId, cloneId), id: `${item.id}-${cloneId}` });
    }
  }

  const upcoming: UpcomingCondition[] = [];
  for (const u of base.upcoming) {
    upcoming.push(u);
    for (const cloneId of (u.propertyId && clonesOf.get(u.propertyId)) || []) {
      upcoming.push({ ...withIds(u, u.propertyId!, cloneId), where: nameOf.get(cloneId) ?? u.where });
    }
  }

  return { ...base, properties, feed, upcoming, utilityCoverage: demoUtilityCoverage(properties) };
}
