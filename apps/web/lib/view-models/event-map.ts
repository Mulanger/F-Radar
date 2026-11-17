import { formatClock, formatDistance, formatShortDate, swedishDateKey, type EventMapHue, type EventMapIcon, type EventMapItem } from '@fastighetsradar/domain';
import { SEV } from '../design/tokens';
import { geometryRuns, runLength, type LL } from '../maps/geo';
import type { DetailVM } from './detail';

/** One event in the "Visa på karta" view. */
export interface EventMapEntry {
  id: string;
  title: string;
  src: string;
  dist: string;
  time: string;
  label: string;
  icon: EventMapIcon;
  /** Map line/marker colour (hex), text colour, tile background and badge text colour. */
  hx: string;
  c: string;
  bg: string;
  fg: string;
  impact: string;
  where: string;
  description: string | null;
  shape: 'line' | 'point' | 'area';
  /** Polylines for a stretch; one single-point run for a point or area centre. */
  runs: LL[][];
  radiusM: number | null;
  lengthM: number | null;
  /** "Påverkad sträcka ≈ 1,2 km" etc. */
  extent: string;
  /** False while only the event's closest point is known (geometry loading or unavailable). */
  exact: boolean;
}

export type EventMapStatus = 'idle' | 'loading' | 'ready' | 'error';

const HUE: Record<EventMapHue, { hx: string; c: string; bg: string; fg: string }> = {
  red: { hx: SEV.critical.hx, c: SEV.critical.c, bg: SEV.critical.bg, fg: 'oklch(0.48 0.17 27)' },
  orange: { hx: SEV.warning.hx, c: SEV.warning.c, bg: SEV.warning.bg, fg: 'oklch(0.48 0.13 55)' },
  blue: { hx: SEV.monitor.hx, c: SEV.monitor.c, bg: SEV.monitor.bg, fg: 'oklch(0.45 0.11 245)' },
  violet: { hx: '#7468C9', c: 'oklch(0.55 0.14 290)', bg: 'oklch(0.95 0.03 290)', fg: 'oklch(0.45 0.13 290)' },
};

const CATEGORY_FALLBACK: Record<string, { icon: EventMapIcon; hue: EventMapHue }> = {
  Traffic: { icon: 'info', hue: 'orange' },
  Water: { icon: 'water', hue: 'blue' },
  Crisis: { icon: 'info', hue: 'red' },
  Air: { icon: 'air', hue: 'violet' },
  Weather: { icon: 'frost', hue: 'blue' },
};

/** "≈ 270 m" / "≈ 5,4 km" (rounded like the source's own precision). */
export function formatStretch(m: number): string {
  if (m >= 1000) return formatDistance(Math.round(m / 100) * 100);
  return `${Math.max(10, Math.round(m / 10) * 10)} m`;
}

/** "Till 18:00" today, otherwise "Till 21 nov". */
export function untilLabel(validTo: string, nowIso: string): string {
  return swedishDateKey(validTo) === swedishDateKey(nowIso) ? `Till ${formatClock(validTo)}` : `Till ${formatShortDate(validTo).replace(/\.$/, '')}`;
}

/**
 * The property's mappable events (those with a position) in list order, joined with their
 * published geometry. Without geometry (still loading, or unavailable) an event is shown at
 * its closest point, marked `exact: false`.
 */
