import { describe,expect,it } from 'vitest';
import { summarizeNowcast } from '../src';
const now=new Date('2026-11-13T12:00:00Z');
const points=(rate:number)=>Array.from({length:24},(_,i)=>({validAt:new Date(+now+i*300_000).toISOString(),rateMmH:rate}));
describe('radar summary',()=>{
  it('distinguishes dry, starting, ongoing and ending',()=>{
    expect(summarizeNowcast(points(0.19),now,5)).toMatchObject({state:'dry',totalNext60Mm:0});
    const p=points(4);p.slice(0,4).forEach(x=>x.rateMmH=0);
    expect(summarizeNowcast(p,now,5)).toMatchObject({state:'starting',startsAt:p[4]!.validAt,intensity:'måttligt'});
    expect(summarizeNowcast(points(4),now,5)).toMatchObject({state:'ongoing',totalNext60Mm:4});
    p[0]!.rateMmH=1;p[1]!.rateMmH=0;
    expect(summarizeNowcast(p,now,5)).toMatchObject({state:'ending',endsAt:p[1]!.validAt});
  });
  it('keeps the first spell peak consistent with its end when another shower follows',()=>{
    const p=points(0);p[0]!.rateMmH=1;p[4]!.rateMmH=10;
    expect(summarizeNowcast(p,now,5)).toMatchObject({state:'ending',endsAt:p[1]!.validAt,peakRateMmH:1,peakAt:p[0]!.validAt});
  });
  it.each(['no coverage','temporarily unavailable'] as const)('does not invent dry weather during %s',coverage=>expect(summarizeNowcast(points(0),now,5,{coverage}).state).toBe('unavailable'));
  it('expires after 30 minutes and rejects gaps, unknown rates and old series',()=>{
    expect(summarizeNowcast(points(0),now,5,{fetchedAt:new Date(+now-31*60_000).toISOString()}).state).toBe('unavailable');
    expect(summarizeNowcast([],now,5).state).toBe('unavailable');
    const p=points(1);p.splice(4,1);expect(summarizeNowcast(p,now,5).state).toBe('unavailable');
    expect(summarizeNowcast(points(1).map(x=>({...x,rateMmH:null})),now,5).state).toBe('unavailable');
  });
  it.each([[0.5,'snow'],[0.51,'mixed'],[1.99,'mixed'],[2,'rain'],[null,'unknown']] as const)('phase at %s C', (t,phase)=>expect(summarizeNowcast(points(4),now,t).phase).toBe(phase));
  it.each([[2.49,'lätt'],[2.5,'måttligt'],[10,'kraftigt'],[50,'skyfallsintensitet']] as const)('intensity at %s mm/h',(r,intensity)=>expect(summarizeNowcast(points(r),now,5).intensity).toBe(intensity));
});
