import { describe, expect, it } from 'vitest';
import { PropertyEventMapSchema, eventPlaceFromHeadline, trafficMapStyle } from '@fastighetsradar/domain';
import { listPropertyEventMap, type Queryable } from '@fastighetsradar/db';

const ORG = '00000000-0000-4000-8000-00000000000a';
const PID = '11111111-1111-4111-8111-111111111111';

describe('property event map ("Visa på karta")', () => {
  it('reads only the organization’s matched, active traffic events and keeps the published geometry', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db: Queryable = {
      async query<R>(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        return {
          rows: [
            {
              event_id: '42', source_id: 'trafikverket', event_type: 'Vägarbete', headline: 'Vägarbete: Götgatan från Åsögatan till Folkungagatan', description: 'Ett körfält avstängt.',
              area_label: null, valid_from: new Date('2026-11-10T06:00:00Z'), valid_to: new Date('2026-11-21T16:00:00Z'),
              extra: { messageCodeValue: 'roadworks', iconId: 'roadwork', severityText: 'Stor påverkan', transportMode: 'road' },
              geometry: { type: 'LineString', coordinates: [[18.0725, 59.3135], [18.0731, 59.3141]] }, length_m: 72,
            },
            { event_id: '43', source_id: 'trafikverket', event_type: 'Olycka', headline: 'Olycka: E4', description: null, area_label: 'E4', valid_from: null, valid_to: null, extra: { messageCodeValue: 'accident', iconId: 'roadAccident' }, geometry: { type: 'Point', coordinates: [18.0, 59.37] }, length_m: null },
            // Not drawable as a stretch or point: left out instead of failing the response.
            { event_id: '44', source_id: 'trafikverket', event_type: 'X', headline: 'X', description: null, area_label: null, valid_from: null, valid_to: null, extra: {}, geometry: { type: 'GeometryCollection', geometries: [] }, length_m: null },
          ] as R[],
        };
      },
    };
    const items = await listPropertyEventMap(db, ORG, PID);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toMatch(/p\.organization_id = \$1/);
    expect(calls[0]!.sql).toMatch(/m\.organization_id = \$1 AND m\.property_id = \$2/);
    expect(calls[0]!.sql).toContain("e.status = 'active'");
    expect(calls[0]!.sql).toContain("e.source_id IN ('trafikverket', 'sl_deviations')");
    expect(calls[0]!.params.slice(0, 2)).toEqual([ORG, PID]);
    expect(items.map((i) => i.eventId)).toEqual(['42', '43']);
    expect(items[0]).toMatchObject({ label: 'Vägarbete', icon: 'roadwork', hue: 'red', impact: 'Stor påverkan', where: 'Götgatan från Åsögatan till Folkungagatan', lengthM: 72, validTo: '2026-11-21T16:00:00.000Z' });
    expect(items[1]).toMatchObject({ icon: 'accident', hue: 'red', where: 'E4', lengthM: null, impact: null });
    expect(PropertyEventMapSchema.parse({ propertyId: PID, items }).items).toHaveLength(2);
  });

  it('styles Trafikverket message codes', () => {
    expect(trafficMapStyle({ sourceId: 'trafikverket', messageCodeValue: 'roadClosed', iconId: 'roadClosed' })).toEqual({ icon: 'closed', hue: 'red' });
    expect(trafficMapStyle({ sourceId: 'trafikverket', messageCodeValue: 'laneClosures', iconId: 'trafficMessage' })).toEqual({ icon: 'lanes', hue: 'red' });
    expect(trafficMapStyle({ sourceId: 'trafikverket', messageCodeValue: 'resurfacingWork', iconId: 'roadwork' })).toEqual({ icon: 'roadwork', hue: 'red' });
    expect(trafficMapStyle({ sourceId: 'trafikverket', messageCodeValue: 'queuingTraffic', iconId: 'trafficJamMessage' })).toEqual({ icon: 'queue', hue: 'orange' });
    expect(trafficMapStyle({ sourceId: 'trafikverket', messageCodeValue: 'speedRestrictionInOperation', iconId: 'trafficMessage' })).toEqual({ icon: 'speed', hue: 'orange' });
    expect(trafficMapStyle({ sourceId: 'trafikverket', messageCodeValue: 'animalsOnTheRoad' })).toEqual({ icon: 'animal', hue: 'orange' });
    expect(trafficMapStyle({ sourceId: 'trafikverket', messageCodeValue: null, iconId: 'ferryDepartureDelayed', transportMode: 'road_ferry' })).toEqual({ icon: 'ferry', hue: 'blue' });
    expect(trafficMapStyle({ sourceId: 'sl_deviations' })).toEqual({ icon: 'transit', hue: 'orange' });
    expect(trafficMapStyle({ sourceId: 'trafikverket', messageCodeValue: 'somethingNew' })).toEqual({ icon: 'info', hue: 'orange' });
  });

  it('takes the place from the headline', () => {
    expect(eventPlaceFromHeadline('Vägen avstängd: Bergiusvägen nära Frescativägen', 'Vägen avstängd')).toBe('Bergiusvägen nära Frescativägen');
    expect(eventPlaceFromHeadline('Trafikhändelse', 'Trafikhändelse')).toBeNull();
  });
});
