import { forecastDaysVM } from '@/lib/view-models/weather-information';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Clerk server helpers are mocked: the loader must only forward the session token.
const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }));
import { assessPropertyRisk, type Portfolio, type PropertySnapshot } from '@fastighetsradar/domain';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import { buildOverviewVM } from '@/lib/view-models/overview';
import { endedLabel, feedEventMapEntry } from '@/lib/view-models/event-map';
import { SEV } from '@/lib/design/tokens';
import { demoSingleEvent } from '@/lib/demo/event-map-demo';
import { buildDetailVM } from '@/lib/view-models/detail';
import { chartOf, smooth } from '@/lib/view-models/chart';
import { loadDemoPortfolio, loadLivePortfolio } from '@/lib/data/portfolio';

const ui = {
  ready: true,
  group: 'all',
  isSmsOn: (s: PropertySnapshot) => s.sms.enabled,
  isRuleOn: (_id: string, fallback: boolean) => fallback,
};
const byName = (name: string) => demoPortfolio.properties.find((s) => s.property.name === name)!;

describe('overview view-model reproduces the approved design values', () => {
  const vm = buildOverviewVM(demoPortfolio, ui);

  it('KPIs', () => {
    expect(vm.kpi.total).toBe(8);
    expect(vm.kpi.alerts).toBe(14);
    expect(vm.kpi.warnings).toBe(3);
    expect(vm.kpi.warnAffected).toBe(4);
    expect(vm.kpi.wx).toBe(7);
    expect(vm.kpi.sms).toBe(30);
    expect(vm.kpi.smsSub).toBe('7 av 8 fastigheter med SMS aktiverat');
    expect(vm.kpi.barLabel).toBe('Ingen aktiv varning: 3 · Info: 2 · Varning: 2 · Kritisk: 1');
  });

  it('marks feed rows whose current event can be shown on the map', () => {
    const e4 = vm.feed.find((f) => f.title.startsWith('Körfält avstängt på E4'))!;
    expect(e4.mapEventId).toBe('demo-arenastaden-hus-c-event-1');
    // A row without an event (or with one that has ended) gets no map button.
    expect(vm.feed.find((f) => f.title.startsWith('Gul varning hävd'))!.mapEventId).toBeNull();
    const gone = buildOverviewVM({ ...demoPortfolio, feed: demoPortfolio.feed.map((f) => ({ ...f, eventId: f.eventId ? 'gone' : undefined, eventEndedOnMap: undefined, outageOnMap: undefined })) }, ui);
    expect(gone.feed.every((f) => f.mapEventId === null)).toBe(true);
    // An ended event whose stretch is still stored opens greyed out.
    const lindhagen = vm.feed.find((f) => f.title.includes('Lindhagensgatan'))!;
    expect(lindhagen).toMatchObject({ mapEventId: 'demo-strandhuset-ended-0', mapEnded: true });
    expect(e4.mapEnded).toBe(false);
  });

  it('opens a power outage on the map as its area – inside it, with the expected restoration', () => {
    const row = vm.feed.find((f) => f.title.startsWith('Oplanerat strömavbrott'))!;
    expect(row).toMatchObject({ mapEventId: 'demo-gotgarden-outage-0', mapSingle: true, mapEnded: false, ackRequired: true });
    const e = feedEventMapEntry(demoSingleEvent('demo-gotgarden', 'demo-gotgarden-outage-0')!, demoPortfolio.generatedAt);
    expect(e).toMatchObject({ shape: 'polygon', label: 'Strömavbrott', icon: 'power', src: 'Ellevio', dist: 'Inom området', time: 'Beräknat klart 17:00', impact: '214 kunder', extent: 'Område enligt nätbolaget', ended: false });
    expect(e.runs[0]!.length).toBe(7);
  });

  it('draws an ended feed event grey, without the pulse colour, marked with when it ended', () => {
    const x = demoSingleEvent('demo-strandhuset', 'demo-strandhuset-ended-0')!;
    const e = feedEventMapEntry(x, demoPortfolio.generatedAt);
    expect(e).toMatchObject({ ended: true, time: 'Avslutad 07:40', shape: 'line', exact: true, dist: '440 m', src: 'Trafikverket', label: 'Vägarbete' });
    expect(e.hx).toBe('#8E969D');
    expect(endedLabel('2025-11-11T15:50:00+01:00', demoPortfolio.generatedAt)).toBe('Avslutad 11 nov 15:50');
    expect(feedEventMapEntry({ ...x, active: true, endedAt: null }, demoPortfolio.generatedAt)).toMatchObject({ ended: false, hx: SEV.critical.hx });
    // Only the demo property the event belongs to.
    expect(demoSingleEvent('demo-gotgarden', 'demo-strandhuset-ended-0')).toBeNull();
  });

  it('names the properties behind each weather pill, worst first', () => {
    for (const x of vm.kpi.wxSplit) expect(x.items).toHaveLength(x.n);
    expect(vm.kpi.wxSplit.reduce((a, x) => a + x.n, 0)).toBe(vm.kpi.wx);
    const rain = vm.kpi.wxSplit.find((x) => x.label === 'Regn')!;
    const mm = rain.items.map((i) => Number(i.text.match(/([\d,]+) mm/)![1]!.replace(',', '.')));
    expect(mm).toEqual([...mm].sort((a, b) => b - a));
    expect(rain.items[0]!.text).toMatch(/^Väntar [\d,]+ mm regn kommande 24 h$/);
    const frost = vm.kpi.wxSplit.find((x) => x.label === 'Frost')!;
    expect(frost.items.every((i) => /^Känns som −?\d+° just nu$/.test(i.text))).toBe(true);
  });

  it('hero and health', () => {
    // Status line: properties with an active official warning (Bevaka or higher) and the worst one.
    expect(vm.hero.status.headline).toBe('5 av 8 fastigheter med varning');
    expect(vm.hero.status.detail).toBe('Högst: Augustendal Brygga · Orange varning (kraftig vind)'); // highest status first
    expect(vm.hero.statusDash.startsWith(String((5 / 8) * 2 * Math.PI * 28))).toBe(true);
    expect(vm.hero.avgTemp).toBe('3,9');
    expect(vm.hero.maxRain).toBe('22,1');
    expect(vm.hero.maxRainAt).toBe('Augustendal Brygga');
    expect(vm.hero.gust).toBe('25');
    // Weather / water / VMA / power at "Bevaka" or higher – regional news, static flood mapping, traffic and air never count.
    expect(vm.cats.map((c) => [c.label, c.n])).toEqual([['Väder', 1], ['Vatten', 3], ['VMA', 1], ['El och värme', 0]]);
  });

  it('table sorted by risk and feed formatted in local time', () => {
    expect(vm.rows.map((r) => r.name).slice(0, 2)).toEqual(['Ulvsunda Lager', 'Augustendal Brygga']); // VMA in its municipality, then orange wind
    expect(vm.rows[1]!.warn).toBe('Orange · Kraftig vind');
    expect(vm.rows[0]!.nearby).not.toMatch(/kris/i);
    expect(vm.rows.find((r) => r.name === 'Ulvsunda Lager')!.aq).toBe('Dålig');
    expect(vm.feed[0]).toMatchObject({ t: '14:32', src: 'SMHI', prop: 'Augustendal Brygga' });
    expect(vm.dateLine).toBe('Onsdag 12 november · Stockholmsregionen · Demodata');
  });

  it('group filter', () => {
    const inner = buildOverviewVM(demoPortfolio, { ...ui, group: 'inner' });
    expect(inner.kpi.total).toBe(4);
    expect(inner.groups.map((g) => g.count)).toEqual([8, 4, 4]);
  });

  it('bars start at zero before the ready animation', () => {
    const cold = buildOverviewVM(demoPortfolio, { ...ui, ready: false });
    expect(cold.kpi.smsW).toBe('0%');
    expect(cold.rows.every((r) => r.riskW === '0%')).toBe(true);
  });
});

