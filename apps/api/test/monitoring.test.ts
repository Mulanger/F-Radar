import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { loadServerEnv } from '@fastighetsradar/config';
import { PortfolioSchema, PropertySnapshotSchema, type PropertyRecord } from '@fastighetsradar/domain';
import type { JobRow, OrgMonitoringData, Queryable } from '@fastighetsradar/db';
import { buildApp } from '../src/app';
import { MonitoringBus } from '../src/monitoring/bus';
import { MonitoringService } from '../src/monitoring/service';
import { buildFeed, buildPropertySnapshot, buildUpcoming, forecastSteps, buildForecast } from '../src/monitoring/snapshot';
import { freshnessOf, resolveRuntimeStatuses } from '../src/monitoring/status';
import { nextRunSeconds } from '../src/monitoring/jobs';
import type { AuthVerifier } from '../src/auth';

const NOW = new Date('2026-11-13T05:00:00Z');
const env = loadServerEnv({ NODE_ENV: 'test' });
const PID = '11111111-1111-4111-8111-111111111111';

const record: PropertyRecord = {
  id: PID,
  name: 'Sveavägen 42',
  address: 'Sveavägen 42, 111 35 Stockholm',
  location: { lat: 59.3367656, lon: 18.0627049 },
  positionSource: 'geocoded',
  geocode: { provider: 'geoapify', precision: 'building', confidence: 1, label: null, placeId: null, resultType: 'building', postcode: '11135', city: 'Stockholm', municipality: 'Stockholms kommun', geocodedAt: NOW.toISOString() },
  status: 'active',
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
};

function job(id: string, over: Partial<JobRow> = {}): JobRow {
  return {
    job_id: id, source_id: id, interval_seconds: 300, enabled: true, next_run_at: NOW, lease_owner: null, lease_until: null,
    last_started_at: NOW, last_finished_at: NOW, last_success_at: new Date(NOW.getTime() - 60_000), last_status: 'ok',
    last_error_code: null, last_error_detail: null, last_items: 10, last_duration_ms: 100, consecutive_failures: 0, source_updated_at: null, ...over,
  };
}

const steps = Array.from({ length: 30 }, (_, i) => ({
  time: new Date(NOW.getTime() + (i + 1) * 3_600_000).toISOString(),
  intervalStart: new Date(NOW.getTime() + i * 3_600_000).toISOString(),
  airTemperature: 2 - i * 0.2, windSpeed: 5, windGust: i === 5 ? 17 : 8, windDirection: 200, relativeHumidity: 90,
  precipitationMean: 1, precipitationMax: 2, precipitationProbability: 60, thunderProbability: 0, symbolCode: 6,
}));

const event = (over: Record<string, unknown>) => ({
  property_id: PID, match_method: 'polygon_intersection', distance_m: '0', first_matched_at: NOW,
  id: 'e1', source_id: 'smhi_warnings', external_id: '1:1', data_class: 'OFFICIAL_WARNING', category: 'Weather', level: 'Yellow', severity: 'monitor',
  event_type: 'Snö', headline: 'Snöfall', description: 'Officiell text', area_label: 'Stockholms län', published_at: NOW, source_updated_at: NOW,
  valid_from: NOW, valid_to: null, version: 1, source_url: 'https://smhi.se', attribution: 'Källa: SMHI', extra: {}, last_seen_at: NOW, point_lat: null, point_lon: null, ...over,
});

function data(over: Partial<OrgMonitoringData> = {}): OrgMonitoringData {
  return {
    forecasts: [{ property_id: PID, source_id: 'smhi_forecast', reference_time: NOW, created_time: NOW, grid_lat: 59.33, grid_lon: 18.07, distance_m: '812', series: { v: 1, steps }, fetched_at: NOW }],
    events: [],
    contexts: [],
    observations: [
      { property_id: PID, source_id: 'smhi_observations', parameter: 'air_temperature', station_id: '98230', name: 'Stockholm-Observatoriekullen A', value: 1.8, unit: '°C', observed_at: NOW, quality: 'G', extra: {}, fetched_at: NOW, distance_m: 900 },
      { property_id: PID, source_id: 'air_quality', parameter: 'pm25', station_id: '8780', name: 'Stockholm Hornsgatan 108 Gata', value: 3.4, unit: 'µg/m³', observed_at: NOW, quality: 'preliminary', extra: {}, fetched_at: NOW, distance_m: 2100 },
      { property_id: PID, source_id: 'air_quality', parameter: 'no2', station_id: 'far', name: 'Långt bort', value: 9, unit: 'µg/m³', observed_at: NOW, quality: 'preliminary', extra: {}, fetched_at: NOW, distance_m: 90_000 },
    ],
    counties: [{ property_id: PID, code: '01', name: 'Stockholms län' }],
    ...over,
  } as OrgMonitoringData;
}

