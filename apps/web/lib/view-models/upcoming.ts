import type { Portfolio, UpcomingCondition } from '@fastighetsradar/domain';
import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE, formatClock, formatWeekdayClock } from '@fastighetsradar/domain';
import { SEV } from '../design/tokens';
import { darkSpans } from './daylight';

/**
 * "Kommande förhållanden" (next 48 h) – designer's layout (Design förbättring, 2026-11-18):
 * a headline, filter chips and a 48 h timeline with darkness shaded. Shared conditions expand to
 * their affected properties; individual conditions expand to details and advice.
 *
 * The rows come from the API (forecast thresholds + official warnings that start later); this module
 * only derives presentation.
 */

export type UpcomingKind = 'warning' | 'ice' | 'frost' | 'freeze' | 'wind' | 'rain' | 'snow' | 'thunder' | 'outage';

const BLUE = 'oklch(0.56 0.12 245)';
/** Chip label and bar colour per kind (official warnings are coloured by their level instead). */
export const UPCOMING_KIND: Record<UpcomingKind, { label: string; bar: string }> = {
  outage: { label: 'Avstängningar', bar: BLUE },
  warning: { label: 'Varningar', bar: 'oklch(0.7 0.16 55)' },
  ice: { label: 'Halka', bar: 'oklch(0.68 0.15 58)' },
  frost: { label: 'Minusgrader', bar: BLUE },
  freeze: { label: 'Växlande ±0°', bar: `repeating-linear-gradient(135deg, ${BLUE} 0 3px, oklch(0.84 0.06 245) 3px 6px)` },
  wind: { label: 'Vind', bar: 'oklch(0.62 0.09 195)' },
  rain: { label: 'Nederbörd', bar: 'oklch(0.58 0.12 265)' },
  snow: { label: 'Snö', bar: 'oklch(0.74 0.05 240)' },
  thunder: { label: 'Åska', bar: 'oklch(0.56 0.15 305)' },
};
const KIND_ORDER: UpcomingKind[] = ['warning', 'outage', 'ice', 'frost', 'freeze', 'wind', 'rain', 'snow', 'thunder'];
const LEVEL_BAR: Record<string, string> = { gul: 'oklch(0.83 0.15 92)', orange: 'oklch(0.7 0.16 55)', röd: SEV.critical.c };

interface Kind {
  kind: UpcomingKind;
  /** Value and unit for the right column, from the row's value and its span. */
  value: (u: UpcomingCondition, hours: number) => { value: string; unit: string };
  body: string;
  action: string;
}

