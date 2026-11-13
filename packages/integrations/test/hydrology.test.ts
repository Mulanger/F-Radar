import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { parseHydrology,parseHydrologyArchive } from '../src';
it('parses all flow observations from a recorded latest-hour response',()=>{
  const raw=JSON.parse(readFileSync(new URL('./fixtures/smhi-hydroobs-2.json',import.meta.url),'utf8'));
  const p=parseHydrology(raw)!;expect(p.length).toBeGreaterThan(1);expect(p.every(x=>x.unit==='m³/s'&&x.parameter==='water_flow')).toBe(true);
  raw.parameter.key='3';expect(parseHydrology(raw)).toBeNull();
});
it('reads actual archive CSV and refuses insufficient or unrecognised references',()=>{
  const raw=readFileSync(new URL('./fixtures/smhi-hydro-archive.csv',import.meta.url),'utf8');
  const p=parseHydrologyArchive(raw)!;expect(p).toHaveLength(12);expect(p.every(x=>x.reference===null)).toBe(true);
  expect(parseHydrologyArchive('unknown format')).toBeNull();
  const lines=['Vattenföring (15 min);m³/s','Datum Tid (UTC);Vattenföring (15 min);Kvalitet'];
  for(let y=2020;y<2023;y++)for(let d=1;d<=10;d++)lines.push(`${y}-11-${String(d).padStart(2,'0')} 12:00:00;10;G;`);
  lines.push('2022-11-11 12:00:00;9999;G;','2022-11-12 12:00:00;999;Y;');
  expect(parseHydrologyArchive(lines.join('\n'))![10]!.reference).toMatchObject({p75:10,p95:10,samples:30,years:3,days:30});
});
