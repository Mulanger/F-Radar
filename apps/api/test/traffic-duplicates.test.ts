import { describe, expect, it } from 'vitest';
import { groupDuplicates, mergedTrafficTitle, sameTrafficEvent, trafficRoad, type DuplicateKey } from '../src/monitoring/traffic-duplicates';
import { buildFeed } from '../src/monitoring/snapshot';

const FROM = Date.parse('2026-10-07T06:00:00Z');
const TO = Date.parse('2026-11-20T16:00:00Z');
const NEAR = 'Bergiusvägen nära Frescativägen i Stockholm kommun';
const BETWEEN = 'Bergiusvägen mellan Frescativägen och E18.20 (Frescatiavfarten)/E18.20 (Ekhagsavfarten) i Stockholm kommun';
const key = (over: Partial<DuplicateKey>): DuplicateKey => ({ sourceId: 'trafikverket', situationId: null, eventType: 'Vägarbete', headline: `Vägarbete: ${NEAR}`, validFrom: FROM, validTo: TO, point: { lat: 59.37057, lon: 18.05136 }, ...over });

// The four live rows from 2026-11-18: two situations (one per direction) × "Vägarbete" + "Vägen avstängd".
const bergius = [
  key({ situationId: 'A', eventType: 'Vägarbete', headline: `Vägarbete: ${NEAR}` }),
  key({ situationId: 'A', eventType: 'Vägen avstängd', headline: `Vägen avstängd: ${NEAR}` }),
  key({ situationId: 'B', eventType: 'Vägen avstängd', headline: `Vägen avstängd: ${BETWEEN}`, validFrom: FROM + 160_000, point: { lat: 59.37050, lon: 18.05140 } }), // the other direction, ~9 m away, entered 3 min later
  key({ situationId: 'B', eventType: 'Vägarbete', headline: `Vägarbete: ${BETWEEN}`, validFrom: FROM + 160_000, point: { lat: 59.37050, lon: 18.05140 } }), // the other direction, ~9 m away
];

