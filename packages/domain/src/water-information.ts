import { WEATHER_WATER as T } from './weather-information';
export interface TimedReading { observedAt:string; value:number|null }
export function stationMatchDistance(source:string) {
  return source==='smhi_oceanography'?T.seaDistanceM:source==='smhi_hydrology'?T.flowDistanceM:source==='air_quality'?T.airDistanceM:T.observationDistanceM;
}
/** Quarter-hour amounts at interval end; sum only whole, aligned intervals with ≥90% coverage. */
export function measuredPrecipitation(points:TimedReading[],now:Date,hours:number) {
  const end=Math.floor(+now/900_000)*900_000, start=end-hours*3_600_000;
  const unique=new Map(points.filter(p=>Date.parse(p.observedAt)>start&&Date.parse(p.observedAt)<=end&&Date.parse(p.observedAt)%900_000===0).map(p=>[p.observedAt,p]));
  const valid=[...unique.values()].filter(p=>p.value!=null&&Number.isFinite(p.value)&&p.value>=0);
  const expected=hours*4,coverage=valid.length/expected;
  return {hours,from:new Date(start).toISOString(),to:new Date(end).toISOString(),coverage:Math.min(1,coverage),
    totalMm:coverage>=T.historyCoverage?Math.round(valid.reduce((n,p)=>n+p.value!,0)*10)/10:null,
    complete:coverage>=T.historyCoverage};
}
export function percentile(values:number[], p:number):number|null {
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length||p<0||p>1)return null;
  const i=(sorted.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);
  return sorted[lo]!+(sorted[hi]!-sorted[lo]!)*(i-lo);
}
export function classifyFlow(value:number|null,reference:{p75:number;p95:number}|null):string|null {
  if(value==null||!Number.isFinite(value)||!reference||!Number.isFinite(reference.p75)||!Number.isFinite(reference.p95)||reference.p75>reference.p95)return null;
  return value<reference.p75?'Normalt för årstiden':value<=reference.p95?'Högt för årstiden':'Mycket högt för årstiden';
}
export function monthlyFlowReference(values:number[], years:number,days:number) {
  if(years<T.referenceMinYears||days<T.referenceMinDays)return null;
  const p75=percentile(values,T.flowNormalPercentile),p95=percentile(values,T.flowHighPercentile);
  return p75==null||p95==null?null:{p75,p95,samples:values.length,years,days};
}
/** End-to-end measured change; no extrapolation when the window has insufficient coverage. */
export function measurementTrend(points:TimedReading[],now:Date,hours:number,unit:string,deadband=0):string|null {
  const p=[...new Map(points.filter(x=>x.value!=null&&Date.parse(x.observedAt)<=+now&&Date.parse(x.observedAt)>=+now-hours*3_600_000).map(x=>[x.observedAt,x])).values()].sort((a,b)=>a.observedAt.localeCompare(b.observedAt));
  const first=p[0],last=p.at(-1);
  if(!first||!last||Date.parse(last.observedAt)-Date.parse(first.observedAt)<hours*3_600_000*T.trendCoverage || +now-Date.parse(last.observedAt)>hours*3_600_000*(1-T.trendCoverage))return null;
  const delta=last.value!-first.value!,elapsed=(Date.parse(last.observedAt)-Date.parse(first.observedAt))/3_600_000;
  if(Math.abs(delta)<=deadband)return `oförändrat (${hours} h)`;
  const rate=Math.round(delta/elapsed*10)/10;
  return `${delta>0?'stigande':'sjunkande'} ca ${rate>0?'+':''}${rate.toLocaleString('sv-SE')} ${unit}/h (${hours} h)`;
}
