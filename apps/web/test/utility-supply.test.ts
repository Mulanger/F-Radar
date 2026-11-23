import { describe, expect, it } from 'vitest';
import type { PropertySnapshot, UtilityOutageView } from '@fastighetsradar/domain';
import { outageEventsFor, outageShapes } from '../lib/view-models/utility-outages';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';

const view: UtilityOutageView = {
  id: 'water-test', utility: 'water', operatorId: 'va', operatorName: 'VA-bolaget', noticeKind: 'information',
  kind: 'unknown', state: 'unknown', matchMethod: 'outage_area', precisionLevel: 'area', precisionLabel: 'Leverantörsmeddelande i området',
  severity: 'info', distanceMeters: null, affectedCustomers: null, areaCustomerTotal: null,
  reportedAt: null, plannedStart: null, plannedEnd: null, actualStart: null, estimatedRestore: null, restoredAt: null, restoredInferred: false,
  operatorText: 'Leverantörens egen text', cause: null, placeLabel: null, sourceUrl: 'https://example.test/drift',
  geometry: { type: 'Polygon', coordinates: [[[18, 59], [18.1, 59], [18.1, 59.1], [18, 59]]] },
};
const snapshot = (v: UtilityOutageView): Pick<PropertySnapshot, 'utilityOutages'> => ({ utilityOutages: [{ utility: 'water', operator: null, coverage: 'unknown', updatedAt: null, current: [v], upcoming: [], nearby: [], recentlyRestored: [] }] });

describe('water view models', () => {
  it('requires a direct match for general information and keeps the original text and times', () => {
    expect(outageEventsFor(snapshot(view))).toEqual([]);
    const row = outageEventsFor(snapshot({ ...view, matchMethod: 'outage_polygon', precisionLevel: 'high' }))[0]!;
    expect(row.kind).toBe('Vatten och avlopp');
    expect(row.title).toContain('Vatten- och avloppsmeddelande');
    expect(row.title).not.toContain('vattenavbrott');
    expect(row.when).toBe('Tid ej angiven av leverantören');
    expect(row.operatorText).toBe(view.operatorText);
    expect(row.areaOnly).toBe(false);
  });
  it('boiling advice has its own title and provider wording; precise geometry remains drawable', () => {
    const boiling = { ...view, noticeKind: 'boil_water' as const, severity: 'critical' as const, kind: 'unplanned' as const, state: 'ongoing' as const, matchMethod: 'outage_polygon' as const, precisionLevel: 'high' as const };
    const row = outageEventsFor(snapshot(boiling))[0]!;
    expect(row.title).toBe('Kokningsrekommendation – VA-bolaget');
    expect(row.when).toBe('Rekommendation från leverantören');
    expect(outageShapes(snapshot(boiling))[0]!.label).toBe(row.title);
    const area = { ...boiling, matchMethod: 'outage_area' as const, precisionLevel: 'area' as const };
    const property = demoPortfolio.properties[0]!.property;
    expect(outageEventsFor({ ...snapshot(area), property: { ...property, positionSource: 'manual_adjusted' } })).toHaveLength(1);
    expect(outageEventsFor({ ...snapshot(area), property: { ...property, positionSource: 'geocoded', geocode: { ...property.geocode, precision: 'street' } } })).toHaveLength(0);
  });
});