export function eventMapEntries(events: DetailVM['events'], items: EventMapItem[] | null, status: EventMapStatus, nowIso: string): EventMapEntry[] {
  const byId = new Map((items ?? []).map((x) => [x.eventId, x]));
  const out: EventMapEntry[] = [];
  for (const e of events) {
    const x = byId.get(e.id);
    if (!x && !e.location) continue;
    const base = { id: e.id, title: e.title, src: e.src, dist: e.dist };
    if (!x) {
      const fb = CATEGORY_FALLBACK[e.category] ?? CATEGORY_FALLBACK.Traffic!;
      out.push({
        ...base,
        time: e.time,
        label: e.kind,
        icon: fb.icon,
        hx: e.hx,
        c: e.c,
        bg: e.bg,
        fg: e.c,
        impact: '—',
        where: e.title,
        description: null,
        shape: 'point',
        runs: [[[e.location!.lat, e.location!.lon]]],
        radiusM: null,
        lengthM: null,
        extent: status === 'loading' || status === 'idle' ? 'Hämtar exakt läge…' : 'Närmaste punkt',
        exact: false,
      });
      continue;
    }
    const runs = geometryRuns(x.geometry);
    const line = x.geometry.type !== 'Point';
    const shape = line ? 'line' : x.radiusM ? 'area' : 'point';
    const lengthM = line ? x.lengthM ?? runs.reduce((s, r) => s + runLength(r), 0) : null;
    out.push({
      ...base,
      time: x.validTo ? untilLabel(x.validTo, nowIso) : e.time,
      label: x.label,
      icon: x.icon,
      ...HUE[x.hue],
      impact: x.impact ?? '—',
      where: x.where ?? x.label,
      description: x.description,
      shape,
      runs,
      radiusM: x.radiusM,
      lengthM,
      extent: shape === 'line' ? `Påverkad sträcka ≈ ${formatStretch(lengthM ?? 0)}` : shape === 'area' ? `Påverkat område · radie ${formatDistance(x.radiusM)}` : 'Exakt plats',
      exact: true,
    });
  }
  return out;
}

/** Icon paths (24×24, stroked) for the map marker and the event card. */
export const EVENT_MAP_ICON_PATH: Record<EventMapIcon, string> = {
  roadwork: 'M2 6h20v8H2zM17 14v7M7 14v7M17 3v3M7 3v3M10 14 2.3 6.3M14 6l7.7 7.7M8 6l8 8',
  lanes: 'M4 21 8 3M20 21 16 3M12 4v2M12 10v2M12 16v3',
  closed: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7.5 12h9',
  accident: 'M5 18h14M6.5 18v2M17.5 18v2M5 18l1.6-5.2A2 2 0 0 1 8.5 11.4h7a2 2 0 0 1 1.9 1.4L19 18M8 15.2h.01M16 15.2h.01M12 2.5v3M7.8 4l1.4 2.3M16.2 4l-1.4 2.3',
  obstacle: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  animal: 'M6.5 9.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM10 6.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM14 6.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM17.5 9.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM12 11c-2.6 0-5 3.2-5 6.2A2.3 2.3 0 0 0 9.8 19.5c.8-.2 1.4-.4 2.2-.4s1.4.2 2.2.4a2.3 2.3 0 0 0 2.8-2.3c0-3-2.4-6.2-5-6.2z',
  queue: 'M3 17h18M4.5 17l1.4-4.6A2 2 0 0 1 7.8 11h8.4a2 2 0 0 1 1.9 1.4L19.5 17v3h-2.5v-1.5H7V20H4.5zM8 14.5h.01M16 14.5h.01M6 7h12',
  speed: 'M12 14l4.5-4.5M3.3 19a10 10 0 1 1 17.4 0M12 14h.01',
  signal: 'M9 2h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 22v-2M12 6.5h.01M12 11h.01M12 15.5h.01',
  ferry: 'M2 20c2 1.3 4 1.3 6 0s4-1.3 6 0 4 1.3 6 0M4.5 16 3 11h18l-1.5 5M6 11V6h12v5M12 6V3',
  transit: 'M5 3h14v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM5 11h14M12 3v8M8.5 14.5h.01M15.5 14.5h.01M8 18l-2 3M16 18l2 3',
  water: 'M2 7c2 0 2-1.5 4-1.5S8 7 10 7s2-1.5 4-1.5S16 7 18 7s2-1.5 4-1.5M2 12.5c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M2 18c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5',
  crowd: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  fire: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z',
  frost: 'M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 3.5l3 2 3-2M9 20.5l3-2 3 2',
  air: 'M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
};