describe('detail view-model', () => {
  const s = byName('Augustendal Brygga');
  const d = buildDetailVM(demoPortfolio, s, { ready: true, metric: 'temp', smsOn: true, isRuleOn: (_i, f) => f });

  it('matches the prototype for Augustendal Brygga', () => {
    expect(d.pos).toBe('6/8');
    expect(d.windDir).toBe('S');
    expect(d.water.level).toBe('+41 cm');
    expect(d.water.dist).toBe('15 m · inom buffert');
    expect(d.warnings.map((w) => [w.level, w.start, w.end])).toEqual([
      ['Orange', 'ons 16:00', 'tors 10:00'],
      ['Yellow', 'tors 06:00', 'tors 20:00'],
    ]);
    expect(d.sms.rules.map((r) => r.state)).toEqual(['Utlöst idag', 'Utlöst idag', 'Utlöst idag', 'Utlöst idag', 'Aktiv']);
    expect(d.chart?.xLabels).toEqual(['Nu', '20:00', '02:00', '08:00', '14:00']);
    expect(d.timeline[0]!.time).toBe('14:34');
  });

  it('wraps prev/next around the portfolio', () => {
    const first = buildDetailVM(demoPortfolio, demoPortfolio.properties[0]!, { ready: true, metric: 'rain', smsOn: false, isRuleOn: (_i, f) => f });
    expect(first.prevId).toBe(demoPortfolio.properties[7]!.property.id);
    expect(first.chart?.stats[3]!.label).toBe('Totalt');
  });
});

