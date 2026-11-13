import { expect,it } from 'vitest';
import { measuredPrecipitation,measurementTrend } from '../src';
const now=new Date('2026-11-13T12:03:00Z');
const rain=(count=288)=>Array.from({length:count},(_,i)=>({observedAt:new Date(Date.parse('2026-11-13T12:00:00Z')-i*900_000).toISOString(),value:1}));
it('sums aligned measured intervals and ignores duplicates without treating gaps as zero',()=>{
  expect(measuredPrecipitation(rain(),now,1)).toMatchObject({totalMm:4,coverage:1,complete:true,to:'2026-11-13T12:00:00.000Z'});
  expect(measuredPrecipitation(rain(),now,24).totalMm).toBe(96);
  expect(measuredPrecipitation([...rain(),...rain()],now,72).totalMm).toBe(288);
  expect(measuredPrecipitation(rain(259),now,72)).toMatchObject({totalMm:null,complete:false}); // >10% missing
  expect(measuredPrecipitation(rain(260),now,72)).toMatchObject({totalMm:260,complete:true});
  expect(measuredPrecipitation([],now,1).totalMm).toBeNull();
  expect(measuredPrecipitation(rain().map(x=>({...x,value:null})),now,1).totalMm).toBeNull();
});
it('requires enough time span for six-hour sea and 24-hour flow trends',()=>{
  const points=Array.from({length:145},(_,i)=>({observedAt:new Date(+now-24*3_600_000+i*600_000).toISOString(),value:i}));
  expect(measurementTrend(points,now,24,'m³/s')).toContain('(24 h)');
  expect(measurementTrend(points,now,6,'cm',2)).toContain('(6 h)');
  expect(measurementTrend(points.slice(-10),now,6,'cm',2)).toBeNull();
});