const minus = (v: string) => v.replace(/^-/, '−');
const num = (v: string) => (/(\d+(?:[.,]\d+)?)/.exec(v)?.[1] ?? v);
const KINDS: Record<string, Kind> = {
  gust: {
    kind: 'wind', value: (u) => ({ value: u.value, unit: 'byvind' }),
    body: 'SMHI:s prognos visar hårda vindbyar vid fastigheten.',
    action: 'Säkra lösa föremål på balkonger, tak och gårdar. Kontrollera att portar och grindar är stängda.',
  },
  rain: {
    kind: 'rain', value: (u) => ({ value: u.value, unit: 'på 24 h' }),
    body: 'Summerad nederbörd det kommande dygnet ligger över tröskelvärdet för kraftig nederbörd.',
    action: 'Kontrollera att dagvattenbrunnar och hängrännor är rensade och att källare och garage är skyddade.',
  },
  'intense-rain': {
    kind: 'rain', value: (u) => ({ value: `${num(u.value)} mm`, unit: 'på en timme' }),
    body: 'Prognosen visar en timme med intensivt regn. Dagvattnet kan ha svårt att rinna undan.',
    action: 'Rensa dagvattenbrunnar och kontrollera låga punkter som källarnedgångar och garageinfarter.',
  },
  thunder: {
    kind: 'thunder', value: (u) => ({ value: u.value, unit: 'risk för åska' }),
    body: 'Prognosen anger förhöjd sannolikhet för åska.',
    action: 'Bevaka utvecklingen. Åska kan ge lokala skyfall och strömavbrott.',
  },
  snow: {
    kind: 'snow', value: (u) => ({ value: u.value.replace(/^ca\s+/, ''), unit: 'snö / 24 h' }),
    body: 'Prognosen visar snöfall under det kommande dygnet.',
    action: 'Säkerställ snöröjning och sandning av entréer och bevaka snölasten på tak.',
  },
  ice: {
    kind: 'ice', value: (_u, h) => ({ value: `${Math.max(1, Math.round(h))} h`, unit: 'varaktighet' }),
    body: 'Fukt och temperatur kring 0° ger risk för is på entréer, trappor och tak.',
    action: 'Planera halkbekämpning: sanda entréer, trappor och gångytor och kontrollera takfot och stuprör för is.',
  },
  'freeze-thaw': {
    kind: 'freeze', value: (u) => ({ value: `${num(u.value)}×`, unit: 'passerar 0°' }),
    body: 'Temperaturen passerar 0° flera gånger. Smältvatten kan frysa i stuprör, hängrännor och på entréytor.',
    action: 'Bevaka takfot och stuprör för istappar och beställ snö- och isröjning vid behov.',
  },
  frost: {
    kind: 'frost', value: (u) => ({ value: minus(u.value), unit: 'lägst' }),
    body: 'Prognosen visar minusgrader vid fastigheten. Skuggiga ytor kan få frost.',
    action: 'Kontrollera frysskydd på utvändiga vattenledningar och sanda skuggiga gångytor.',
  },
};
const PREFIXES = ['intense-rain', 'freeze-thaw', 'thunder', 'snow', 'ice', 'gust', 'rain', 'frost'];

const OFFICIAL_ACTION = 'Läs varningen hos SMHI och följ myndigheternas råd. Säkra det som kan påverkas på fastigheten.';
const SOURCE_SV: Record<string, string> = { krisinformation: 'Krisinformation', smhi_warnings: 'SMHI', smhi_forecast: 'SMHI', smhi_oceanography: 'SMHI' };
const stripTag = (label: string) => label.replace(/\s*\((prognos)[^)]*\)\s*$/i, '').trim();
const HOUR = 3_600_000;
const WINDOW = 48 * HOUR;

export interface UpcomingEvent {
  sourceUrl?: string;
  id: string;
  kind: UpcomingKind;
  /** Lower = more serious: official red/VMA, orange, yellow, ice, other warnings, the rest. */
  rank: number;
  official: boolean;
  hot: boolean;
  name: string;
  propertyId: string | null;
  address: string;
  condition: string;
  tone: UpcomingCondition['tone'];
  label: string;
  bar: string;
  /** Start and end (ms); a condition without an end is drawn as one hour. */
  start: number;
  end: number;
  value: string;
  unit: string;
  note: string;
  from: string;
  to: string;
  src: string;
  /** Lowest temperature for frost rows (the headline and subline use it). */
  tmin: number | null;
}

