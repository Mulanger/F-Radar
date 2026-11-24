import { forecastDaysVM } from '@/lib/view-models/weather-information';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Clerk server helpers are mocked: the loader must only forward the session token.
const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }));
import { assessPropertyRisk, listPortfolio, type Portfolio, type PropertySnapshot } from '@fastighetsradar/domain';
import { demoPortfolio, scaleDemoPortfolio } from '@fastighetsradar/domain/fixtures';
import { buildOverviewVM, feedTime } from '@/lib/view-models/overview';
import { endedLabel, feedEventMapEntry } from '@/lib/view-models/event-map';
import { SEV } from '@/lib/design/tokens';
import { demoSingleEvent } from '@/lib/demo/event-map-demo';
import { buildDetailVM } from '@/lib/view-models/detail';
import { chartOf, smooth } from '@/lib/view-models/chart';
import { loadDemoPortfolio, loadDemoPropertySnapshot, loadLivePortfolio } from '@/lib/data/portfolio';
import { nowcastVM } from '@/lib/view-models/nowcast';

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
    expect(vm.kpi.alerts).toBe(4);
    expect(vm.kpi.warnings).toBe(4);
    expect(vm.kpi.warnAffected).toBe(4);
    expect(vm.kpi.wx).toBe(7);
    expect(vm.kpi.sms).toBe(30);
    expect(vm.kpi.smsSub).toBe('7 av 8 fastigheter med SMS aktiverat');
    expect(vm.kpi.barLabel).toBe('Ingen aktiv varning: 3 · Info: 2 · Varning: 2 · Kritisk: 1');
  });

  it('groups warnings across 100 properties and orders them by level and publication time', () => {
    const template = demoPortfolio.properties[0]!;
    const warning = template.warnings[0]!;
    const data: Portfolio = {
      ...demoPortfolio,
      properties: Array.from({ length: 100 }, (_, i) => ({
        ...template,
        property: { ...template.property, id: `property-${i}` },
        warnings: [{ ...warning, origin: 'live', externalId: `${i < 80 ? '100' : 200 + i}:${i % 3}`,
          issuedAt: new Date(Date.UTC(2026, 10, 20, 8, i)).toISOString(), level: i === 79 ? 'Red' : 'Yellow' }],
      })),
    };

    const result = buildOverviewVM(data, ui);
    expect(result.kpi.warnings).toBe(21);
    expect(result.kpi.warnAffected).toBe(100);
    const red = result.kpi.warnChips.find((chip) => chip.warningLevel === 'Red');
    expect(red?.n).toBe(1);
    expect(red?.items.map((item) => item.propertyId)).toEqual(Array.from({ length: 80 }, (_, i) => `property-${i}`));
    expect(result.warningPreview[0]).toMatchObject({ id: 'smhi_warnings:100', level: 'Red', affected: 80 });
    expect(result.warningPreview.slice(1).map(({ id }) => id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `smhi_warnings:${299 - i}`),
    );
  });

  it('finds the map for a feed row about any message of a merged closure (Palandergatan, 2026-11-18)', () => {
    // The list kept "Vägarbete" for the group; the feed row is about "Vägen avstängd" of the same closure.
    const snap = demoPortfolio.properties.find((s) => s.property.id === 'demo-arenastaden-hus-c')!;
    const kept = snap.events[1]!;
    const portfolio = {
      ...demoPortfolio,
      properties: demoPortfolio.properties.map((s) => (s === snap ? { ...s, events: s.events.map((e) => (e === kept ? { ...e, memberIds: [kept.id, 'closure-other-message'] } : e)) } : s)),
      feed: [{ ...demoPortfolio.feed[0]!, id: 'chg-839', propertyId: snap.property.id, eventId: 'closure-other-message' }],
    };
    expect(buildOverviewVM(portfolio, ui).feed[0]).toMatchObject({ mapEventId: kept.id, mapSingle: false });
  });

  it('gives older feed rows their day, so yesterday’s 22:00 is not read as tonight', () => {
    const now = '2026-11-18T22:10:00+01:00';
    expect(feedTime('2026-11-18T22:00:00+01:00', now)).toBe('22:00');
    expect(feedTime('2026-11-17T22:00:00+01:00', now)).toBe('igår 22:00');
    expect(feedTime('2026-11-16T07:30:00+01:00', now)).toBe('16 nov 07:30');
    // Midnight in Stockholm, not UTC: 00:30 local on the 18th is today at 22:10 local.
    expect(feedTime('2026-11-17T23:30:00Z', now)).toBe('00:30');
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
    expect(vm.hero.status.headline).toBe('5 av 8 fastigheter att bevaka');
    expect(vm.hero.status.detail).toBe('Högst: Augustendal Brygga · Orange varning (kraftig vind)'); // highest status first
    expect(vm.hero.statusDash.startsWith(String((5 / 8) * 2 * Math.PI * 28))).toBe(true);
    expect(vm.hero.avgTemp).toBe('3,9');
    expect(vm.hero.maxRain).toBe('22,1');
    expect(vm.hero.maxRainAt).toBe('Augustendal Brygga');
    expect(vm.hero.gust).toBe('25');
    // Weather / water / VMA / power at "Bevaka" or higher – regional news, static flood mapping, traffic and air never count.
    expect(vm.cats.map((c) => [c.label, c.n])).toEqual([['Väder', 1], ['Vatten', 3], ['VMA', 1], ['El', 0]]);
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
    expect(inner.kpi.alerts).toBe(1);
    expect(inner.groups.map((g) => g.count)).toEqual([8, 4, 4]);
  });

  it('bars start at zero before the ready animation', () => {
    const cold = buildOverviewVM(demoPortfolio, { ...ui, ready: false });
    expect(cold.kpi.smsW).toBe('0%');
    expect(cold.rows.every((r) => r.riskW === '0%')).toBe(true);
  });
});