describe('Trafikverket duplicates', () => {
  it('folds both directions and cause + effect of one closure into one', () => {
    const groups = groupDuplicates(bergius, (k) => k);
    expect(groups).toHaveLength(1);
    expect(mergedTrafficTitle(groups[0]!.map((k) => ({ eventType: k.eventType, headline: k.headline })))).toBe(`Vägarbete, vägen avstängd: ${NEAR}`);
  });

  it('never merges different roads, other dates, far-apart places or other sources', () => {
    expect(trafficRoad(`Vägarbete: ${BETWEEN}`)).toBe('bergiusvägen');
    expect(trafficRoad('Vägarbete: Väg 75 från Trafikplats Åbyvägen till Nackatråget')).toBe('väg 75');
    expect(sameTrafficEvent(bergius[0]!, key({ headline: 'Vägarbete: Frescativägen nära Bergiusvägen' }))).toBe(false);
    expect(sameTrafficEvent(bergius[0]!, key({ validTo: TO + 86_400_000 }))).toBe(false);
    expect(sameTrafficEvent(bergius[0]!, key({ validFrom: FROM + 2 * 3_600_000 }))).toBe(false);
    expect(sameTrafficEvent(bergius[0]!, key({ point: { lat: 59.3800, lon: 18.0514 } }))).toBe(false); // ~1 km away
    expect(sameTrafficEvent(bergius[0]!, key({ eventType: 'Olycka', headline: `Olycka: ${NEAR}` }))).toBe(false);
    expect(sameTrafficEvent(key({ sourceId: 'sl_deviations' }), key({ sourceId: 'sl_deviations' }))).toBe(false);
    // Same situation always belongs together.
    expect(sameTrafficEvent(bergius[0]!, key({ situationId: bergius[0]!.situationId, eventType: 'Vägen avstängd', validTo: null }))).toBe(true);
  });

  it('shows one feed row for duplicates that arrive together – not for other properties or batches', () => {
    const at = new Date('2026-11-18T15:50:00Z');
    const row = (id: string, k: DuplicateKey, over: Record<string, unknown> = {}) => ({
      id, property_id: 'p1', source_id: 'trafikverket', change_type: 'new', severity: 'warning', headline: k.headline, created_at: at,
      event_type: k.eventType, situation_id: k.situationId, event_valid_from: new Date(FROM), event_valid_to: new Date(TO), ...over,
    });
    const feed = buildFeed([...bergius.map((k, i) => row(String(i + 1), k)), row('9', bergius[0]!, { property_id: 'p2' }), row('10', bergius[0]!, { created_at: new Date(at.getTime() + 3_600_000) })], new Set(['p1', 'p2']));
    expect(feed.map((f) => f.title)).toEqual([`Ny: Vägarbete: ${NEAR}`, `Ny: Vägarbete, vägen avstängd: ${NEAR}`, `Ny: Vägarbete: ${NEAR}`]);
    expect(feed.map((f) => f.propertyId)).toEqual(['p1', 'p1', 'p2']);
  });

  it('keeps the first visible traffic card across later versions and its end', () => {
    const row = (id: string, minute: number, change_type: string, severity: string, headline = 'Olycka: E14 vid Odenskog') => ({
      id, property_id: 'p1', event_id: 'accident', source_id: 'trafikverket', change_type, severity, headline,
      created_at: new Date(Date.UTC(2026, 10, 19, 15, minute)),
    });
    const initial = row('1', 30, 'new', 'info');
    const first = row('2', 36, 'updated', 'warning');
    const latest = row('3', 41, 'updated', 'info', 'Olycka: Påfarten vid Odenskog avstängd');
    const ended = { ...row('4', 57, 'ended', 'info'), event_ended_on_map: true };
    const otherProperty = { ...first, id: '5', property_id: 'p2' };
    const propertyIds = new Set(['p1', 'p2']);
    expect(buildFeed([initial], propertyIds)).toEqual([]);
    expect(buildFeed([first, initial], propertyIds)[0]).toMatchObject({ title: `Ny: ${first.headline}`, publishedAt: first.created_at.toISOString() });
    const [active] = buildFeed([latest, first, initial], propertyIds);
    expect(active).toMatchObject({ id: 'chg-3', title: `Ny: ${first.headline}`, publishedAt: first.created_at.toISOString(), updatedAt: latest.created_at.toISOString() });
    const feed = buildFeed([ended, latest, first, otherProperty, initial], propertyIds);
    expect(feed).toHaveLength(2);
    const closed = feed.find((item) => item.propertyId === 'p1');
    expect(closed).toMatchObject({ id: 'chg-4', title: `Avslutad: ${first.headline}`, publishedAt: first.created_at.toISOString(), updatedAt: latest.created_at.toISOString(), eventEndedOnMap: true });
    expect(feed.find((item) => item.propertyId === 'p2')?.updatedAt).toBeUndefined();
  });
});

