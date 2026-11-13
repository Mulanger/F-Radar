import { expect,it } from 'vitest';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import { nowcastVM } from '@/lib/view-models/nowcast';
it('formats fresh, stale, expired and interrupted radar data neutrally',()=>{
  const s=structuredClone(demoPortfolio.properties[0]!);
  const now=demoPortfolio.generatedAt;
  expect(nowcastVM(s,now).badge).toBe('Regn om ~20 min');
  expect(nowcastVM(s,now).bars).toHaveLength(24);
  s.nowcast!.fetchedAt=new Date(Date.parse(now)-16*60_000).toISOString();
  expect(nowcastVM(s,now)).toMatchObject({badge:null});expect(nowcastVM(s,now).text).toContain('Inaktuell');
  s.nowcast!.fetchedAt=new Date(Date.parse(now)-31*60_000).toISOString();
  expect(nowcastVM(s,now).text).toBe('Radarprognos ej tillgänglig just nu');
  expect(nowcastVM(s,now).bars.every(b=>b.height==null)).toBe(true);
  for(const coverage of ['ok','temporarily unavailable','no coverage'] as const){
    s.nowcast!.coverage=coverage;
    const vm=nowcastVM(s,now);
    expect([vm.text,vm.source,vm.attribution].join(' ')).not.toMatch(/\bkris|fara|akut|katastrof|allvarlig|kritisk/i);
  }
});
