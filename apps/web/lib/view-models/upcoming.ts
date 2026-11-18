import type { Portfolio, UpcomingCondition } from '@fastighetsradar/domain';
import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE, formatClock } from '@fastighetsradar/domain';
import { SEV } from '../design/tokens';

/**
 * "Kommande förhållanden" (next 48 h): plain information – a one-line summary, a 48 h strip and
 * simple rows grouped per day, each with what it means and what is good to do. Nothing here is
 * acknowledged; acknowledgement belongs to serious events in the feed (Händelseflöde).
 *
 * The rows themselves come from the API (forecast thresholds + official warnings that start later);
 * this module only derives presentation: category, icon, short value + unit, guidance texts.
 */

export type UpcomingCat = 'wind' | 'rain' | 'temp' | 'water' | 'other';
export const UPCOMING_CAT_LABEL: Record<UpcomingCat, string> = { wind: 'Vind', rain: 'Nederbörd', temp: 'Temperatur', water: 'Vatten', other: 'Övrigt' };

export const UPCOMING_ICON = {
  wind: 'M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2',
  rain: 'M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3M16 14v6M8 14v6M12 16v6',
  water: 'M2 7c2 0 2-1.5 4-1.5S8 7 10 7s2-1.5 4-1.5S16 7 18 7s2-1.5 4-1.5M2 12.5c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M2 18c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5',
  cycle: 'M7 20V4M3 8l4-4 4 4M17 4v16M13 16l4 4 4-4',
  frost: 'M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 3.5l3 2 3-2M9 20.5l3-2 3 2',
  snow: 'M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  check: 'M20 6 9 17l-5-5',
} as const;
type IconKey = keyof typeof UPCOMING_ICON;

type Tone = UpcomingCondition['tone'];
/** Card palette per tone. "cold" (frost, snow, ice) uses the calm blue of "Info". */
const TONE: Record<Tone, { c: string; bg: string; fg: string; label: string }> = {
  critical: { c: SEV.critical.c, bg: SEV.critical.bg, fg: 'oklch(0.48 0.17 27)', label: 'Kritisk' },
  warning: { c: SEV.warning.c, bg: SEV.warning.bg, fg: 'oklch(0.48 0.13 55)', label: 'Varning' },
  monitor: { c: SEV.monitor.c, bg: SEV.monitor.bg, fg: 'oklch(0.45 0.11 245)', label: 'Info' },
  cold: { c: SEV.monitor.c, bg: SEV.monitor.bg, fg: 'oklch(0.45 0.11 245)', label: 'Info' },
};

interface Kind {
  cat: UpcomingCat;
  icon: IconKey;
  /** Short value + unit for the card's right column. */
  split: (value: string) => { value: string; unit: string };
  /** One-line hint shown on the card (null = none). */
  hint: string | null;
  /** What the condition means, when the row carries no explanation of its own. */
  body: string;
  action: string;
}

const keep = (unit: string) => (value: string) => ({ value, unit });
const KINDS: Record<string, Kind> = {
  gust: {
    cat: 'wind', icon: 'wind', split: keep('byvind'), hint: 'Säkra lösa föremål på balkonger och tak',
    body: 'SMHI:s prognos visar hårda vindbyar vid fastigheten under det kommande dygnet.',
    action: 'Säkra lösa föremål på balkonger, tak och gårdar. Kontrollera att portar och grindar är stängda.',
  },
  rain: {
    cat: 'rain', icon: 'rain', split: keep('på 24 h'), hint: 'Rensa brunnar och hängrännor',
    body: 'Summerad nederbörd det kommande dygnet ligger över tröskelvärdet för kraftig nederbörd.',
    action: 'Kontrollera att dagvattenbrunnar och hängrännor är rensade och att källare och garage är skyddade.',
  },
  'intense-rain': {
    cat: 'rain', icon: 'rain',
    split: (v) => { const m = /(\d+(?:[.,]\d+)?)\s*mm\s*(.*)$/.exec(v); return m ? { value: `${m[1]} mm`, unit: m[2] || 'på en timme' } : { value: v, unit: '' }; },
    hint: 'Risk för ytvatten vid låga punkter',
    body: 'Prognosen visar en timme med intensivt regn. Dagvattnet kan ha svårt att rinna undan.',
    action: 'Rensa dagvattenbrunnar och kontrollera låga punkter som källarnedgångar och garageinfarter.',
  },
  thunder: {
    cat: 'other', icon: 'bolt', split: keep('risk för åska'), hint: null,
    body: 'Prognosen anger förhöjd sannolikhet för åska under det kommande dygnet.',
    action: 'Bevaka utvecklingen. Åska kan ge lokala skyfall och strömavbrott.',
  },
  snow: {
    cat: 'rain', icon: 'snow', split: (v) => ({ value: v.replace(/^ca\s+/, ''), unit: 'snö / 24 h' }), hint: 'Planera snöröjning',
    body: 'Prognosen visar snöfall under det kommande dygnet.',
    action: 'Säkerställ snöröjning och sandning av entréer och bevaka snölasten på tak.',
  },
  ice: {
    cat: 'temp', icon: 'frost', split: () => ({ value: 'Halka', unit: 'risk' }), hint: 'Risk för halka vid entréer',
    body: 'Nederbörd faller nära eller strax efter minusgrader, vilket kan ge isbildning.',
    action: 'Sanda entréer, trappor och gångytor och kontrollera takfot och stuprör för is.',
  },
  'freeze-thaw': {
    cat: 'temp', icon: 'cycle', split: keep('nollgenomgångar / 48 h'), hint: 'Kan ge is och istappar på tak',
    body: 'Temperaturen pendlar runt noll flera gånger. Smältvatten kan frysa på nytt vid takfot och stuprör.',
    action: 'Bevaka takfot och stuprör för istappar och beställ snö- och isröjning vid behov.',
  },
  frost: {
    cat: 'temp', icon: 'frost', split: keep('lägsta temp'), hint: 'Kontrollera frysskydd',
    body: 'Prognosen visar minusgrader vid fastigheten. Skuggiga ytor kan få frost.',
    action: 'Kontrollera frysskydd på utvändiga vattenledningar och sanda skuggiga gångytor.',
  },
};
const PREFIXES = ['intense-rain', 'freeze-thaw', 'thunder', 'snow', 'ice', 'gust', 'rain', 'frost'];

