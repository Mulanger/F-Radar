import { WEATHER_WATER as T } from './weather-information';
export interface TimedReading { observedAt:string; value:number|null }
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
