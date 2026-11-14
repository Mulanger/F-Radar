import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import { buildDetailVM } from '@/lib/view-models/detail';
import { WaterRiskPanel } from '@/components/properties/WaterRiskPanel';

describe('live and demo water presentation', () => {
  it('omits flood thresholds in live and demo, and keeps the basement tile exclusive to demo', () => {
    const p = structuredClone(demoPortfolio);
    const s = p.properties.find((s) => typeof s.flood.waterBody?.level.value === 'number')!;
    const ui = { ready: true, metric: 'temp' as const, smsOn: false, isRuleOn: (_id: string, value: boolean) => value };
    const demo = renderToStaticMarkup(createElement(WaterRiskPanel, { d: buildDetailVM(p, s, ui) }));
    expect(demo).toContain('Källarrisk');
    expect(demo).not.toContain('Översvämningsgräns');
    expect(demo).not.toContain('+60 cm');
    p.origin = 'live'; s.property.origin = 'live';
    const live = renderToStaticMarkup(createElement(WaterRiskPanel, { d: buildDetailVM(p, s, ui) }));
    expect(live).not.toContain('Översvämningsgräns');
    expect(live).not.toContain('Källarrisk');
    expect(live).toContain('relativt medelvattenstånd');
  });
});