describe('situations Trafikverket replaced by a new one', () => {
  // Väg 75 at Palandergatan, 2026-11-18: the 19–20 Nov night closure ended 21:28 and came back 21:33.
  const night = { event_valid_from: new Date('2026-11-19T21:00:00Z'), event_valid_to: new Date('2026-11-20T04:00:00Z') };
  const v75 = (id: string, change: string, at: string, type: string, event: string, over: Record<string, unknown> = {}) => ({
    id, property_id: 'p1', source_id: 'trafikverket', change_type: change, severity: 'warning', created_at: new Date(at), event_id: event,
    event_type: type, headline: `${type}: Väg 75 från Trafikplats Åbyvägen till Nackatråget`, situation_id: event.slice(0, 3), ...night, ...over,
  });
  const rows = [
    v75('838', 'new', '2026-11-18T20:33:34Z', 'Vägen avstängd', 'new-a'),
    v75('839', 'new', '2026-11-18T20:33:34Z', 'Vägarbete', 'new-b'),
    v75('836', 'ended', '2026-11-18T20:28:28Z', 'Vägen avstängd', 'old-a'),
    v75('837', 'ended', '2026-11-18T20:28:28Z', 'Vägarbete', 'old-b'),
  ];

  it('hides "Avslutad" and "Ny" when nothing changed', async () => {
    const { replacedTraffic } = await import('../src/monitoring/traffic-duplicates');
    expect([...replacedTraffic(rows).hidden].sort()).toEqual(['836', '837', '838', '839']);
    expect(buildFeed(rows, new Set(['p1']))).toEqual([]);
  });

  it('shows "Uppdaterad" when the replacement has other times, and keeps a real end', () => {
    const moved = rows.map((r) => (r.change_type === 'new' ? { ...r, event_valid_to: new Date('2026-11-20T06:30:00Z') } : r));
    expect(buildFeed(moved, new Set(['p1'])).map((f) => f.title)).toEqual(['Uppdaterad: Vägen avstängd, vägarbete: Väg 75 från Trafikplats Åbyvägen till Nackatråget']);
    // An end with no new situation for the same closure stays "Avslutad".
    expect(buildFeed(rows.filter((r) => r.change_type === 'ended'), new Set(['p1'])).map((f) => f.title)).toEqual(['Avslutad: Vägen avstängd, vägarbete: Väg 75 från Trafikplats Åbyvägen till Nackatråget']);
    // A new closure on another night is not a replacement.
    const otherNight = rows.map((r) => (r.change_type === 'new' ? { ...r, event_valid_from: new Date('2026-11-20T21:00:00Z'), event_valid_to: new Date('2026-11-21T04:00:00Z') } : r));
    expect(buildFeed(otherNight, new Set(['p1'])).map((f) => f.title.split(':')[0])).toEqual(['Ny', 'Avslutad']);
  });

  it('puts the night label on the feed row', () => {
    const [f] = buildFeed(rows.filter((r) => r.change_type === 'ended'), new Set(['p1']));
    expect(f!.nightWork).toBe('Nattarbete 22–05');
  });
});

describe('planned ends of night work', () => {
  // Södra Länken påfart, 17→18 Nov 22:00–05:00 (Stockholm), ended 05:06 – then a new closure for the next night.
  const night = { event_valid_from: new Date('2026-11-17T21:00:00Z'), event_valid_to: new Date('2026-11-18T04:00:00Z') };
  const row = (id: string, change: string, at: string, over: Record<string, unknown> = {}) => ({
    id, property_id: 'p1', source_id: 'trafikverket', change_type: change, severity: 'warning', created_at: new Date(at), event_id: `e${id}`,
    event_type: 'Påfart', headline: 'Påfart: Södra Länken Infart Murartunneln', situation_id: `s${id}`, ...night, ...over,
  });

  it('hides "Avslutad" when a night closure ends as planned, keeps its "Ny"', () => {
    const feed = buildFeed([row('823', 'ended', '2026-11-18T04:06:00Z'), row('818', 'new', '2026-11-17T21:00:00Z')], new Set(['p1']));
    expect(feed.map((f) => f.title.split(':')[0])).toEqual(['Ny']);
  });

  it('still shows a night closure that is called off early, and ordinary ends', () => {
    expect(buildFeed([row('900', 'ended', '2026-11-17T22:00:00Z')], new Set(['p1'])).map((f) => f.title.split(':')[0])).toEqual(['Avslutad']);
    const day = { event_valid_from: new Date('2026-11-18T06:00:00Z'), event_valid_to: new Date('2026-11-18T15:00:00Z') };
    expect(buildFeed([row('901', 'ended', '2026-11-18T15:05:00Z', day)], new Set(['p1'])).map((f) => f.title.split(':')[0])).toEqual(['Avslutad']);
  });
});