describe('source runtime status', () => {
  it('is ok only after a fresh success; stale when old; degraded before the first success', () => {
    const fresh = resolveRuntimeStatuses(env, [job('smhi_warnings')], NOW).find((s) => s.sourceId === 'smhi_warnings')!;
    expect(fresh).toMatchObject({ status: 'ok', freshness: 'fresh' });
    const old = resolveRuntimeStatuses(env, [job('smhi_warnings', { last_success_at: new Date(NOW.getTime() - 3 * 3_600_000) })], NOW).find((s) => s.sourceId === 'smhi_warnings')!;
    expect(old.status).toBe('stale');
    const never = resolveRuntimeStatuses(env, [job('smhi_warnings', { last_success_at: null, last_status: 'error', last_error_code: 'timeout' })], NOW).find((s) => s.sourceId === 'smhi_warnings')!;
    expect(never.status).toBe('source_unavailable');
    const failingButFresh = resolveRuntimeStatuses(env, [job('smhi_warnings', { last_status: 'error', last_error_code: 'rate_limited' })], NOW).find((s) => s.sourceId === 'smhi_warnings')!;
    expect(failingButFresh.status).toBe('degraded');
    // Not configured sources keep their configuration status (never ok).
    const tv = resolveRuntimeStatuses(env, [job('trafikverket')], NOW).find((s) => s.sourceId === 'trafikverket')!;
    expect(tv.status).toBe('disabled');
    expect(freshnessOf(null, 60, NOW)).toBe('unknown');
  });
});

describe('collector backoff', () => {
  it('backs off exponentially, honours Retry-After and caps at 6 h', () => {
    expect(nextRunSeconds(300, 0, { status: 'ok', items: 1 })).toBe(300);
    expect(nextRunSeconds(300, 0, { status: 'ok', items: 1, moreWork: true })).toBe(30);
    expect(nextRunSeconds(300, 1, { status: 'error', items: 0 })).toBe(600);
    expect(nextRunSeconds(300, 3, { status: 'error', items: 0 })).toBe(2_400);
    expect(nextRunSeconds(300, 30, { status: 'error', items: 0 })).toBe(6 * 3_600);
    expect(nextRunSeconds(300, 1, { status: 'error', items: 0, retryAfterSeconds: 3_600 })).toBe(3_600);
  });
});

