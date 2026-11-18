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
    expect(feed.map((f) => f.title)).toEqual([`Ny: Vägarbete, vägen avstängd: ${NEAR}`, `Ny: Vägarbete: ${NEAR}`, `Ny: Vägarbete: ${NEAR}`]);
    expect(feed.map((f) => f.propertyId)).toEqual(['p1', 'p2', 'p1']);
  });
});
