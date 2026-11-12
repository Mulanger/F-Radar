import { describe, expect, it } from 'vitest';
import type { Portfolio, PropertySnapshot } from '@fastighetsradar/domain';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import { buildOverviewVM } from '@/lib/view-models/overview';
import { buildDetailVM } from '@/lib/view-models/detail';
import { chartOf, smooth } from '@/lib/view-models/chart';
import { loadPortfolio } from '@/lib/data/portfolio';

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
    expect(vm.kpi.smsSub).toBe('7 of 8 properties with SMS enabled');
    expect(vm.kpi.barLabel).toBe('3 normal · 2 monitor · 2 warning · 1 critical');
  });

  it('hero and health', () => {
    expect(vm.hero.risk).toBe('43');
    expect(vm.hero.avgTemp).toBe('3.9');
    expect(vm.hero.maxRain).toBe('22.1');
    expect(vm.hero.maxRainAt).toBe('Augustendal Brygga');
    expect(vm.hero.gust).toBe('25');
    expect(vm.healthPct).toBe(38);
    expect(vm.cats.map((c) => c.n)).toEqual([4, 3, 2, 6, 2]);
  });

  it('table sorted by risk and feed formatted in local time', () => {
    expect(vm.rows[0]!.name).toBe('Augustendal Brygga');
    expect(vm.rows[0]!.warn).toBe('Orange · Strong wind');
    expect(vm.rows.find((r) => r.name === 'Ulvsunda Lager')!.aq).toBe('Poor');
    expect(vm.feed[0]).toMatchObject({ t: '14:32', src: 'SMHI', prop: 'Augustendal Brygga' });
    expect(vm.dateLine).toBe('Wednesday 12 November · Stockholm region · Demo data');
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
    expect(d.water.dist).toBe('15 m · inside buffer');
    expect(d.warnings.map((w) => [w.level, w.start, w.end])).toEqual([
      ['Orange', 'Wed 16:00', 'Thu 10:00'],
      ['Yellow', 'Thu 06:00', 'Thu 20:00'],
    ]);
    expect(d.sms.rules.map((r) => r.state)).toEqual(['Triggered today', 'Triggered today', 'Triggered today', 'Triggered today', 'Armed']);
    expect(d.chart?.xLabels).toEqual(['Now', '20:00', '02:00', '08:00', '14:00']);
    expect(d.timeline[0]!.time).toBe('14:34');
  });

  it('wraps prev/next around the portfolio', () => {
    const first = buildDetailVM(demoPortfolio, demoPortfolio.properties[0]!, { ready: true, metric: 'rain', smsOn: false, isRuleOn: (_i, f) => f });
    expect(first.prevId).toBe(demoPortfolio.properties[7]!.property.id);
    expect(first.chart?.stats[3]!.label).toBe('Total');
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
  const portfolio: Portfolio = { ...demoPortfolio, origin: 'live', properties: [missing], feed: [], demoTrends: null };

  it('shows em dashes and "Not assessed" instead of zeros or "Normal"', () => {
    const d = buildDetailVM(portfolio, missing, { ready: true, metric: 'temp', smsOn: false, isRuleOn: (_i, f) => f });
    expect(d.temp).toBe('—');
    expect(d.rain).toBe('—');
    expect(d.aqi).toBe('—');
    expect(d.risk).toBe('—');
    expect(d.gauge.label).toBe('Not assessed');
    expect(d.chart).toBeNull();
    expect(d.water.flood).toBe('Unknown');
    expect(d.water.basement).toBe('—');
    expect(d.timeline).toEqual([]); // demo timeline never shown for live data
    // Unknown values never trigger rules
    expect(d.sms.rules.find((r) => r.code === 'RN')!.hit).toBe(false);

    const vm = buildOverviewVM(portfolio, ui);
    expect(vm.hero.risk).toBe('—');
    expect(vm.hero.riskLabel).toBe('Not assessed');
    expect(vm.rows[0]!.temp).toBe('—');
    expect(vm.rows[0]!.aq).toBe('—');
    expect(vm.kpi.alertsDelta).toBeNull();
  });
});

describe('data loader', () => {
  it('serves labelled demo fixtures in demo mode', async () => {
    delete process.env.FASTIGHETSRADAR_DATA_MODE;
    const r = await loadPortfolio();
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.portfolio.origin).toBe('demo_fixture');
  });
  it('never falls back to fixtures in live mode', async () => {
    process.env.FASTIGHETSRADAR_DATA_MODE = 'live';
    const r = await loadPortfolio();
    expect(r.status).toBe('unavailable');
    delete process.env.FASTIGHETSRADAR_DATA_MODE;
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