describe('property snapshot from stored data', () => {
  const statuses = resolveRuntimeStatuses(env, [job('smhi_warnings'), job('krisinformation')], NOW);

  it('is schema-valid, keeps data classes apart and never computes a risk score', () => {
    const s = buildPropertySnapshot(record, 'org_testAAAAAAAA', data(), statuses, NOW);
    PropertySnapshotSchema.parse(s);
    expect(s.demoRisk).toBeNull();
    const temp = s.metrics.find((m) => m.metricKey === 'weather.air_temperature')!;
    expect(temp).toMatchObject({ kind: 'forecast', sourceId: 'smhi_forecast', geo: { match: 'point_grid', distanceMeters: 812 } });
    expect(s.metrics.find((m) => m.metricKey === 'weather.precipitation_24h')!.value).toBe(24);
    expect(s.metrics.some((m) => m.metricKey === 'air_quality.index')).toBe(false);
    const pm = s.metrics.find((m) => m.metricKey === 'air_quality.pm25')!;
    expect(pm).toMatchObject({ kind: 'observation', geo: { match: 'nearest_station', distanceMeters: 2100 }, qualityFlags: ['preliminary'] });
    expect(s.metrics.some((m) => m.metricKey === 'air_quality.no2')).toBe(false); // 90 km away → not used
    expect(s.monitoring!.observations[0]).toMatchObject({ stationName: 'Stockholm-Observatoriekullen A', distanceMeters: 900, provenance: { dataClass: 'OBSERVATION' } });
    expect(s.forecast!.series.find((x) => x.metricKey === 'weather.precipitation_1h')!.points.length).toBeGreaterThan(20);
    expect(s.property.countyCode).toBe('01');
  });

  it('status = highest official warning; normal only when warning sources are healthy', () => {
    const calm = buildPropertySnapshot(record, 'org_x', data(), statuses, NOW);
    expect(calm.property.status).toBe('normal');
    const yellow = buildPropertySnapshot(record, 'org_x', data({ events: [event({})] as never }), statuses, NOW);
    expect(yellow.property).toMatchObject({ status: 'monitor' });
    expect(yellow.property.statusReason).toContain('Gul varning');
    expect(yellow.activeAlertCount).toBe(1);
    const red = buildPropertySnapshot(record, 'org_x', data({ events: [event({}), event({ id: 'e2', level: 'Red', severity: 'critical' })] as never }), statuses, NOW);
    expect(red.property.status).toBe('critical');
    // SMHI "message" (Info) is shown but does not change the status.
    const msg = buildPropertySnapshot(record, 'org_x', data({ events: [event({ level: 'Info', severity: 'info' })] as never }), statuses, NOW);
    expect(msg.property.status).toBe('normal');
    expect(msg.warnings).toHaveLength(1);
    // Warning source never fetched → unknown, never "normal".
    const blind = buildPropertySnapshot(record, 'org_x', data(), resolveRuntimeStatuses(env, [job('smhi_warnings', { last_success_at: null, last_status: null })], NOW), NOW);
    expect(blind.property.status).toBe('unknown');
  });

  it('computes the documented risk index (ADR 0003) and is "Ej bedömd" without warning sources', () => {
    const calm = buildPropertySnapshot(record, 'org_x', data(), statuses, NOW);
    expect(calm.riskIndex).toMatchObject({ method: 'fr_risk_index_v1', level: 'low' });
    expect(calm.riskIndex!.score).toBeLessThan(25);
    const yellow = buildPropertySnapshot(record, 'org_x', data({ events: [event({})] as never }), statuses, NOW);
    expect(yellow.riskIndex!.level).not.toBe('low');
    const blind = buildPropertySnapshot(record, 'org_x', data(), resolveRuntimeStatuses(env, [job('smhi_warnings', { last_success_at: null, last_status: null })], NOW), NOW);
    expect(blind.riskIndex).toMatchObject({ score: null, level: null });
  });

  it('does not call a VMA for other municipalities in the county a crisis', () => {
    const vma = (match_method: string) =>
      buildPropertySnapshot(record, 'org_x', data({ events: [event({ id: 'v1', source_id: 'krisinformation', data_class: 'OFFICIAL_WARNING', category: 'Crisis', level: 'VMA', severity: 'critical', match_method, distance_m: null })] as never }), statuses, NOW);
    const own = vma('municipality');
    expect(own.property.status).toBe('critical');
    expect(own.riskIndex!.level).toBe('high');
    const other = vma('county');
    expect(other.property.status).toBe('monitor');
    expect(other.property.statusReason).toContain('andra kommuner i länet');
    expect(other.riskIndex!.level).toBe('watch');
    expect(other.warnings[0]!.geo.note).toBe('Meddelandet gäller andra kommuner i samma län');
  });

  it('labels Krisinformation news as regional public events and traffic with distance', () => {
    const s = buildPropertySnapshot(
      record,
      'org_x',
      data({
        events: [
          event({ id: 'k1', source_id: 'krisinformation', data_class: 'PUBLIC_EVENT', category: 'Crisis', level: 'Info', severity: 'info', match_method: 'county', distance_m: null }),
          event({ id: 't1', source_id: 'trafikverket', data_class: 'PUBLIC_EVENT', category: 'Traffic', level: null, severity: 'warning', match_method: 'within_radius', distance_m: '4512', point_lat: 59.3, point_lon: 18.07 }),
        ] as never,
      }),
      statuses,
      NOW,
    );
    expect(s.events.find((e) => e.id === 'k1')).toMatchObject({ location: null, geo: { match: 'county' } });
    expect(s.events.find((e) => e.id === 't1')).toMatchObject({ category: 'Traffic', geo: { match: 'within_radius', distanceMeters: 4512 }, location: { lat: 59.3, lon: 18.07 } });
    expect(s.property.status).toBe('normal'); // public events never raise status
  });

  it('flood scenarios map to exposure classes; "no hit" stays unknown with an honest note', () => {
    const ctx = (scen: unknown) => data({ contexts: [{ property_id: PID, source_id: 'mcf_flood', context_key: 'flood_scenarios', data_class: 'STATIC_GEODATA', status: 'ok', payload: { scenarios: scen, maxRadiusMeters: 1000, datasetVersion: '20260909' }, source_timestamp: null, fetched_at: NOW }] });
    const inside = buildPropertySnapshot(record, 'o', ctx([{ scenario: 'q100', label: '100-årsflöde', inside: true, withinMeters: 15 }, { scenario: 'q200', label: '200-årsflöde', inside: true, withinMeters: 15 }]), statuses, NOW);
    expect(inside.flood.mapped).toMatchObject({ exposureClass: 'High', distanceToZoneMeters: 0, availability: 'ok' });
    const none = buildPropertySnapshot(record, 'o', ctx([{ scenario: 'q100', label: '100-årsflöde', inside: false, withinMeters: null }]), statuses, NOW);
    expect(none.flood.mapped.exposureClass).toBe('unknown');
    expect(none.flood.mapped.geo.note).toContain('betyder inte att risk saknas');
    const pending = buildPropertySnapshot(record, 'o', data(), statuses, NOW);
    expect(pending.flood.mapped.availability).toBe('loading');
  });

  it('drops a forecast older than 6 h instead of showing it as current', () => {
    const old = data();
    old.forecasts[0]!.fetched_at = new Date(NOW.getTime() - 7 * 3_600_000);
    const s = buildPropertySnapshot(record, 'o', old, statuses, NOW);
    expect(s.metrics.filter((m) => m.kind === 'forecast')).toHaveLength(0);
  });

  it('pro-rates six-hour day totals without including temperature samples after the window',()=>{
    const row=data().forecasts[0]!;
    const extended=Array.from({length:22},(_,i)=>({...steps[0]!,time:new Date(+NOW+(i+1)*6*3600000).toISOString(),intervalStart:new Date(+NOW+i*6*3600000).toISOString(),precipitationMean:6,precipitationMin:3,precipitationMax:9,airTemperature:i===4?100:i,windGust:10,frozenPartPercent:50,precipitationMedian:6,frozenProbability:50,precipitationType:2}));
    const at=new Date(+NOW+3*3600000);
    const forecast=buildForecast(PID,{...row,series:{v:2,steps:extended}},at)!;
    expect(forecast.days![0]).toMatchObject({precipitationMean:24,precipitationMin:12,precipitationMax:36,temperatureMax:3,snowPercent:50});
    extended.splice(2,1);
    expect(buildForecast(PID,{...row,series:{v:2,steps:extended}},at)!.days![0]!.precipitationMean).toBeNull();
  });

  it('reads old v1 and new v2 forecast storage without inventing missing fields', () => {
    const row = data().forecasts[0]!;
    expect(forecastSteps(row)[0]).toMatchObject({ precipitationMin: null, frozenPartPercent: null });
    const v2 = { ...row, series: { v: 2, steps: [{ ...steps[0], precipitationMin: 0.5, frozenPartPercent: 30 }] } };
    expect(forecastSteps(v2)[0]).toMatchObject({ precipitationMin: 0.5, frozenPartPercent: 30 });
    expect(forecastSteps(undefined)).toEqual([]);
  });

  it('matches measured sea level within 15 km and flow within 5 km, without inventing a seasonal class',()=>{
    const sea={...data().observations[0]!,source_id:'smhi_oceanography',parameter:'sea_level',extra:{referenceSystem:'RW'},distance_m:15000};
    const flow={...sea,source_id:'smhi_hydrology',parameter:'water_flow',distance_m:5000,extra:{}};
    const matched=buildPropertySnapshot(record,'o',data({observations:[sea,flow]}),statuses,NOW);
    expect(matched.flood.waterBody?.level.value).toBe(1.8);expect(matched.flood.watercourse?.classification).toBeNull();
    const distant=buildPropertySnapshot(record,'o',data({observations:[{...sea,distance_m:15001},{...flow,distance_m:5001}]}),statuses,NOW);
    expect(distant.flood.waterBody).toBeNull();expect(distant.flood.watercourse).toBeUndefined();
    expect(matched.riskIndex).toEqual(distant.riskIndex);
  });

  it('builds feed items and forecast-derived upcoming conditions', () => {
    const feed = buildFeed([{ id: '7', property_id: PID, source_id: 'smhi_warnings', change_type: 'new', severity: 'monitor', headline: 'Snöfall', created_at: NOW }], new Set([PID]));
    expect(feed[0]).toMatchObject({ title: 'Ny: Snöfall', severity: 'monitor', origin: 'live' });
    const s = buildPropertySnapshot(record, 'o', data(), statuses, NOW);
    const up = buildUpcoming([s], data().forecasts, NOW);
    expect(up.map((u) => u.id)).toEqual(expect.arrayContaining([`gust-${PID}`, `rain-${PID}`, `frost-${PID}`]));
  });
});

