import { expect,it,vi } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { runNowcast,type JobContext } from '../src/monitoring/jobs';
const now=new Date('2026-11-13T17:05:00Z');
it('skips absent contact, respects Expires and preserves series on 304',async()=>{
  const statements:string[]=[];
  const cached={point_key:'59.33,18.06',expires_at:new Date(+now+60_000),last_modified:'Fri, 13 Nov 2026 17:00:00 GMT'};
  const fetchMock=vi.fn(async()=>new Response(null,{status:304,headers:{Expires:'Fri, 13 Nov 2026 17:10:00 GMT'}}));
  const ctx:JobContext={adapter:{env:loadServerEnv({}),fetch:fetchMock,now:()=>now,logger:{debug(){},info(){},warn(){},error(){}}},db:{async query<R>(sql:string){
    statements.push(sql);
    return {rows:(sql.includes('FROM properties WHERE')?[{id:'p',lat:59.331,lon:18.061}]:sql.includes('FROM nowcast_points')?[cached]:[]) as R[]};
  }}};
  expect((await runNowcast(ctx)).status).toBe('skipped');expect(statements).toHaveLength(0);
  ctx.adapter.env.MET_NORWAY_CONTACT='https://f-radar.se';
  expect((await runNowcast(ctx)).items).toBe(0);expect(fetchMock).not.toHaveBeenCalled();
  cached.expires_at=new Date(+now-1);
  expect((await runNowcast(ctx)).items).toBe(1);expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(statements.some(s=>s.startsWith('UPDATE nowcast_points SET fetched_at='))).toBe(true);
  expect(statements.some(s=>s.includes('SET series='))).toBe(false);
});
