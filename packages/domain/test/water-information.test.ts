import { expect,it } from 'vitest';
import { measurementTrend } from '../src';
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
