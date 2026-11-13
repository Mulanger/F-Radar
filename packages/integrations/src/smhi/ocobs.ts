import { z } from 'zod';
import { httpJson, iso, num } from '../http';
import type { AdapterContext, AdapterResult, StationObservation } from '../types';

export const StationSeriesSchema = z.object({
  parameter:z.object({ key:z.string(),unit:z.string() }),
  station:z.array(z.object({ key:z.union([z.string(),z.number()]), name:z.string(),latitude:z.number(),longitude:z.number(),
    value:z.array(z.object({date:z.number(),value:z.union([z.string(),z.number()]).nullable(),quality:z.string().optional()})).nullish() })),
});
/** All valid minute readings are retained; callers select latest values only for the current table. */
export function parseOceanography(raw:unknown):StationObservation[]|null {
  const p=StationSeriesSchema.safeParse(raw);
  if(!p.success||p.data.parameter.key!=='14'||p.data.parameter.unit!=='cm')return null;
  return p.data.station.flatMap(s=>(s.value??[]).flatMap(v=>{
    const value=num(v.value,[9999]),observedAt=iso(v.date);
    return value==null||!observedAt?[]:[{sourceId:'smhi_oceanography' as const,stationId:String(s.key),name:s.name,lat:s.latitude,lon:s.longitude,parameter:'sea_level',unit:'cm',value,observedAt,quality:v.quality??null,extra:{referenceSystem:'RW',parameterId:14}}];
  })).sort((a,b)=>a.observedAt!.localeCompare(b.observedAt!));
}
export function oceanographyUrl(base:string) {return `${base.replace(/\/+$/,'')}/version/latest/parameter/14/station-set/all/period/latest-hour/data.json`;}
export async function fetchOceanography(ctx:AdapterContext):Promise<AdapterResult<StationObservation[]>> {
  const r=await httpJson(oceanographyUrl(ctx.env.SMHI_OCEANOGRAPHY_BASE_URL),ctx,{label:'smhi_oceanography',timeoutMs:30000});
  if(!r.ok)return r;
  const data=parseOceanography(r.data);
  return data?{ok:true,data,fetchedAt:r.fetchedAt}:{ok:false,error:'invalid_payload',detail:'smhi_oceanography: expected parameter 14, RW in cm'};
}