const OFFICIAL_ACTION: Record<UpcomingCat, string> = {
  wind: KINDS.gust!.action,
  rain: KINDS['intense-rain']!.action,
  temp: KINDS.ice!.action,
  water: 'Kontrollera pumpar, brunnar och källardörrar mot vatten och flytta känsligt material från källarplan.',
  other: 'Läs varningen hos källan och följ myndigheternas råd.',
};

const OFFICIAL_ICON: Record<UpcomingCat, IconKey> = { wind: 'wind', rain: 'rain', temp: 'frost', water: 'water', other: 'alert' };

function officialCat(label: string): UpcomingCat {
  const l = label.toLowerCase();
  if (/vind|storm|by/.test(l)) return 'wind';
  if (/vatten|flöde|översväm|havsnivå/.test(l)) return 'water';
  if (/regn|skyfall|åska|snö/.test(l)) return 'rain';
  if (/halka|is\b|isbild|kyla|frost|temperatur|värme/.test(l)) return 'temp';
  return 'other';
}

const SOURCE_SV: Record<string, string> = { krisinformation: 'Krisinformation', smhi_warnings: 'SMHI', smhi_forecast: 'SMHI', smhi_oceanography: 'SMHI' };
const stripTag = (label: string) => label.replace(/\s*\((prognos)[^)]*\)\s*$/i, '').trim();
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayLong = new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone: DISPLAY_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'short' });
const dayKey = (iso: string) => dayFmt.format(new Date(iso));

export interface UpcomingEvent {
  id: string;
  cat: UpcomingCat;
  catLabel: string;
  icon: string;
  tone: Tone;
  toneLabel: string;
  c: string;
  bg: string;
  fg: string;
  /** Warning or worse: coloured value, counted under "Riskvarningar". */
  hot: boolean;
  official: boolean;
  name: string;
  propertyId: string | null;
  day: string | null;
  /** Start time (ms) when known; null for whole-period rows ("Närmaste 24 h"). */
  at: number | null;
  t: string;
  title: string;
  /** Small muted tag after the title: "prognos" or "officiell varning". */
  tag: string;
  value: string;
  unit: string;
  meta: string;
  hint: string | null;
  headline: string;
  body: string;
  action: string;
  whenLong: string;
  /** Lowest temperature for frost rows, used by the "Lägsta temp" tile. */
  tmin: number | null;
}

