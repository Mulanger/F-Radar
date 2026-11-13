import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import {
  AIR_PHENOMENA,
  METOBS_PARAMETERS,
  buildTrafikverketQuery,
  currentStep,
  fetchSmhiPointForecast,
  fetchSmhiWarnings,
  httpJson,
  mcfBoxFilter,
  mcfUrl,
  normalizeMunicipality,
  parseAirSeries,
  parseKrisinformation,
  parseMcfHit,
  parseMetObs,
  parseScbMunicipalities,
  parseScbStats,
  parseSguArea,
  parseSguLevels,
  parseSmhiCountyAreas,
  parseSmhiForecast,
  parseSmhiWarnings,
  parseTrafikverket,
  precipitationTotal,
  probeFloodScenarios,
  smhiForecastUrl,
  trafikverketSeverity,
  type AdapterContext,
} from '../src';

/** Fixtures are trimmed copies of REAL payloads captured during live verification (2026-11-13). */
const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const NOW = new Date('2026-11-13T05:00:00Z');

function ctx(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, env: Record<string, string> = {}): AdapterContext {
  return { env: loadServerEnv(env), fetch: vi.fn(fetchImpl) as unknown as typeof fetch, logger: { debug() {}, info() {}, warn() {}, error() {} }, now: () => NOW };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('SMHI SNOW1gv1 point forecast', () => {
  const f = parseSmhiForecast(fx('smhi-snow1g-point.json'))!;

  it('parses reference time, grid point and steps (sorted, ISO UTC)', () => {
    expect(f.referenceTime).toBe('2026-11-13T03:30:00.000Z');
    expect(f.gridPoint.lat).toBeCloseTo(59.33, 1);
    expect(f.steps.length).toBe(40);
    expect(f.steps[0]!.time < f.steps[1]!.time).toBe(true);
    expect(typeof f.steps[0]!.airTemperature).toBe('number');
  });

  it('treats 9999 as missing, never as a value', () => {
    const raw = fx('smhi-snow1g-point.json');
    raw.timeSeries[0].data.air_temperature = 9999;
    expect(parseSmhiForecast(raw)!.steps[0]!.airTemperature).toBeNull();
  });

  it('parses the additional ensemble and frozen fields, including sentinels', () => {
    const raw = fx('smhi-snow1g-point.json');
    Object.assign(raw.timeSeries[0].data, { precipitation_amount_min: 1, precipitation_amount_median: 2, precipitation_frozen_part: 70, probability_of_frozen_precipitation: 80, predominant_precipitation_type_at_surface: 3 });
    expect(parseSmhiForecast(raw)!.steps[0]).toMatchObject({ precipitationMin: 1, precipitationMedian: 2, frozenPartPercent: 70, frozenProbability: 80, precipitationType: 3 });
    for (const key of ['precipitation_amount_min', 'precipitation_amount_median', 'precipitation_frozen_part', 'probability_of_frozen_precipitation', 'predominant_precipitation_type_at_surface']) raw.timeSeries[0].data[key] = 9999;
    expect(parseSmhiForecast(raw)!.steps[0]).toMatchObject({ precipitationMin: null, precipitationMedian: null, frozenPartPercent: null, frozenProbability: null, precipitationType: null });
  });

  it('sums interval precipitation over 24 h and refuses partial coverage', () => {
    const steps = [0, 1, 2].map((h) => ({ ...f.steps[0]!, intervalStart: new Date(Date.UTC(2026, 10, 13, h)).toISOString(), time: new Date(Date.UTC(2026, 10, 13, h + 1)).toISOString(), precipitationMean: 1.5 }));
    expect(precipitationTotal(steps, new Date('2026-11-13T00:00:00Z'), 3)).toBe(4.5);
    expect(precipitationTotal(steps, new Date('2026-11-13T00:00:00Z'), 24)).toBeNull(); // only 3 of 24 h covered
    expect(precipitationTotal([{ ...steps[0]!, precipitationMean: null }, ...steps.slice(1)], new Date('2026-11-13T00:00:00Z'), 3)).toBeNull();
    // pro-rates a 6 h interval half inside the window
    const six = [{ ...f.steps[0]!, intervalStart: '2026-11-13T00:00:00.000Z', time: '2026-11-13T06:00:00.000Z', precipitationMean: 6 }];
    expect(precipitationTotal(six, new Date('2026-11-13T00:00:00Z'), 3)).toBe(3); // uniform pro-rating within an interval
    expect(precipitationTotal(six, new Date('2026-11-13T00:00:00Z'), 6)).toBe(6);
  });

  it('picks the step whose interval contains now', () => {
    const cur = currentStep(f.steps, new Date('2026-11-13T04:30:00Z'))!;
    expect(cur.time).toBe('2026-11-13T05:00:00.000Z');
  });

  it('rejects invalid payloads and rounds coordinates in the URL', async () => {
    expect(parseSmhiForecast({ timeSeries: [] })).toBeNull();
    expect(smhiForecastUrl('https://x/api/', 59.336765, 18.062705)).toBe('https://x/api/category/snow1g/version/1/geotype/point/lon/18.0627/lat/59.3368/data.json');
    const r = await fetchSmhiPointForecast(59.3, 18, ctx(async () => json({ nope: 1 })));
    expect(r).toMatchObject({ ok: false, error: 'invalid_payload' });
  });
});

describe('SMHI IBWW warnings', () => {
  it('maps every warning area to one event with level, polygon and unaltered text', () => {
    const { events, skipped } = parseSmhiWarnings(fx('smhi-ibww-warning.json'));
    expect(skipped).toBe(0);
    const yellow = events.filter((e) => e.level === 'Yellow');
    const msg = events.filter((e) => e.level === 'Info');
    expect(yellow.length).toBeGreaterThan(0);
    expect(msg.length).toBeGreaterThan(0);
    expect(yellow[0]).toMatchObject({ sourceId: 'smhi_warnings', dataClass: 'OFFICIAL_WARNING', severity: 'monitor', category: 'Weather', status: 'active' });
    expect(msg[0]).toMatchObject({ severity: 'info', category: 'Water' }); // WATER_SHORTAGE message
    expect(['Polygon', 'MultiPolygon']).toContain(yellow[0]!.geometry!.type);
    expect(new Set(events.map((e) => e.externalId)).size).toBe(events.length);
    expect(yellow[0]!.externalId).toMatch(/^\d+:\d+$/);
  });

  it('skips areas without geometry or with an unknown level instead of guessing', () => {
    const raw = fx('smhi-ibww-warning.json');
    raw[0].warningAreas[0].area = null;
    raw[0].warningAreas[1].warningLevel.code = 'PURPLE';
    const { skipped } = parseSmhiWarnings(raw);
    expect(skipped).toBe(2);
  });

  it('retries 5xx and honours 429 Retry-After, then reports the error code', async () => {
    let calls = 0;
    const r = await fetchSmhiWarnings(ctx(async () => (++calls < 3 ? new Response('busy', { status: 503 }) : json(fx('smhi-ibww-warning.json')))));
    expect(r.ok).toBe(true);
    expect(calls).toBe(3);
    const limited = await httpJson('https://x', ctx(async () => new Response('', { status: 429, headers: { 'retry-after': '120' } })), { label: 't', attempts: 3 });
    expect(limited).toMatchObject({ ok: false, error: 'rate_limited', retryAfterSeconds: 120 });
  });

  it('reports a timeout (never throws) when the provider hangs', async () => {
    const hang = (_u: string, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' }))));
    const r = await httpJson('https://x', ctx(hang), { label: 'slow', timeoutMs: 20, attempts: 1 });
    expect(r).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('parses the 21 county polygons with official codes', () => {
    const areas = parseSmhiCountyAreas([
      { id: 1, sv: 'Stockholms län', code: 'SWE_COUNTIES', area: { geometry: { type: 'Polygon', coordinates: [[[18, 59], [19, 59], [19, 60], [18, 59]]] } } },
      { id: 46, sv: 'Skärgårdshavet', code: 'SWE_SEA_DISTRICTS', area: { geometry: { type: 'Polygon', coordinates: [] } } },
    ]);
    expect(areas).toEqual([expect.objectContaining({ code: '01', name: 'Stockholms län' })]);
  });
});

describe('Krisinformation v3', () => {
  it('classifies news as PUBLIC_EVENT (info) scoped to the published counties', () => {
    const r = parseKrisinformation(fx('krisinformation-news.json'), 'news')!;
    expect(r.events.length).toBe(2);
    const e = r.events.find((x) => x.externalId === 'news:1263')!;
    expect(e).toMatchObject({ dataClass: 'PUBLIC_EVENT', severity: 'info', level: 'Info', category: 'Crisis', countyNames: ['Västerbottens län'], geometry: null });
    expect(e.headline).toBe('Röd varning för snöfall i Skellefteå'); // unaltered
  });

  it('classifies VMA as OFFICIAL_WARNING (critical) and supports national scope', () => {
    const r = parseKrisinformation([{ identifier: 'v1', headline: 'VMA test', area: [{ type: 'Country', description: 'Sverige' }] }], 'vma')!;
    expect(r.events[0]).toMatchObject({ dataClass: 'OFFICIAL_WARNING', level: 'VMA', severity: 'critical', countyNames: ['*'] });
  });

  it('skips items without any geographic scope', () => {
    const r = parseKrisinformation([{ identifier: 'x', headline: 'h', area: [] }], 'news')!;
    expect(r).toEqual({ events: [], skipped: 1 });
    expect(parseKrisinformation({ not: 'an array' }, 'news')).toBeNull();
  });
});

describe('Trafikverket', () => {
  it('builds an OR-ed WITHIN query and escapes the key', () => {
    const q = buildTrafikverketQuery('k"<&', [{ lat: 59.3, lon: 18 }, { lat: 57.7, lon: 11.9 }]);
    expect(q).toContain('authenticationkey="k&quot;&lt;&amp;"');
    expect(q).toContain('<OR>');
    expect(q.match(/<WITHIN /g)).toHaveLength(2);
    expect(q).toContain('namespace="road.trafficinfo" schemaversion="1.6"');
  });

  it('maps deviations to PUBLIC_EVENTs with WKT geometry and capped severity', () => {
    const r = parseTrafikverket(fx('trafikverket-situations.json'));
    if ('error' in r) throw new Error(r.error);
    expect(r.events.length).toBe(5);
    const e = r.events.find((x) => x.externalId === 'SE_STA_TRISSID_2_24375239')!;
    expect(e).toMatchObject({ dataClass: 'PUBLIC_EVENT', category: 'Traffic', severity: 'warning', eventType: 'Vägen avstängd' });
    expect(e.geometryWkt).toMatch(/^(LINESTRING|POINT)/);
    expect(trafikverketSeverity(5)).toBe('warning');
    expect(trafikverketSeverity(1)).toBe('info');
    expect(trafikverketSeverity(null)).toBe('unknown');
  });

  it('surfaces API errors instead of returning an empty (falsely calm) list', () => {
    expect(parseTrafikverket({ RESPONSE: { RESULT: [{ ERROR: { MESSAGE: 'Invalid key' } }] } })).toEqual({ error: 'Invalid key' });
  });
});

describe('SMHI MetObs', () => {
  it('keeps the latest value per station with quality code; drops empty values', () => {
    const p = METOBS_PARAMETERS.find((x) => x.id === 1)!;
    const obs = parseMetObs(fx('smhi-metobs-1.json'), p)!;
    expect(obs.length).toBe(5);
    expect(obs[0]).toMatchObject({ sourceId: 'smhi_observations', parameter: 'air_temperature', unit: '°C', quality: 'G' });
    expect(typeof obs[0]!.value).toBe('number');
    const raw = fx('smhi-metobs-1.json');
    raw.station[0].value = [{ date: 1, value: '', quality: 'G' }];
    expect(parseMetObs(raw, p)!.length).toBe(4);
  });
});

describe('Air quality (52°North)', () => {
  it('keeps recent hourly series, drops stale series and computes no index', () => {
    const p = AIR_PHENOMENA.find((x) => x.key === 'pm25')!;
    const obs = parseAirSeries(fx('air-pm25-timeseries.json'), p, NOW)!;
    const names = obs.map((o) => o.name);
    expect(names).toContain('Stockholm Hornsgatan 108 Gata');
    // The 2009 Malmö series is stale → the station keeps only its recent hourly series.
    expect(obs.filter((o) => o.name === 'Malmö Rådhuset')).toHaveLength(1);
    expect(obs.every((o) => o.quality === 'preliminary')).toBe(true);
    expect(obs.every((o) => !('index' in o))).toBe(true);
  });
});

describe('SGU HYPE groundwater', () => {
  it('parses area id and latest level; −1 means not applicable', () => {
    expect(parseSguArea({ features: [{ properties: { omrade_id: 132145 } }] })).toBe('132145');
    expect(parseSguArea({ features: [] })).toBeNull();
    const lv = parseSguLevels({
      features: [
        { properties: { datum: '2026-10-31Z', omrade_id: 132145, fyllnadsgrad_sma: 10, fyllnadsgrad_stora: -1, grundvattensituation_sma: 18, grundvattensituation_stora: -1 } },
        { properties: { datum: '2026-11-01Z', omrade_id: 132145, fyllnadsgrad_sma: 4, fyllnadsgrad_stora: -1, grundvattensituation_sma: 20, grundvattensituation_stora: -1 } },
      ],
    })!;
    expect(lv).toEqual({ areaId: '132145', date: '2026-11-01', fillSmall: 4, fillLarge: null, situationSmall: 20, situationLarge: null });
  });
});

describe('MCF flood scenarios (WFS)', () => {
  it('uses an explicit EPSG:4326 lon/lat CQL BBOX and never downloads geometry', () => {
    expect(mcfBoxFilter(59.8586, 17.6389, 15)).toMatch(/^BBOX\(geom,17\.638\d+,59\.858\d+,17\.639\d+,59\.858\d+,'EPSG:4326'\)$/);
    const u = new URL(mcfUrl('NZ_Oversvamning_100', 59.8586, 17.6389, 1000));
    expect(u.searchParams.get('propertyName')).toBe('objectid,beginlifespanversion');
    expect(u.searchParams.get('count')).toBe('1');
  });

  it('narrows the radius only after a hit (1 request per scenario when nothing is near)', async () => {
    const hit = { numberMatched: 1, features: [{ properties: { objectid: 68, beginlifespanversion: '20260909' } }] };
    const miss = { numberMatched: 0, features: [] };
    const c = ctx(async (url) => {
      const u = new URL(url);
      const radiusHit = u.searchParams.get('typeNames')!.endsWith('_100') && !u.searchParams.get('CQL_FILTER')!.includes('17.6388'); // only the ≥100 m boxes hit
      return json(radiusHit ? hit : miss);
    });
    const r = await probeFloodScenarios(59.8586, 17.6389, c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.datasetVersion).toBe('20260909');
    const q100 = r.data.scenarios.find((s) => s.scenario === 'q100')!;
    expect(q100.withinMeters).not.toBeNull();
    const q200 = r.data.scenarios.find((s) => s.scenario === 'q200')!;
    expect(q200).toMatchObject({ inside: false, withinMeters: null });
    expect(parseMcfHit({ bad: true })).toEqual({ hit: false, version: null });
  });
});

describe('SCB PxWebApi v2', () => {
  it('maps municipality names (incl. "X kommun" / genitive) to region codes', () => {
    const meta = { dimension: { Region: { category: { label: { '01': 'Stockholms län', '0180': 'Stockholm', '1780': 'Karlstad', '1980': 'Västerås', ...Object.fromEntries(Array.from({ length: 260 }, (_, i) => [String(2000 + i), `Kommun${i}`])) } } } } };
    const m = parseScbMunicipalities(meta)!;
    expect(m.get('stockholm')?.code).toBe('0180');
    expect(m.get(normalizeMunicipality('Stockholms kommun'))?.code).toBe('0180');
    expect(m.get(normalizeMunicipality('Västerås kommun'))?.code).toBe('1980');
    expect(m.has('01')).toBe(false);
  });

  it('parses a json-stat2 response for one region/period', () => {
    const s = parseScbStats({
      updated: '2026-02-24T07:00:00Z',
      id: ['Region', 'Kon', 'ContentsCode', 'Tid'],
      size: [1, 1, 3, 1],
      value: [5432.1, 1000000, 187.2],
      dimension: {
        Region: { category: { index: { '0180': 0 } } },
        Kon: { category: { index: { '1+2': 0 } } },
        ContentsCode: { category: { index: { BE0101U1: 0, BE0101U2: 1, BE0101U3: 2 } } },
        Tid: { category: { index: { '2025': 0 } } },
      },
    })!;
    expect(s.period).toBe('2025');
    expect(s.values.find((v) => v.key === 'population')!.value).toBe(1000000);
    expect(s.values.find((v) => v.key === 'density')!.value).toBe(5432.1);
  });
});
