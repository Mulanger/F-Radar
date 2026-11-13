import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { parseOceanography } from '../src';
const raw=JSON.parse(readFileSync(new URL('./fixtures/smhi-ocobs-14.json',import.meta.url),'utf8'));
it('preserves every valid minute reading with explicit RW datum',()=>{
  const p=parseOceanography(raw)!;
  expect(p.length).toBe(raw.station.reduce((n:number,s:{value:unknown[]})=>n+s.value.length,0));
  expect(p[0]).toMatchObject({sourceId:'smhi_oceanography',parameter:'sea_level',unit:'cm',extra:{referenceSystem:'RW',parameterId:14}});
  const rh=structuredClone(raw);rh.parameter.key='13';expect(parseOceanography(rh)).toBeNull();
  const missing=structuredClone(raw);missing.station[0].value[0].value='9999';expect(parseOceanography(missing)!.length).toBe(p.length-1);
});
