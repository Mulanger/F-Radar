import { monthlyFlowReference } from '@fastighetsradar/domain';
import { httpJson,httpRequest,iso,num } from '../http';
import type { AdapterContext,AdapterResult,StationObservation } from '../types';
import { StationSeriesSchema } from './ocobs';

export function parseHydrology(raw:unknown):StationObservation[]|null {
  const p=StationSeriesSchema.safeParse(raw);
  if(!p.success||p.data.parameter.key!=='2'||p.data.parameter.unit!=='m³/s')return null;
  return p.data.station.flatMap(s=>(s.value??[]).flatMap(v=>{
    const value=num(v.value,[9999]),observedAt=iso(v.date);
    return value==null||value<0||!observedAt?[]:[{sourceId:'smhi_hydrology' as const,stationId:String(s.key),name:s.name,lat:s.latitude,lon:s.longitude,parameter:'water_flow',unit:'m³/s',value,observedAt,quality:v.quality??null,extra:{parameterId:2}}];
  })).sort((a,b)=>a.observedAt!.localeCompare(b.observedAt!));
}
export function hydrologyUrl(base:string) {return `${base.replace(/\/+$/,'')}/version/latest/parameter/2/station-set/all/period/latest-hour/data.json`;}
export async function fetchHydrology(ctx:AdapterContext):Promise<AdapterResult<StationObservation[]>> {
  const r=await httpJson(hydrologyUrl(ctx.env.SMHI_HYDROLOGY_BASE_URL),ctx,{label:'smhi_hydrology',timeoutMs:30000});
  if(!r.ok)return r;const data=parseHydrology(r.data);
  return data?{ok:true,data,fetchedAt:r.fetchedAt}:{ok:false,error:'invalid_payload',detail:'smhi_hydrology: expected parameter 2 in m³/s'};
}

/** Streaming CSV aggregation avoids retaining the full multi-decade archive in memory. */
export function hydroArchiveAccumulator() {
  const months=Array.from({length:12},()=>({values:[] as number[],years:new Set<string>(),days:new Set<string>()}));
  let unit=false,header=false;
  return {
    line(line:string) {
      if(line.includes('Vattenföring (15 min);m³/s'))unit=true;
      if(line.startsWith('Datum Tid (UTC);Vattenföring (15 min);Kvalitet'))header=true;
      if(!unit||!header)return;
      const m=/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2});([^;]*);([^;]*)/.exec(line);
      if(!m||m[6]!=='G')return;
      const value=num(m[5]?.replace(',','.'),[9999]); if(value==null||value<0)return;
      const month=months[Number(m[2])-1];if(!month)return;
      month.values.push(value);month.years.add(m[1]!);month.days.add(`${m[1]}-${m[2]}-${m[3]}`);
    },
    finish() {return !unit||!header?null:months.map((m,i)=>({month:i+1,reference:monthlyFlowReference(m.values,m.years.size,m.days.size)}));},
  };
}
export function parseHydrologyArchive(text:string) {
  const a=hydroArchiveAccumulator();for(const line of text.split(/\r?\n/))a.line(line);return a.finish();
}
export async function fetchHydrologyReference(stationId:string,ctx:AdapterContext):Promise<AdapterResult<NonNullable<ReturnType<typeof parseHydrologyArchive>>>> {
  if(!/^\d+$/.test(stationId))return {ok:false,error:'invalid_payload',detail:'invalid station id'};
  const url=`${ctx.env.SMHI_HYDROLOGY_BASE_URL.replace(/\/+$/,'')}/version/latest/parameter/2/station/${stationId}/period/corrected-archive/data.csv`;
  const r=await httpRequest(url,ctx,{label:'hydrology_reference',timeoutMs:180000,attempts:1,headers:{Accept:'text/plain'}});
  if(!r.ok)return r;
  const a=hydroArchiveAccumulator(),decoder=new TextDecoder();let pending='';
  try {
    if(!r.data.body)return {ok:false,error:'invalid_payload',detail:'empty archive'};
    const reader=r.data.body.getReader();
    try {
      for(;;){const chunk=await reader.read();if(chunk.done)break;pending+=decoder.decode(chunk.value,{stream:true});const lines=pending.split('\n');pending=lines.pop()??'';for(const line of lines)a.line(line.replace(/\r$/,''));}
      a.line(pending+decoder.decode());
    } finally {reader.releaseLock();}
    const data=a.finish();return data?{ok:true,data,fetchedAt:r.fetchedAt}:{ok:false,error:'invalid_payload',detail:'unknown corrected-archive CSV format'};
  } catch {return {ok:false,error:'upstream_error',detail:'hydrology archive read failed'};}
}
