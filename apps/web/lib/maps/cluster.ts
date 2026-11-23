import type { PropertySnapshot, PropertyStatus } from '@fastighetsradar/domain';

/**
 * Pins that would lie on top of each other are drawn as one cluster (docs/plans/skalning.md, Fas 4 /
 * S-18): the number of properties, in the colour of the most serious status among them. Clustering
 * happens in screen pixels at the map's zoom, so it opens up as the user zooms in. No library: a
 * greedy pass over a grid is enough for the 1 000 properties an organization may have.
 */

export interface ClusterPoint {
  id: string;
  x: number;
  y: number;
}

/**
 * Each point not yet taken starts a cluster and takes every free point within `radius` pixels of it.
 * The result depends only on the input order, so the same list and zoom always give the same clusters.
 */
export function clusterPoints(points: ClusterPoint[], radius: number): ClusterPoint['id'][][] {
  const cell = (v: number) => Math.floor(v / radius);
  const grid = new Map<string, number[]>();
  points.forEach((p, i) => {
    const key = `${cell(p.x)}:${cell(p.y)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  });
  const taken = new Uint8Array(points.length);
  const r2 = radius * radius;
  const clusters: string[][] = [];
  points.forEach((p, i) => {
    if (taken[i]) return;
    taken[i] = 1;
    const members = [p.id];
    const cx = cell(p.x);
    const cy = cell(p.y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (taken[j]) continue;
          const q = points[j]!;
          if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= r2) {
            taken[j] = 1;
            members.push(q.id);
          }
        }
      }
    }
    clusters.push(members);
  });
  return clusters;
}

/** Most serious first; "Ej bedömd" (no data) below "Ingen aktiv varning", so it never hides green. */
const STATUS_WEIGHT: Record<PropertyStatus, number> = { critical: 4, warning: 3, monitor: 2, normal: 1, unknown: 0 };

export function worstStatus(statuses: Iterable<PropertyStatus>): PropertyStatus {
  let worst: PropertyStatus = 'unknown';
  for (const s of statuses) if ((STATUS_WEIGHT[s] ?? 0) > STATUS_WEIGHT[worst]) worst = s;
  return worst;
}

export type MapMarker =
  | { kind: 'pin'; key: string; snapshot: PropertySnapshot }
  | {
      kind: 'cluster';
      key: string;
      /** Most serious first, then by name. */
      members: PropertySnapshot[];
      lat: number;
      lon: number;
      status: PropertyStatus;
      /** Properties per status, most serious first. */
      counts: Array<{ status: PropertyStatus; n: number }>;
      /** Every member at (almost) the same point: zooming in cannot separate them. */
      samePlace: boolean;
    };

/** The pins and clusters to draw at one zoom; `project` turns a position into screen pixels at that zoom. */
export function buildMapMarkers(list: PropertySnapshot[], project: (lat: number, lon: number) => { x: number; y: number }, radius: number): MapMarker[] {
  const byId = new Map(list.map((s) => [s.property.id, s]));
  const points = list.map((s) => ({ id: s.property.id, ...project(s.property.location.lat, s.property.location.lon) }));
  return clusterPoints(points, radius).map((ids): MapMarker => {
    if (ids.length === 1) return { kind: 'pin', key: `p:${ids[0]}`, snapshot: byId.get(ids[0]!)! };
    const members = ids
      .map((id) => byId.get(id)!)
      .sort((a, b) => STATUS_WEIGHT[b.property.status] - STATUS_WEIGHT[a.property.status] || a.property.name.localeCompare(b.property.name, 'sv-SE'));
    const tally = new Map<PropertyStatus, number>();
    for (const s of members) tally.set(s.property.status, (tally.get(s.property.status) ?? 0) + 1);
    const lats = members.map((s) => s.property.location.lat);
    const lons = members.map((s) => s.property.location.lon);
    return {
      kind: 'cluster',
      key: `c:${[...ids].sort().join(',')}`,
      members,
      lat: members.reduce((sum, s) => sum + s.property.location.lat, 0) / members.length,
      lon: members.reduce((sum, s) => sum + s.property.location.lon, 0) / members.length,
      status: worstStatus(members.map((s) => s.property.status)),
      counts: [...tally].map(([status, n]) => ({ status, n })).sort((a, b) => STATUS_WEIGHT[b.status] - STATUS_WEIGHT[a.status]),
      // ~1 m: properties on one address point (several buildings imported with the same address).
      samePlace: Math.max(...lats) - Math.min(...lats) < 1e-5 && Math.max(...lons) - Math.min(...lons) < 1e-5,
    };
  });
}