export function buildUpcomingEvents(portfolio: Portfolio, propertyIds: Set<string>): UpcomingEvent[] {
  return portfolio.upcoming
    .filter((u) => !u.propertyId || propertyIds.has(u.propertyId))
    .map((u): UpcomingEvent => {
      const prefix = PREFIXES.find((p) => u.id.startsWith(p + '-'));
      const kind = !u.official && prefix ? KINDS[prefix]! : null;
      const cat = kind?.cat ?? (u.official ? officialCat(u.label) : 'other');
      const tone = TONE[u.tone];
      const src = (u.sourceId && SOURCE_SV[u.sourceId]) || 'SMHI';
      const split = kind ? kind.split(u.value) : u.official ? { value: u.value.replace(/\s*varning$/i, ''), unit: u.value.toLowerCase().includes('varning') ? 'varning' : '' } : { value: u.value, unit: '' };
      const temp = prefix === 'frost' ? Number(u.value.replace('−', '-').replace(',', '.').replace(/[^\d.-]/g, '')) : NaN;
      const day = u.validAt ? dayKey(u.validAt) : null;
      return {
        id: u.id,
        cat,
        catLabel: UPCOMING_CAT_LABEL[cat],
        icon: UPCOMING_ICON[kind?.icon ?? OFFICIAL_ICON[cat]],
        tone: u.tone,
        toneLabel: tone.label,
        c: tone.c,
        bg: tone.bg,
        fg: tone.fg,
        hot: u.tone === 'warning' || u.tone === 'critical',
        official: !!u.official,
        name: u.where,
        propertyId: u.propertyId ?? null,
        day,
        at: u.validAt ? Date.parse(u.validAt) : null,
        t: u.when === 'Närmaste 24 h' ? '24 h' : u.validAt ? formatClock(u.validAt) : u.when,
        title: stripTag(u.label),
        tag: u.official ? 'officiell varning' : 'prognos',
        value: split.value,
        unit: split.unit,
        meta: `${src} · uppdaterad ${formatClock(u.sourceUpdatedAt ?? null)}`,
        hint: kind ? (u.explanation ? u.explanation[0]!.toUpperCase() + u.explanation.slice(1) : kind.hint) : null,
        headline: u.official ? `${u.value}, ${stripTag(u.label).toLowerCase()}` : stripTag(u.label),
        body: kind ? kind.body : `${src} har utfärdat en varning som börjar gälla ${u.when}.`,
        action: kind?.action ?? OFFICIAL_ACTION[cat],
        whenLong: `${u.when} · ${src} ${u.official ? 'varning' : 'prognos'}`,
        tmin: Number.isFinite(temp) ? temp : null,
      };
    });
}

const HOURS_48 = 48 * 3_600_000;

/** "2 riskvarningar, frost ner till −3° och 1 annan händelse de kommande 48 h". */
function summaryOf(events: UpcomingEvent[]): string {
  if (!events.length) return 'Inget över tröskelvärdena de kommande 48 h.';
  const hot = events.filter((e) => e.hot).length;
  const cold = events.filter((e) => e.tmin !== null).sort((a, b) => a.tmin! - b.tmin!)[0];
  const rest = events.length - hot - (cold && !cold.hot ? 1 : 0);
  const parts: string[] = [];
  if (hot) parts.push(`${hot} ${hot === 1 ? 'riskvarning' : 'riskvarningar'}`);
  if (cold) parts.push(`frost ner till ${cold.tmin! < 0 ? '−' : ''}${Math.abs(cold.tmin!)}°`);
  if (rest > 0) parts.push(`${rest} ${parts.length ? (rest === 1 ? 'annan händelse' : 'andra händelser') : rest === 1 ? 'händelse' : 'händelser'}`);
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} och ${parts.at(-1)}` : parts[0]!;
  return `${text.replace(/^./, (c) => c.toUpperCase())} de kommande 48 h`;
}

export function upcomingView(events: UpcomingEvent[], referenceIso: string) {
  const ref = Date.parse(referenceIso);
  const today = dayKey(referenceIso);
  const tomorrow = dayKey(new Date(ref + 24 * 3_600_000).toISOString());

  const dayLabel = (d: string | null) => (d === null || d <= today ? 'Idag' : d === tomorrow ? 'Imorgon' : null);
  const days: Array<{ key: string; label: string; date: string; count: string; items: UpcomingEvent[] }> = [];
  for (const e of events) {
    const key = e.day === null || e.day < today ? today : e.day;
    let g = days.find((x) => x.key === key);
    if (!g) {
      const long = dayLong.format(new Date(`${key}T12:00:00Z`)).replace('.', '');
      const label = dayLabel(key) ?? long.split(' ')[0]!.replace(/^./, (c) => c.toUpperCase());
      g = { key, label, date: long, count: '', items: [] };
      days.push(g);
    }
    g.items.push(e);
  }
  days.sort((a, b) => a.key.localeCompare(b.key));
  for (const g of days) {
    // Within a day: whole-period rows first, then by start time; warnings before info at the same time.
    g.items.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || Number(b.hot) - Number(a.hot));
    g.count = `${g.items.length} ${g.items.length === 1 ? 'händelse' : 'händelser'}`;
  }

  // 48 h strip: one dot per row at its start (whole-period rows sit at "Nu"), ticks at midnight.
  const pos = (ms: number) => Math.min(1, Math.max(0, (ms - ref) / HOURS_48));
  const dots = days.flatMap((g) => g.items).map((e) => ({ id: e.id, pos: e.at === null ? 0 : pos(e.at), c: e.c, hot: e.hot, label: `${e.title}, ${e.name}, ${e.t}` }));
  // Midnight in Stockholm: where the local day changes (found in 15-minute steps).
  const midnights: number[] = [];
  let current = today;
  for (let t = ref + 15 * 60_000; t < ref + HOURS_48; t += 15 * 60_000) {
    const k = dayKey(new Date(t).toISOString());
    if (k !== current) {
      midnights.push(pos(t));
      current = k;
    }
  }

  return { summary: summaryOf(events), days, dots, midnights, empty: events.length === 0 };
}
export type UpcomingView = ReturnType<typeof upcomingView>;
