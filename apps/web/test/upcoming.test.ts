import { describe, expect, it } from 'vitest';
import { formatPropertyAddress, type Portfolio } from '@fastighetsradar/domain';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import { buildUpcomingEvents, searchUpcomingRows, upcomingCenter, upcomingView, whenPhrase } from '../lib/view-models/upcoming';
import { darkSpans, sunTimes } from '../lib/view-models/daylight';

const ids = (p: Portfolio) => new Set(p.properties.map((s) => s.property.id));
const ref = demoPortfolio.generatedAt; // ons 12 nov 14:32
const H = 3_600_000;

describe('kommande förhållanden – events', () => {
  it('shows planned shutdowns with their own chip, exact interval and provider attribution', () => {
    const start = new Date(Date.parse(ref) + H).toISOString(), end = new Date(Date.parse(ref) + H + 5 * 60000).toISOString();
    const p: Portfolio = { ...demoPortfolio, upcoming: [{ id: 'outage-test', kind: 'outage', label: 'Planerad vattenavstängning', where: 'Testfastigheten', when: 'Imorgon', value: 'Planerad avstängning', validAt: start, validTo: end, sourceId: 'utility_outages', sourceName: 'VA-bolaget', sourceUrl: 'https://example.test/drift', explanation: 'Leverantörens ordagranna text.', origin: 'live', tone: 'monitor' }] };
    const rows = buildUpcomingEvents(p, ids(p));
    expect(rows[0]).toMatchObject({ kind: 'outage', src: 'VA-bolaget · avbrottsinformation', start: Date.parse(start), end: Date.parse(end), sourceUrl: 'https://example.test/drift' });
    expect(rows[0]!.note).toBe('Leverantörens text: Leverantörens ordagranna text.');
    expect(rows[0]!.note).not.toContain('SMHI');
    expect(upcomingView(rows, ref).chips.some((c) => c.label === 'Avstängningar')).toBe(true);
  });
  const events = buildUpcomingEvents(demoPortfolio, ids(demoPortfolio));
  const by = (prefix: string) => events.find((e) => e.id.startsWith(prefix))!;

  it('gives every condition a kind, a bar from start to end, a value and a note', () => {
    expect(by('frost-')).toMatchObject({ kind: 'frost', value: '−3°', unit: 'lägst', tmin: -3, src: 'SMHI · prognos' });
    expect(by('freeze-thaw-')).toMatchObject({ kind: 'freeze', value: '3×', unit: 'passerar 0°' });
    expect(by('ice-')).toMatchObject({ kind: 'ice', value: '12 h', unit: 'varaktighet', rank: 3 });
    expect(by('intense-rain-')).toMatchObject({ kind: 'rain', value: '9 mm', unit: 'på en timme', hot: true });
    const wind = events.find((e) => e.official && e.label.includes('vind'))!;
    expect(wind).toMatchObject({ kind: 'warning', value: 'Orange', unit: 'varning', label: 'Orange varning · kraftig vind', rank: 1, src: 'SMHI · varning' });
    for (const e of events) {
      expect(e.end).toBeGreaterThan(e.start);
      expect(e.note.length).toBeGreaterThan(20);
      expect(e.from).toMatch(/^\S+ \d\d:\d\d$/);
    }
  });

  it('keeps only the properties in view', () => {
    const one = demoPortfolio.properties.find((s) => s.property.name === 'Ulvsunda Lager')!.property.id;
    expect(buildUpcomingEvents(demoPortfolio, new Set([one])).map((e) => e.name)).toEqual(['Ulvsunda Lager', 'Ulvsunda Lager']);
  });

  it.each([['-0.2°', '−0,2°'], ['−0°', '0°'], ['-0.01°', '0,0°']])('formats frost %s as %s in the row and headline', (value, expected) => {
    const source = demoPortfolio.upcoming.find((u) => u.id.startsWith('frost-'))!;
    const forecast = buildUpcomingEvents({ ...demoPortfolio, upcoming: [{ ...source, value }] }, ids(demoPortfolio));
    expect(forecast[0]).toMatchObject({ value: expected, unit: 'lägst' });
    expect(upcomingView(forecast, ref).headline).toContain(`Minusgrader ner till ${expected} i`);
  });

  it.each([
    ['Subway, Kampenhofgatan 2, 451 42 Uddevalla, Sverige', 'Kampenhofgatan 2, 451 42 Uddevalla'],
    ['Spånga, C, Sverige', 'Spånga'],
    ['Tving, K, Sverige', 'Tving'],
    ['Sveavägen 42, 11135 Stockholm', 'Sveavägen 42, 111 35 Stockholm'],
  ])('formats the saved address %s for display', (raw, formatted) => {
    expect(formatPropertyAddress(raw)).toBe(formatted);
  });
});

describe('kommande förhållanden – rows', () => {
  const events = buildUpcomingEvents(demoPortfolio, ids(demoPortfolio));
  const frost = events.find((e) => e.kind === 'frost')!;

  it('keeps one row per property even when many share a condition, and searches name and address', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...frost, id: `f${i}`, propertyId: `p${i}`, name: `Hus ${i}`, address: `Storgatan ${i}, Umeå` }));
    const rows = upcomingView(many, ref).rows;
    expect(rows).toHaveLength(30);
    expect(rows.every((r) => r.type === 'place')).toBe(true);
    expect(searchUpcomingRows(rows, ' STORGATAN 7, ').map((r) => r.name)).toEqual(['Hus 7']);
    expect(searchUpcomingRows(rows, 'hus 2').map((r) => r.name).sort()).toEqual(['Hus 2', 'Hus 20', 'Hus 21', 'Hus 22', 'Hus 23', 'Hus 24', 'Hus 25', 'Hus 26', 'Hus 27', 'Hus 28', 'Hus 29']);
    expect(searchUpcomingRows(rows, '   ')).toHaveLength(30);
  });
});

