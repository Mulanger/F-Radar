import { expect,it } from 'vitest';
import { demoPortfolio } from '@fastighetsradar/domain/fixtures';
import { summarizeNowcast } from '@fastighetsradar/domain';
import { scaleDemoPortfolio } from '@fastighetsradar/domain/fixtures';
import { nowcastBadge, nowcastVM } from '@/lib/view-models/nowcast';
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

it('keeps measured rain gaps and own texts neutral',async()=>{
  const {buildDetailVM}=await import('@/lib/view-models/detail');
  const s=structuredClone(demoPortfolio.properties[0]!);
  s.measuredRain!.totals[1]!.totalMm=null;s.measuredRain!.totals[1]!.complete=false;
  const vm=buildDetailVM(demoPortfolio,s,{ready:true,metric:'rain',smsOn:false,isRuleOn:(_id,fallback)=>fallback});
  expect(vm.measuredRain!.totals[1]!.value).toBe('Ofullständig mätserie');
  expect(JSON.stringify([vm.measuredRain,vm.forecastDays,vm.water.watercourse,vm.water.source])).not.toMatch(/\bkris|fara|akut|katastrof|allvarlig|kritisk/i);
});

it('gives list rows exactly the badge and source of the full nowcast, at any time (Fas 3, list cost)',()=>{
  const p=scaleDemoPortfolio(demoPortfolio,60);
  const start=Date.parse(demoPortfolio.generatedAt);
  let badges=0;
  for(const minutes of [-40,-10,0,5,15,25,45,70,120]){
    const now=new Date(start+minutes*60_000).toISOString();
    for(const s of p.properties){
      const full=nowcastVM(s,now);
      expect(nowcastBadge(s,now)).toEqual({badge:full.badge,source:full.source});
      if(full.badge)badges++;
    }
  }
  expect(badges).toBeGreaterThan(0);
});

it('summarizes radar points in any stored order the same way',()=>{
  const s=demoPortfolio.properties[0]!;
  const now=new Date(demoPortfolio.generatedAt);
  const opts={coverage:s.nowcast!.coverage,fetchedAt:s.nowcast!.fetchedAt};
  const sorted=summarizeNowcast(s.nowcast!.points,now,2,opts);
  expect(summarizeNowcast([...s.nowcast!.points].reverse(),now,2,opts)).toEqual(sorted);
  expect(sorted.state).not.toBe('unavailable');
});