describe('portfolio list gives every list view the same result as the full portfolio (S-10)', () => {
  const opts = { ready: true, isSmsOn: (s: PropertySnapshot) => s.sms.enabled, isRuleOn: (_: string, f: boolean) => f };
  // Everything the view model computes; embedded snapshots (vm.list, row.snapshot) compared by id.
  const computed = (vm: unknown) => JSON.parse(JSON.stringify(vm, (_k, v) => (v && typeof v === 'object' && 'property' in v && 'metrics' in v ? `snapshot:${(v as PropertySnapshot).property.id}` : v)));
  for (const [label, full] of [['demo', demoPortfolio], ['500 properties', scaleDemoPortfolio(demoPortfolio, 500)]] as const) {
    it(label, () => {
      const list = listPortfolio(full);
      for (const group of ['all', ...full.groups.map((g) => g.id)]) {
        const a = computed(buildOverviewVM(list, { ...opts, group }));
        expect(a).toEqual(computed(buildOverviewVM(full, { ...opts, group })));
        expect(JSON.stringify(a)).toContain('snapshot:');
      }
      list.properties.forEach((s, i) => expect(nowcastVM(s, list.generatedAt)).toEqual(nowcastVM(full.properties[i]!, full.generatedAt)));
    });
  }
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

  it('shows the air level in plain words with one short station line', () => {
    const airIndex = { stationId: 'x', stationName: 'Göteborg Gårda', distanceMeters: 3500, observedAt: '2026-11-24T18:00:00Z', classification: 'urban', band: 3, label: 'Måttlig', pollutants: ['pm25', 'pm10', 'no2'], missingPollutants: ['o3', 'so2'], method: 'eea_hourly_2024_v1' as const };
    const liveProperty = { ...missing, property: { ...missing.property, origin: 'live' as const } };
    const withAir = { ...liveProperty, monitoring: { ...(missing.monitoring ?? {}), airIndex } } as PropertySnapshot;
    const d = buildDetailVM(portfolio, withAir, { ready: true, metric: 'temp', smsOn: false, isRuleOn: (_i, f) => f });
    expect(d.aq).toBe('Måttlig');
    expect(d.live!.airNote).toBe('Något förhöjda halter vid mätstationen.');
    expect(d.live!.airLine).toMatch(/^Mätstation Göteborg Gårda · 3,5 km · /);
    // Method details and missing pollutants stay out of the customer view.
    expect(d.live!.airLine).not.toMatch(/EEA|Saknas|pm25|preliminärt/);

    const none = buildDetailVM(portfolio, liveProperty, { ready: true, metric: 'temp', smsOn: false, isRuleOn: (_i, f) => f });
    expect(none.live!.airNote).toBeNull();
    expect(none.live!.airLine).toBe('Inget aktuellt mätvärde i närheten');
  });

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
    expect(vm.hero.status.headline).toBe('0 av 1 fastighet att bevaka'); // warning status is still assessed
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

  it('serves the scaled test portfolio only in the demo, for valid sizes', async () => {
    expect((await loadDemoPortfolio(500)).status).toBe('unavailable');
    process.env.FASTIGHETSRADAR_DEMO_ENABLED = 'true';
    const scaled = await loadDemoPortfolio(500);
    expect(scaled.status === 'ok' && scaled.portfolio.properties.length).toBe(500);
    // Same size → same (cached) object; invalid or small sizes → the original demo.
    const again = await loadDemoPortfolio(500);
    expect(again.status === 'ok' && scaled.status === 'ok' && again.portfolio === scaled.portfolio).toBe(true);
    for (const n of [null, 0, 8, -3]) {
      const r = await loadDemoPortfolio(n);
      expect(r.status === 'ok' && r.portfolio.properties.length).toBe(8);
    }
  });

  it('gives the layout the list and the property page one full snapshot (S-10)', async () => {
    expect((await loadDemoPropertySnapshot(500, 'demo-gotgarden-17')).status).toBe('not_found');
    process.env.FASTIGHETSRADAR_DEMO_ENABLED = 'true';
    const layout = await loadDemoPortfolio(500);
    const page = await loadDemoPropertySnapshot(500, 'demo-gotgarden-17');
    expect(layout.status === 'ok' && layout.portfolio.properties.every((s) => !s.forecast?.series.length)).toBe(true);
    expect(page.status === 'ok' && page.snapshot.property.name).toBe('Götgården 17');
    expect(page.status === 'ok' && page.snapshot.forecast!.series.length).toBeGreaterThan(0);
    expect((await loadDemoPropertySnapshot(500, 'finns-inte')).status).toBe('not_found');
    expect((await loadDemoPropertySnapshot(null, 'demo-gotgarden-17')).status).toBe('not_found');
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
    groups: [],
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