describe('missing data is never rendered as a normal value', () => {
  const s = byName('Götgården');
  const missing: PropertySnapshot = {
    ...s,
    metrics: s.metrics.map((m) => ({ ...m, availability: 'no_coverage' as const })),
    forecast: null,
    demoRisk: null,
    flood: { ...s.flood, mapped: { ...s.flood.mapped, exposureClass: 'unknown' }, waterBody: null },
  };
  // Live payload whose warning sources are down: the method itself says "Ej bedömd" (never 0).
  missing.riskIndex = assessPropertyRisk(missing, () => false);
  const portfolio: Portfolio = { ...demoPortfolio, origin: 'live', properties: [missing], feed: [], demoTrends: null };

  it('shows em dashes and "Not assessed" instead of zeros or "Normal"', () => {
    const d = buildDetailVM(portfolio, missing, { ready: true, metric: 'temp', smsOn: false, isRuleOn: (_i, f) => f });
    expect(d.temp).toBe('—');
    expect(d.rain).toBe('—');
    expect(d.aqi).toBe('—');
    expect(d.risk).toBe('—');
    expect(d.gauge.label).toBe('Ej bedömd');
    expect(d.chart).toBeNull();
    expect(d.water.flood).toBe('Okänd');
    expect(d.water.basement).toBe('—');
    expect(d.timeline).toEqual([]); // demo timeline never shown for live data
    // Unknown values never trigger rules
    expect(d.sms.rules.find((r) => r.code === 'RN')!.hit).toBe(false);

    const vm = buildOverviewVM(portfolio, ui);
    expect(vm.hero.status.headline).toBe('0 av 1 fastighet med varning'); // warning status is still assessed
    expect(vm.rows[0]!.temp).toBe('—');
    expect(vm.rows[0]!.aq).toBe('—');
    expect(vm.kpi.alertsDelta).toBeNull();
  });
});

