import { describe, expect, it } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import type { PropertySnapshot, UtilityOutageView } from '@fastighetsradar/domain';
import { buildUpcoming } from '../src/monitoring/snapshot';
import { propertyUtilityStatus, type OperatorStatus } from '../src/monitoring/utility-outages';
import { municipalWaterProvider } from '../src/monitoring/water-operators';
import { operatorById } from '@fastighetsradar/integrations';
import { buildUtilityCoverageReport } from '@fastighetsradar/domain';
const now = new Date('2026-11-19T10:00:00Z');
const view: UtilityOutageView = { id: 'u', operatorId: 'va', operatorName: 'VA', utility: 'water', kind: 'planned', state: 'upcoming', noticeKind: 'outage', lastSeenAt: now.toISOString(), matchMethod: 'outage_polygon', precisionLevel: 'medium', precisionLabel: 'Ungefärligt läge', severity: 'monitor', distanceMeters: null, affectedCustomers: null, areaCustomerTotal: null, reportedAt: null, plannedStart: '2026-11-20T08:00:00Z', plannedEnd: '2026-11-20T10:00:00Z', actualStart: null, estimatedRestore: null, restoredAt: null, restoredInferred: false, operatorText: 'Leverantörens text', cause: null, placeLabel: null, sourceUrl: 'https://example.test/drift', geometry: null };
const snapshot = (v: Partial<UtilityOutageView> = {}): PropertySnapshot => ({ ...demoPortfolio.properties[0]!, warnings: [], utilityOutages: [{ utility: 'water', operator: null, coverage: 'unknown', updatedAt: null, current: [], upcoming: [{ ...view, ...v }], nearby: [], recentlyRestored: [] }] });
describe('supply completeness and conservative upcoming conditions', () => {
  it('shows planned water only with explicit opt-in, exact or medium match, fresh data and known interval', () => {
    expect(loadServerEnv({}).UTILITY_OUTAGE_UPCOMING_ENABLED).toBe(false);
    expect(buildUpcoming([snapshot()], [], now)).toEqual([]);
    const r = buildUpcoming([snapshot()], [], now, true);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'outage', sourceId: 'utility_outages', sourceName: 'VA', validAt: view.plannedStart, validTo: view.plannedEnd, explanation: view.operatorText });
    for (const overrides of [{ precisionLevel: 'area' }, { precisionLevel: 'low' }, { plannedEnd: null }, { plannedStart: '2026-11-22T10:00:00Z' }, { state: 'restored' }, { utility: 'gas' }, { noticeKind: 'information' }, { lastSeenAt: undefined }, { lastSeenAt: '2026-11-19T09:00:00Z' }] as Array<Partial<UtilityOutageView>>) expect(buildUpcoming([snapshot(overrides)], [], now, true)).toEqual([]);
    expect(buildUpcoming([snapshot({ utility: 'district_heating' })], [], now, true)).toEqual([]);
  });
  it('does not reuse electricity concessions for other utilities or invent gas service from municipality', () => {
    const inputs = { outages: [], concessions: [{ property_id: 'p', operator_id: 'goteborg_energi', utility: 'electricity' as const }], operators: [], municipalities: [{ property_id: 'p', municipality: 'Göteborg' }] };
    for (const utility of ['gas', 'district_heating', 'district_cooling'] as const) expect(propertyUtilityStatus('p', inputs, utility).coverage).toBe('unknown');
    expect(propertyUtilityStatus('p', inputs, 'water')).toMatchObject({ coverage: 'not_monitored', operator: { id: 'servicealert:goteborg' } });
  });
  it.each([
    ['Stockholms kommun', 'svoa'], ['Huddinge', 'svoa'], ['Linköpings stad', 'tekniskaverken'],
    ['Söderhamn', 'servicealert:soderhamn'], ['Oxelösund', 'servicealert:oxelo'],
    ['Emmaboda', 'servicealert:emmaboda'], ['Eskilstuna', 'servicealert:eem'],
    ['Ljusdal', 'servicealert:ljusdal'], ['Ulricehamns kommun', 'servicealert:ulricehamn'],
    ['Göteborgs Stad', 'servicealert:goteborg'], ['Båstad', 'nsva'], ['Örkelljunga kommun', 'nsva'],
    ['Västerås stad', 'servicealert:malarenergi-va'], ['Gävle kommun', 'servicealert:gastrike-vatten'],
    ['Älvkarleby', 'servicealert:gastrike-vatten'], ['Sundsvall', 'servicealert:msva'],
    ['Timrå kommun', 'servicealert:msva'], ['Växjö', 'servicealert:vaxjo-va'],
    ['Luleå', 'servicealert:lumire'], ['Mölndals stad', 'servicealert:molndal-va'],
  ])('maps %s to an existing water operator', (municipality, id) => {
    expect(municipalWaterProvider(municipality)?.id).toBe(id);
    expect(operatorById(id)?.utilities).toContain('water');
  });
  it('separates known unreadable sources from unknown ones in the coverage report', () => {
    const statuses = ['Norrköpings kommun', 'Upplands Väsby', 'Jönköping', 'Mölndal'].map((municipality) =>
      propertyUtilityStatus('p', { outages: [], concessions: [], operators: [], municipalities: [{ property_id: 'p', municipality }] }, 'water'));
    expect(statuses.map((s) => s.coverage)).toEqual(['no_readable_source', 'no_readable_source', 'unknown', 'not_monitored']);
    expect(statuses[0]?.operator?.name).toBe('Nodra');
    const report = buildUtilityCoverageReport(statuses.map((status, i) => ({
      id: String(i), geocodePrecision: 'building', positionSource: 'geocoded', statuses: [status],
    })), 'water');
    expect(report).toMatchObject({ total: 4, monitored: 0, noReadableSource: 2, unknown: 1, notMonitored: 1 });
  });
  it('municipal water coverage requires the water utility itself enabled and a current complete source', () => {
    const op: OperatorStatus = { operatorId: 'svoa', name: 'SVOA', mapUrl: 'https://example.test', utilities: ['water'], enabledUtilities: ['water'], enabled: true, current: true, lastSuccessAt: now.toISOString(), lastStatus: 'ok', errorCode: null, attention: null };
    const inputs = { outages: [], concessions: [], operators: [op], municipalities: [{ property_id: 'p', municipality: 'Stockholms kommun' }] };
    expect(propertyUtilityStatus('p', inputs, 'water').coverage).toBe('monitored');
    expect(propertyUtilityStatus('p', { ...inputs, operators: [{ ...op, current: false }] }, 'water').coverage).toBe('stale');
    expect(propertyUtilityStatus('p', { ...inputs, operators: [{ ...op, enabledUtilities: [] }] }, 'water').coverage).toBe('not_monitored');
    expect(propertyUtilityStatus('p', { ...inputs, municipalities: [] }, 'water').coverage).toBe('unknown');
  });
});
