import { z } from 'zod';
import { RadarCoverageSchema } from '@fastighetsradar/domain';
import { httpRequest, iso, num } from '../http';
import type { AdapterContext, AdapterResult } from '../types';

export const MET_ATTRIBUTION = 'Data från MET Norway · bearbetad av FastighetsRadar (CC BY 4.0)';
const Schema = z.object({ properties: z.object({ meta: z.object({ updated_at: z.string(), radar_coverage: RadarCoverageSchema }), timeseries: z.array(z.object({ time:z.string(), data:z.object({ instant:z.object({ details:z.record(z.string(),z.unknown()) }) }) })) }) });
export function metNowcastUrl(base: string, lat: number, lon: number) {
  return `${base.replace(/\/+$/,'')}/complete?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
}
export function parseMetNowcast(raw: unknown) {
  const p=Schema.safeParse(raw); if(!p.success || !iso(p.data.properties.meta.updated_at)) return null;
  return { updatedAt:iso(p.data.properties.meta.updated_at)!, coverage:p.data.properties.meta.radar_coverage,
    temperature:num(p.data.properties.timeseries[0]?.data.instant.details.air_temperature),
    points:p.data.properties.timeseries.filter(x=>iso(x.time)).map(x=>({ validAt:iso(x.time)!, rateMmH: (()=>{ const n=num(x.data.instant.details.precipitation_rate);return n!=null&&n>=0?n:null; })() })) };
}
export type MetNowcastData = NonNullable<ReturnType<typeof parseMetNowcast>>;
export async function fetchMetNowcast(lat:number,lon:number,ctx:AdapterContext,lastModified?:string|null): Promise<AdapterResult<{ data:MetNowcastData|null; notModified:boolean; expiresAt:string; lastModified:string|null }>> {
  if(!ctx.env.MET_NORWAY_CONTACT) return {ok:false,error:'access_required',detail:'MET_NORWAY_CONTACT saknas'};
  const r=await httpRequest(metNowcastUrl(ctx.env.MET_NOWCAST_BASE_URL,lat,lon),ctx,{label:'met_nowcast',attempts:1,acceptNotModified:true,headers:{'User-Agent':`FastighetsRadar/0.4 (${ctx.env.MET_NORWAY_CONTACT})`,...(lastModified?{'If-Modified-Since':lastModified}:{})}});
  if(!r.ok)return r;
  const expiresAt=iso(r.data.headers.get('expires'))??new Date(+ctx.now()+300_000).toISOString();
  const modified=r.data.headers.get('last-modified')??lastModified??null;
  if(r.data.status===304)return {ok:true,fetchedAt:r.fetchedAt,data:{data:null,notModified:true,expiresAt,lastModified:modified}};
  try {
    const data=parseMetNowcast(await r.data.json());
    return data?{ok:true,fetchedAt:r.fetchedAt,data:{data,notModified:false,expiresAt,lastModified:modified}}:{ok:false,error:'invalid_payload',detail:'met_nowcast: schema mismatch'};
  } catch { return {ok:false,error:'invalid_payload',detail:'met_nowcast: invalid JSON'}; }
}
