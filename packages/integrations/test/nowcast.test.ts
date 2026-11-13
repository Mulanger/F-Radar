import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { loadServerEnv } from '@fastighetsradar/config';
import { fetchMetNowcast,metNowcastUrl,parseMetNowcast,type AdapterContext } from '../src';
const raw=JSON.parse(readFileSync(new URL('./fixtures/met-nowcast-live.json',import.meta.url),'utf8'));
it('parses the real GeoJSON fixture and preserves missing rates',()=>{
  const data=parseMetNowcast(raw)!;
  expect(data.coverage).toBe('ok');expect(data.points.length).toBeGreaterThan(12);expect(data.temperature).not.toBeNull();
  const missing=structuredClone(raw); delete missing.properties.timeseries[0].data.instant.details.precipitation_rate;
  expect(parseMetNowcast(missing)!.points[0]!.rateMmH).toBeNull();
  expect(parseMetNowcast({})).toBeNull();
  expect(metNowcastUrl('https://example.test/',59.336765,18.062705)).toBe('https://example.test/complete?lat=59.3368&lon=18.0627');
});
it('sends identifying and conditional headers, handles 304 without JSON',async()=>{
  const modified='Fri, 13 Nov 2026 17:00:00 GMT',expires='Fri, 13 Nov 2026 17:10:00 GMT';
  const ctx:AdapterContext={env:loadServerEnv({MET_NORWAY_CONTACT:'https://f-radar.fr-2.instapods.app'}),now:()=>new Date('2026-11-13T17:05:00Z'),logger:{debug(){},info(){},warn(){},error(){}},fetch:(async(_url,init)=>{
    expect(init?.headers).toMatchObject({'If-Modified-Since':modified,'User-Agent':'FastighetsRadar/0.4 (https://f-radar.fr-2.instapods.app)'});
    return new Response(null,{status:304,headers:{Expires:expires,'Last-Modified':modified}});
  }) as typeof fetch};
  expect(await fetchMetNowcast(59.33,18.06,ctx,modified)).toMatchObject({ok:true,data:{notModified:true,data:null,expiresAt:'2026-11-13T17:10:00.000Z',lastModified:modified}});
});
