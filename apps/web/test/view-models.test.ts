import { afterEach, describe, expect, it, vi } from 'vitest';

// Clerk server helpers are mocked: the loader must only forward the session token.
const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }));
import { assessPropertyRisk, portfolioRisk, type Portfolio, type PropertySnapshot } from '@fastighetsradar/domain';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import { buildOverviewVM } from '@/lib/view-models/overview';
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
    expect(vm.kpi.atRisk).toBe(3);
    expect(vm.kpi.warnings).toBe(3);
    expect(vm.kpi.warnAffected).toBe(4);
    expect(vm.kpi.wx).toBe(7);
    expect(vm.kpi.sms).toBe(30);
    expect(vm.kpi.smsSub).toBe('7 av 8 fastigheter med SMS aktiverat');
    expect(vm.kpi.barLabel).toBe('Ingen aktiv varning: 3 · Bevaka: 2 · Varning: 2 · Kritisk: 1');
  });

  it('hero and health', () => {
    // Riskindex v1 (ADR 0003) replaces the hand-picked demo score: mean of the properties' index.
    const pr = portfolioRisk(demoPortfolio.properties.map((x) => ({ name: x.property.name, risk: x.riskIndex })));
    expect(vm.hero.risk).toBe(String(pr.score));
    expect(vm.hero.riskLabel).toMatch(new RegExp(`^(Låg|Bevaka) · högst Ulvsunda Lager \\(${pr.highest!.score}\\)$`));
    expect(vm.hero.avgTemp).toBe('3,9');
    expect(vm.hero.maxRain).toBe('22,1');
    expect(vm.hero.maxRainAt).toBe('Augustendal Brygga');
    expect(vm.hero.gust).toBe('25');
    expect(vm.healthPct).toBe(38);
    // Weather / water / VMA at "Bevaka" or higher – regional news, static flood mapping, traffic and air never count.
    expect(vm.cats.map((c) => [c.label, c.n])).toEqual([['Väder', 1], ['Vatten', 3], ['VMA', 1]]);
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
    expect(vm.hero.risk).toBe('—');
    expect(vm.hero.riskLabel).toBe('Ej bedömd');
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
    expect(vm.healthPct).toBeNull();
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