describe('data loaders', () => {
  afterEach(() => {
    delete process.env.FASTIGHETSRADAR_DEMO_ENABLED;
    vi.unstubAllGlobals();
  });

  it('serve demo fixtures only when the demo is explicitly enabled', async () => {
    expect((await loadDemoPortfolio()).status).toBe('unavailable');
    process.env.FASTIGHETSRADAR_DEMO_ENABLED = 'true';
    const r = await loadDemoPortfolio();
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.portfolio.origin).toBe('demo_fixture');
  });

  it('live loader forwards the Clerk token and never falls back to fixtures', async () => {
    process.env.FASTIGHETSRADAR_DEMO_ENABLED = 'true'; // even with demo enabled
    authMock.mockResolvedValue({ userId: 'user_1', getToken: async () => 'tok' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ title: 'Unauthorized' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await loadLivePortfolio();
    expect(r).toMatchObject({ status: 'unavailable', mode: 'live', code: 'unauthenticated' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:4000/v1/portfolio');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
  });

  it('live loader rejects payloads that do not match the Portfolio contract', async () => {
    authMock.mockResolvedValue({ userId: 'user_1', getToken: async () => 'tok' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ properties: 'nope' }), { status: 200 })));
    expect(await loadLivePortfolio()).toMatchObject({ status: 'unavailable', code: 'api_error' });
  });

  it('maps 403 to organization_required', async () => {
    authMock.mockResolvedValue({ userId: 'user_1', getToken: async () => 'tok' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    expect(await loadLivePortfolio()).toMatchObject({ status: 'unavailable', code: 'organization_required' });
  });
});

describe('live portfolio without connected sources', () => {
  const live: Portfolio = {
    ...demoPortfolio,
    origin: 'live',
    feed: [],
    upcoming: [],
    narrative: null,
    demoTrends: null,
    segments: [],
    sources: [{ sourceId: 'smhi_forecast', label: 'SMHI', status: 'not_implemented', lastSuccessAt: null, lastCheckedAt: null, freshness: 'unknown', errorCode: null }],
    properties: [
      {
        ...byName('Götgården'),
        property: { ...byName('Götgården').property, origin: 'live', status: 'unknown', building: null },
        metrics: [],
        forecast: null,
        warnings: [],
        events: [],
        alertRules: [],
        activeAlertCount: 0,
        demoRisk: null,
        flood: { ...byName('Götgården').flood, mapped: { ...byName('Götgården').flood.mapped, exposureClass: 'unknown' }, waterBody: null },
      },
    ],
  };

  it('marks every monitoring panel as not connected instead of normal', () => {
    const vm = buildOverviewVM(live, ui);
    expect(vm.avail).toEqual({ weather: false, warnings: false, events: false, air: false, flood: false, alerts: true });
    expect(vm.hero.status).toMatchObject({ headline: 'Status kan inte bedömas', fill: 0 });
    expect(vm.kpi.barLabel).toBe('1 ej bedömda ännu · inga offentliga datakällor anslutna');
    expect(vm.rows[0]!.status).toBe('Ej bedömd');
    const d = buildDetailVM(live, live.properties[0]!, { ready: true, metric: 'temp', smsOn: false, isRuleOn: (_i, f) => f });
    expect(d.avail.warnings).toBe(false);
    expect(d.buildingLine).toBe('Byggnadsuppgifter saknas');
    expect(d.floors).toBe(6);
    expect(d.water.hasLevel).toBe(false);
    expect(d.sms.rules).toEqual([]);
    expect(d.timeline).toEqual([]);
  });

  it('demo fixtures keep the full design', () => {
    expect(buildOverviewVM(demoPortfolio, ui).avail.warnings).toBe(true);
  });
});

describe('chart helpers', () => {
  it('produce the same path format as the prototype', () => {
    expect(smooth([[0, 0], [10, 10]])).toBe('M0.0,0.0 C1.7,1.7 8.3,8.3 10.0,10.0');
    const c = chartOf([1, 2, 3], 100, 50);
    expect(c.mn).toBe(1);
    expect(c.mx).toBe(3);
    expect(c.area.endsWith('L100,50 L0,50 Z')).toBe(true);
    expect(chartOf([], 100, 50).line).toBe('');
  });
});

describe('five-day forecast view-model', () => {
  const NOW = '2026-11-13T08:00:00Z'; // Friday 09:00 Swedish time
  const day = (from: string, to: string) => ({ from, to, temperatureMin: -2.4, temperatureMax: 4.2, precipitationMean: 12.4, precipitationMin: 4.1, precipitationMax: 20, windGustMax: 15.2, snowPercent: 25 });

  it('labels Swedish calendar days and formats compact values', () => {
    const s = structuredClone(demoPortfolio.properties[0]!);
    s.forecast!.days = [day(NOW, '2026-11-13T23:00:00Z'), day('2026-11-13T23:00:00Z', '2026-11-14T23:00:00Z'), day('2026-11-15T23:00:00Z', '2026-11-16T23:00:00Z')];
    const vm = forecastDaysVM(s, NOW);
    expect(vm.map((d) => d.label)).toEqual(['Idag', 'Imorgon', 'Måndag 16 nov']);
    expect(vm[0]).toMatchObject({ temperature: '−2° / 4°', rain: '12 mm', interval: '4,1–20 mm', gust: 'Byar 15 m/s', snow: '25 % som snö' });
  });

  it('keeps gaps explicit and never shows a 0 % snow line', () => {
    const s = structuredClone(demoPortfolio.properties[0]!);
    s.forecast!.days = [{ ...day(NOW, '2026-11-13T23:00:00Z'), temperatureMin: null, precipitationMean: null, precipitationMin: null, precipitationMax: null, windGustMax: null, snowPercent: 0 }];
    expect(forecastDaysVM(s, NOW)[0]).toMatchObject({ temperature: 'Temperatur ej tillgänglig', rain: 'Nederbörd ej tillgänglig', interval: null, gust: 'Byar ej tillgängliga', snow: null });
    s.forecast!.availability = 'stale';
    expect(forecastDaysVM(s, NOW)).toEqual([]);
  });
});
