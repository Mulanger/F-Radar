import { expect,it } from 'vitest';
import { measurementTrend,percentile,classifyFlow,monthlyFlowReference } from '../src';
const now=new Date('2026-11-13T12:00:00Z');
const series=(delta:number)=>Array.from({length:61},(_,i)=>({observedAt:new Date(+now-3_600_000+i*60_000).toISOString(),value:10+i*delta/60}));
it('uses measured deltas with a two-centimetre deadband and refuses insufficient coverage',()=>{
  expect(measurementTrend(series(6),now,1,'cm',2)).toBe('stigande ca +6 cm/h (1 h)');
  expect(measurementTrend(series(-6),now,1,'cm',2)).toBe('sjunkande ca −6 cm/h (1 h)');
  expect(measurementTrend(series(2),now,1,'cm',2)).toBe('oförändrat (1 h)');
  expect(measurementTrend(series(2.01),now,1,'cm',2)).toContain('stigande');
  expect(measurementTrend(series(6).slice(40),now,1,'cm',2)).toBeNull();
  expect(measurementTrend([],now,1,'cm',2)).toBeNull();
});
it('interpolates station percentiles and classifies the exact boundaries',()=>{
  expect(percentile([0,10,20,30,40],0.75)).toBe(30);
  expect(percentile([0,10,20,30,40],0.95)).toBe(38);
  expect(percentile([],0.75)).toBeNull();
  const ref={p75:30,p95:38};
  expect(classifyFlow(29.99,ref)).toBe('Normalt för årstiden');
  expect(classifyFlow(30,ref)).toBe('Högt för årstiden');
  expect(classifyFlow(38,ref)).toBe('Högt för årstiden');
  expect(classifyFlow(38.01,ref)).toBe('Mycket högt för årstiden');
  expect(classifyFlow(100,null)).toBeNull();
  expect(monthlyFlowReference([1,2,3],2,30)).toBeNull();
});