describe('monitoring bus', () => {
  it('delivers updates only to the addressed organization (tenant isolation)', () => {
    const bus = new MonitoringBus();
    const a: unknown[] = [];
    const b: unknown[] = [];
    const ua = bus.subscribe('org-a', (u) => a.push(u));
    const ub = bus.subscribe('org-b', (u) => b.push(u));
    bus.publish({ at: NOW.toISOString(), sources: ['smhi_warnings'], organizationIds: ['org-a'], propertyIds: ['p-a'], changes: 1 });
    bus.publish({ at: NOW.toISOString(), sources: ['smhi_forecast'], organizationIds: 'all', propertyIds: ['secret'], changes: 0 });
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(1);
    expect(JSON.stringify(b)).not.toContain('p-a');
    expect(JSON.stringify(b)).not.toContain('secret'); // broadcast never carries property ids
    ua();
    ub();
    expect(bus.listenerCount()).toBe(0);
  });
});

describe('monitoring HTTP endpoints', () => {
  const ORG_UUID = '00000000-0000-4000-8000-00000000000a';
  const db: Queryable = {
    async query<R>(sql: string) {
      if (sql.includes('INSERT INTO organizations')) return { rows: [{ id: ORG_UUID }] as R[] };
      return { rows: [] as R[] };
    },
  };
  const verify: AuthVerifier = async (req) => {
    const t = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (t === 'org') return { userId: 'user_a', sessionId: 's', clerkOrgId: 'org_testAAAAAAAA', orgRole: 'org:admin', orgSlug: 'a' };
    if (t === 'noorg') return { userId: 'user_b', sessionId: 's', clerkOrgId: null, orgRole: null, orgSlug: null };
    return null;
  };
  const bus = new MonitoringBus();
  let app: FastifyInstance;
  let base = '';
  beforeAll(async () => {
    app = await buildApp(env, { logger: false, db, verifyAuth: verify, monitoring: new MonitoringService(db, env, bus) });
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterAll(() => app.close());

  it('require a verified user AND organization', async () => {
    for (const url of ['/v1/portfolio', '/v1/portfolio/summary', `/v1/properties/${PID}/snapshot`, `/v1/properties/${PID}/forecast`, `/v1/properties/${PID}/warnings`, `/v1/properties/${PID}/events`, `/v1/properties/${PID}/environment`, `/v1/properties/${PID}/flood`, '/v1/changes', '/v1/stream']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
      expect((await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer noorg' } })).statusCode, url).toBe(403);
    }
  });

  it('returns 404 for a property outside the organization and a valid empty portfolio', async () => {
    const r = await app.inject({ method: 'GET', url: `/v1/properties/${PID}/snapshot`, headers: { authorization: 'Bearer org' } });
    expect(r.statusCode).toBe(404);
    const p = await app.inject({ method: 'GET', url: '/v1/portfolio', headers: { authorization: 'Bearer org' } });
    expect(p.statusCode).toBe(200);
    PortfolioSchema.parse(p.json());
    const sum = await app.inject({ method: 'GET', url: '/v1/portfolio/summary', headers: { authorization: 'Bearer org' } });
    expect(sum.json()).toMatchObject({ properties: 0, riskScore: null, statusMethod: 'highest_official_warning' });
  });

  it('streams SSE scoped to the organization', async () => {
    const ac = new AbortController();
    const res = await fetch(`${base}/v1/stream`, { headers: { authorization: 'Bearer org' }, signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) text += dec.decode((await reader.read()).value);
    };
    await readUntil('event: hello');
    bus.publish({ at: NOW.toISOString(), sources: ['smhi_warnings'], organizationIds: ['someone-else'], propertyIds: ['x'], changes: 1 });
    bus.publish({ at: NOW.toISOString(), sources: ['smhi_warnings'], organizationIds: [ORG_UUID], propertyIds: [PID], changes: 1 });
    await readUntil('event: update');
    expect(text).toContain(PID);
    expect(text).not.toContain('"x"');
    ac.abort();
    await reader.cancel().catch(() => undefined);
  });
});