export function buildUpcomingEvents(portfolio: Portfolio, propertyIds: Set<string>): UpcomingEvent[] {
  const ref = Date.parse(portfolio.generatedAt);
  const addresses = new Map(portfolio.properties.map(({ property }) => [property.id, property.address]));
  return portfolio.upcoming
    .filter((u) => !u.propertyId || propertyIds.has(u.propertyId))
    .map((u): UpcomingEvent => {
      const prefix = PREFIXES.find((p) => u.id.startsWith(p + '-'));
      const k = !u.official && prefix ? KINDS[prefix]! : null;
      const start = u.validAt ? Date.parse(u.validAt) : ref;
      const end = u.kind === 'outage' ? Date.parse(u.validTo!) : u.validTo ? Math.max(Date.parse(u.validTo), start + 15 * 60_000) : start + HOUR;
      const src = u.kind === 'outage' ? u.sourceName ?? 'Leverantören' : (u.sourceId && SOURCE_SV[u.sourceId]) || 'SMHI';
      const level = u.official ? u.value.split(' ')[0]!.toLowerCase() : '';
      const condition = stripTag(u.label);
      const kind: UpcomingKind = u.kind === 'outage' ? 'outage' : k?.kind ?? 'warning';
      const vu = k ? k.value(u, (end - start) / HOUR) : { value: u.value.replace(/\s*varning$/i, ''), unit: /varning/i.test(u.value) ? 'varning' : '' };
      const temp = prefix === 'frost' ? Number(u.value.replace('−', '-').replace(',', '.').replace(/[^\d.-]/g, '')) : NaN;
      const rank = u.official ? (u.tone === 'critical' ? 0 : u.tone === 'warning' ? 1 : 2) : kind === 'ice' ? 3 : u.tone === 'warning' ? 4 : kind === 'frost' ? 5 : 6;
      return {
        id: u.id,
        ...(u.sourceUrl ? { sourceUrl: u.sourceUrl } : {}),
        kind,
        rank,
        official: !!u.official,
        hot: u.tone === 'warning' || u.tone === 'critical',
        name: u.where,
        propertyId: u.propertyId ?? null,
        address: u.propertyId ? addresses.get(u.propertyId) ?? '' : '',
        condition,
        tone: u.tone,
        label: u.official ? `${u.value} · ${condition.toLowerCase()}` : condition,
        bar: u.official ? LEVEL_BAR[level] ?? UPCOMING_KIND.warning.bar : UPCOMING_KIND[kind].bar,
        start,
        end,
        value: vu.value,
        unit: vu.unit,
        note: kind === 'outage' ? u.explanation ? `Leverantörens text: ${u.explanation}` : 'Leverantören har registrerat en planerad avstängning vid fastighetens läge. Läs leverantörens driftinformation.' : k ? `${k.body}${u.explanation && prefix !== 'freeze-thaw' ? ` ${u.explanation[0]!.toUpperCase()}${u.explanation.slice(1)}.` : ''} ${k.action}` : `${src} har utfärdat en ${u.value.toLowerCase()} för ${condition.toLowerCase()}. ${OFFICIAL_ACTION}`,
        from: formatWeekdayClock(new Date(start).toISOString()),
        to: formatWeekdayClock(new Date(end).toISOString()),
        src: `${src} · ${kind === 'outage' ? 'avbrottsinformation' : u.official ? 'varning' : 'prognos'}`,
        tmin: Number.isFinite(temp) ? temp : null,
      };
    });
}

/* ------------------------------------------------------------------ */
/* Texts                                                               */
/* ------------------------------------------------------------------ */

const WORDS = ['noll', 'en', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio'];
const words = (n: number) => WORDS[n] ?? String(n);
const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: DISPLAY_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const weekdayLong = new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone: DISPLAY_TIME_ZONE, weekday: 'long' });
const weekdayShort = new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone: DISPLAY_TIME_ZONE, weekday: 'short' });
const dayMonth = new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone: DISPLAY_TIME_ZONE, day: 'numeric', month: 'short' });
const dayNum = new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone: DISPLAY_TIME_ZONE, day: 'numeric' });
const dayKey = (ms: number) => dayFmt.format(new Date(ms));
const hourOf = (ms: number) => Number(hourFmt.format(new Date(ms)).slice(0, 2));
const clock = (ms: number) => formatClock(new Date(ms).toISOString());

/** "från ikväll 18:00", "från i natt 02:00", "från imorgon 09:00", "från torsdag 09:00", "redan nu". */
export function whenPhrase(start: number, ref: number): string {
  if (start <= ref + 30 * 60_000) return 'redan nu';
  const today = dayKey(ref), day = dayKey(start), h = hourOf(start);
  const tomorrow = dayKey(ref + 24 * HOUR);
  if (day === today) return h >= 17 ? `från ikväll ${clock(start)}` : `från idag ${clock(start)}`;
  if (day === tomorrow && h < 6) return `från i natt ${clock(start)}`;
  if (day === tomorrow) return `från imorgon ${clock(start)}`;
  return `från ${weekdayLong.format(new Date(start))} ${clock(start)}`;
}