describe('kommande förhållanden – view', () => {
  const events = buildUpcomingEvents(demoPortfolio, ids(demoPortfolio));
  const center = upcomingCenter(demoPortfolio, ids(demoPortfolio));
  const v = upcomingView(events, ref, { center });

  it('leads with the most serious condition, where and from when', () => {
    expect(v.headline).toBe('Orange varning för kraftig vind i Augustendal Brygga från ikväll 18:00');
    // The other (yellow) warning first, then the next most serious kind.
    expect(v.subline).toBe('En officiell varning vid Sjöstaden Kaj. Risk för halka vid Torsviks Torg.');
    expect(upcomingView([], ref).headline).toBe('Inget över tröskelvärdena de kommande 48 h');
  });

  it('groups per property, most serious first, and places bars on the 48 h axis', () => {
    expect(v.rows[0]!.name).toBe('Augustendal Brygga');
    expect(v.rows.reduce((n, r) => n + r.events.length, 0)).toBe(events.length);
    const ulvsunda = v.rows.find((r) => r.name === 'Ulvsunda Lager')!;
    expect(ulvsunda.countText).toBe('2 händelser');
    for (const r of v.rows) for (const e of r.events) {
      expect(e.left).toBeGreaterThanOrEqual(0);
      expect(e.left + e.width).toBeLessThanOrEqual(1.0001);
    }
    // 24 h of rain from now: a bar from 0 to half the axis.
    const rain = v.rows.flatMap((r) => r.events).find((e) => e.id.startsWith('rain-'))!;
    expect(rain.left).toBe(0);
    expect(rain.width).toBeCloseTo(0.5, 3);
    expect(v.rows.flatMap((r) => r.events).find((e) => e.kind === 'freeze')!.cross).toBe(true);
    expect(v.countText).toBe(`${events.length} händelser · ${v.rows.length} platser`);
  });

  it('filters by kind with counted chips', () => {
    expect(v.chips[0]).toMatchObject({ k: 'all', label: 'Alla', n: events.length, active: true });
    expect(v.chips.map((c) => c.label)).toContain('Halka');
    const frost = upcomingView(events, ref, { filter: 'frost', center });
    expect(frost.rows.flatMap((r) => r.events).every((e) => e.kind === 'frost')).toBe(true);
    expect(frost.chips.find((c) => c.k === 'frost')!.active).toBe(true);
    // A kind that is no longer there falls back to "Alla".
    expect(upcomingView(events, ref, { filter: 'thunder' }).filter).toBe('all');
  });

  it('builds the axis: today, the midnights and six-hour ticks in Stockholm time', () => {
    expect(v.axis.now).toBe('Nu 14');
    expect(v.axis.today).toBe('Idag');
    expect(v.axis.midnights.map((m) => `${m.day} ${m.date}`)).toEqual(['Torsdag 13 nov', 'Fredag 14 nov']);
    expect(v.axis.midnights.map((m) => m.short)).toEqual(['Tor 13', 'Fre 14']);
    expect(v.axis.midnights[0]!.pos).toBeCloseTo((9 * H + 28 * 60_000 + 15 * 60_000 - 15 * 60_000) / (48 * H), 1);
    expect(v.axis.ticks.map((t) => t.label)).toEqual(['18', '06', '12', '18', '06', '12']);
  });

  it('shades darkness from sunset to sunrise', () => {
    // Stockholm, 12 Nov: sunset about 15:30, sunrise about 07:40 – so from 14:32, dark begins within the first hours.
    expect(v.night.length).toBe(2);
    const first = v.night[0]!;
    expect(first.start * 48).toBeGreaterThan(0.5);
    expect(first.start * 48).toBeLessThan(1.5);
    expect((first.end - first.start) * 48).toBeGreaterThan(15);
    expect((first.end - first.start) * 48).toBeLessThan(17);
    // Kiruna in December has no sunrise.
    expect(sunTimes(Date.parse('2025-12-20T11:00:00Z'), 67.85, 20.22)).toEqual({ polar: 'night' });
    expect(darkSpans(Date.parse('2025-12-20T00:00:00Z'), Date.parse('2025-12-22T00:00:00Z'), 67.85, 20.22)).toEqual([{ start: 0, end: 1 }]);
  });

  it('words when it starts', () => {
    const r = Date.parse(ref);
    expect(whenPhrase(r + 10 * 60_000, r)).toBe('redan nu');
    expect(whenPhrase(Date.parse('2025-11-12T16:00:00+01:00'), r)).toBe('från idag 16:00');
    expect(whenPhrase(Date.parse('2025-11-12T18:00:00+01:00'), r)).toBe('från ikväll 18:00');
    expect(whenPhrase(Date.parse('2025-11-13T02:00:00+01:00'), r)).toBe('från i natt 02:00');
    expect(whenPhrase(Date.parse('2025-11-13T09:00:00+01:00'), r)).toBe('från imorgon 09:00');
    expect(whenPhrase(Date.parse('2025-11-14T09:00:00+01:00'), r)).toBe('från fredag 09:00');
  });
});