const HEADLINE: Record<UpcomingKind, (e: UpcomingEvent) => string> = {
  outage: (e) => e.label,
  warning: (e) => e.label.replace(' · ', ' för '),
  ice: () => 'Risk för halka',
  frost: (e) => `Minusgrader ner till ${e.value}`,
  freeze: () => 'Växlande plus- och minusgrader',
  wind: (e) => `Byvind upp till ${e.value}`,
  rain: (e) => (e.unit === 'på en timme' ? 'Intensivt regn' : `Kraftig nederbörd, ${e.value}`),
  snow: () => 'Snöfall',
  thunder: () => 'Risk för åska',
};

/** One sentence per other kind: "Minusgrader på tre platser, lägst −4° vid Körfältsvägen." */
function sentence(kind: UpcomingKind, list: UpcomingEvent[]): string {
  const places = [...new Set(list.map((e) => e.name))];
  const n = places.length;
  const where = n === 1 ? `vid ${places[0]}` : `på ${words(n)} platser`;
  switch (kind) {
    case 'outage': return `Planerade avstängningar ${where}.`;
    case 'warning': return `${cap(words(list.length))} ${list.length === 1 ? 'officiell varning' : 'officiella varningar'} ${where}.`;
    case 'frost': {
      const cold = [...list].sort((a, b) => (a.tmin ?? 0) - (b.tmin ?? 0))[0]!;
      return n === 1 ? `Minusgrader vid ${cold.name}, lägst ${cold.value}.` : `Minusgrader ${where}, lägst ${cold.value} vid ${cold.name}.`;
    }
    case 'freeze': return n === 1 ? `${places[0]} passerar 0° flera gånger.` : `${cap(words(n))} platser passerar 0° flera gånger.`;
    case 'ice': return `Risk för halka ${where}.`;
    case 'wind': return `Hårda vindbyar ${where}.`;
    case 'rain': return `Kraftig nederbörd ${where}.`;
    case 'snow': return `Snöfall ${where}.`;
    case 'thunder': return `Risk för åska ${where}.`;
  }
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export type UpcomingFilter = UpcomingKind | 'all';

const TONE_ORDER: Record<UpcomingEvent['tone'], number> = { critical: 0, warning: 1, monitor: 2, cold: 3 };
const compareTone = (a: UpcomingEvent, b: UpcomingEvent) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.rank - b.rank;
const byRank = (a: UpcomingEvent, b: UpcomingEvent) => a.rank - b.rank || a.start - b.start;
const byName = new Intl.Collator(DISPLAY_LOCALE, { numeric: true });

type PropertyEvent = UpcomingEvent & { propertyId: string };

/**
 * When a condition counts as "the same" for grouping. An official warning or an outage is one event with
 * one span. A forecast threshold is computed per property from its own point forecast, so frost over
 * a city starts 02:00 here and 03:00 there: those are grouped per six-hour window of the start
 * (night, morning, afternoon, evening – Stockholm time), and the group spans the earliest start to the
 * latest end. Exact spans left 500 properties in many small groups shown as single rows again.
 */
function groupTime(e: UpcomingEvent): string | number {
  if (e.official || e.kind === 'outage') return `${e.start}-${e.end}`;
  return `${dayKey(e.start)}/${Math.floor(hourOf(e.start) / 6)}`;
}

/** Group shared conditions with the same source and time (`groupTime`), once per affected property. */
export function groupUpcomingEvents(events: readonly UpcomingEvent[]) {
  const individual: UpcomingEvent[] = [];
  const candidates = new Map<string, PropertyEvent[]>();
  for (const event of events) {
    if (!event.propertyId) {
      individual.push(event);
      continue;
    }
    const key = JSON.stringify([event.kind, event.condition, event.official, event.src, event.sourceUrl, groupTime(event)]);
    const propertyEvent = { ...event, propertyId: event.propertyId };
    const bucket = candidates.get(key);
    if (bucket) bucket.push(propertyEvent);
    else candidates.set(key, [propertyEvent]);
  }

  const groups = [];
  for (const [key, bucket] of candidates) {
    const properties = new Map<string, PropertyEvent>();
    const strongest = bucket.reduce((a, b) => compareTone(a, b) <= 0 ? a : b);
    for (const event of bucket) {
      const previous = properties.get(event.propertyId);
      if (!previous || compareTone(event, previous) < 0) properties.set(event.propertyId, event);
    }
    if (properties.size <= 3) {
      individual.push(...bucket);
      continue;
    }
    const bar = strongest.tone === 'critical' ? SEV.critical.c
      : strongest.tone === 'warning' && !strongest.official ? SEV.warning.c : strongest.bar;
    const start = Math.min(...bucket.map((e) => e.start));
    const end = Math.max(...bucket.map((e) => e.end));
    groups.push({
      key,
      event: { ...strongest, bar, start, end, from: formatWeekdayClock(new Date(start).toISOString()), to: formatWeekdayClock(new Date(end).toISOString()) },
      properties: [...properties.values()].sort((a, b) => byName.compare(a.name, b.name) || byName.compare(a.address, b.address)),
    });
  }
  return { groups, individual };
}

export type UpcomingBar = UpcomingEvent & { left: number; width: number; right: number; cross: boolean };
export type UpcomingPlaceRow = { type: 'place'; key: string; name: string; propertyId: string | null; events: UpcomingBar[]; countText: string };
export type UpcomingGroupRow = { type: 'group'; key: string; name: string; events: [UpcomingBar]; properties: PropertyEvent[]; countText: string };
export type UpcomingRow = UpcomingPlaceRow | UpcomingGroupRow;

export function upcomingView(events: UpcomingEvent[], referenceIso: string, opts: { filter?: UpcomingFilter; center?: { lat: number; lon: number } | null } = {}) {
  const ref = Date.parse(referenceIso);
  const filter = opts.filter && (opts.filter === 'all' || events.some((e) => e.kind === opts.filter)) ? opts.filter : 'all';
  const pos = (ms: number) => Math.min(1, Math.max(0, (ms - ref) / WINDOW));
  const toBar = (e: UpcomingEvent): UpcomingBar => ({ ...e, left: pos(e.start), width: Math.max(0.012, pos(e.end) - pos(e.start)), right: pos(e.end), cross: e.kind === 'freeze' });

  // Headline: the most serious condition, where and from when; the subline sums up the other kinds.
  const top = [...events].sort(byRank)[0];
  let headline = 'Inget över tröskelvärdena de kommande 48 h';
  let subline = '';
  if (top) {
    const sameKind = events.filter((e) => e.kind === top.kind && (top.kind !== 'warning' || e.label === top.label));
    const others = [...new Set(sameKind.map((e) => e.name))].length - 1;
    headline = `${HEADLINE[top.kind](top)} i ${top.name}${others > 0 ? ` och ${others} ${others === 1 ? 'plats' : 'platser'} till` : ''} ${whenPhrase(top.start, ref)}`;
    // Everything the headline does not already say, one sentence per kind, the two most serious kinds.
    const said = new Set(sameKind.map((e) => e.id));
    subline = KIND_ORDER.map((k) => events.filter((e) => e.kind === k && !said.has(e.id)))
      .filter((l) => l.length)
      .slice(0, 2)
      .map((l) => sentence(l[0]!.kind, l))
      .join(' ');
  }

  const chips = [
    { k: 'all' as UpcomingFilter, label: 'Alla', n: events.length, sw: null as string | null, active: filter === 'all' },
    ...KIND_ORDER.filter((k) => events.some((e) => e.kind === k)).map((k) => ({ k: k as UpcomingFilter, label: UPCOMING_KIND[k].label, n: events.filter((e) => e.kind === k).length, sw: UPCOMING_KIND[k].bar, active: filter === k })),
  ];

  const shown = events.filter((e) => filter === 'all' || e.kind === filter);
  const { groups, individual } = groupUpcomingEvents(shown);
  const places = new Map<string, { key: string; name: string; propertyId: string | null; events: UpcomingEvent[] }>();
  const placeKey = (e: UpcomingEvent) => e.propertyId ? `property:${e.propertyId}` : `place:${e.name}`;
  for (const e of individual) {
    const key = placeKey(e);
    if (!places.has(key)) places.set(key, { key, name: e.name, propertyId: e.propertyId, events: [] });
    places.get(key)!.events.push(e);
  }
  const rows: UpcomingRow[] = [...places.values()].map((p) => ({
    ...p, type: 'place', events: p.events.sort(byRank).map(toBar), countText: p.events.length > 1 ? `${p.events.length} händelser` : '',
  }));
  for (const g of groups) rows.push({ type: 'group', key: `group:${g.key}`, name: g.event.label, events: [toBar(g.event)], properties: g.properties, countText: `${g.properties.length} fastigheter` });
  rows.sort((a, b) => byRank(a.events[0]!, b.events[0]!));

  // Axis: midnights (day starts) and every six clock hours, in Stockholm time.
  const midnights: Array<{ pos: number; day: string; date: string; short: string }> = [];
  const ticks: Array<{ pos: number; label: string }> = [];
  let current = dayKey(ref);
  for (let t = Math.ceil(ref / (15 * 60_000)) * 15 * 60_000 + 15 * 60_000; t < ref + WINDOW; t += 15 * 60_000) {
    const k = dayKey(t);
    const d = new Date(t);
    if (k !== current) {
      current = k;
      const wd = weekdayLong.format(d);
      midnights.push({ pos: pos(t), day: cap(wd), date: dayMonth.format(d).replace(/\.$/, ''), short: `${cap(weekdayShort.format(d).replace('.', '').slice(0, 3))} ${dayNum.format(d)}` });
      continue;
    }
    const hm = hourFmt.format(d);
    if (hm.endsWith(':00') && hourOf(t) % 6 === 0 && pos(t) > 0.1 && pos(t) < 0.97) ticks.push({ pos: pos(t), label: hm.slice(0, 2) });
  }
  const firstLabel = hourOf(ref) >= 17 ? 'Ikväll' : 'Idag';
  const night = opts.center ? darkSpans(ref, ref + WINDOW, opts.center.lat, opts.center.lon) : [];

  const n = shown.length;
  const placeCount = new Set(shown.map(placeKey)).size;
  return {
    headline,
    subline,
    chips,
    filter,
    rows,
    axis: { now: `Nu ${String(hourOf(ref)).padStart(2, '0')}`, today: (midnights[0]?.pos ?? 1) > 0.1 ? firstLabel : null, midnights, ticks },
    night,
    countText: `${n} ${n === 1 ? 'händelse' : 'händelser'} · ${placeCount} ${placeCount === 1 ? 'plats' : 'platser'}`,
    empty: events.length === 0,
  };
}
export type UpcomingView = ReturnType<typeof upcomingView>;

/** Latest source update among the rows ("SMHI · uppdaterad 16:00"), or null. */
export function upcomingUpdated(portfolio: Portfolio): string | null {
  const t = portfolio.upcoming.map((u) => u.sourceUpdatedAt).filter((x): x is string => !!x).sort().at(-1);
  return t ? formatClock(t) : null;
}

/** Centre of the properties in view, for the darkness shading. */
export function upcomingCenter(portfolio: Portfolio, propertyIds: Set<string>): { lat: number; lon: number } | null {
  const pts = portfolio.properties.filter((s) => propertyIds.has(s.property.id)).map((s) => s.property.location);
  if (!pts.length) return null;
  return { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lon: pts.reduce((a, p) => a + p.lon, 0) / pts.length };
}
