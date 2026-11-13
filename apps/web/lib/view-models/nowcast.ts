import type { PropertySnapshot } from '@fastighetsradar/domain';
import { formatClock, formatNumber, summarizeNowcast, WEATHER_WATER as T } from '@fastighetsradar/domain';

export function nowcastVM(s: PropertySnapshot, nowIso: string) {
  const n=s.nowcast, now=new Date(nowIso), age=n?(+now-Date.parse(n.fetchedAt))/60_000:Infinity;
  const summary=n?summarizeNowcast(n.points,now,null,{coverage:n.coverage,fetchedAt:n.fetchedAt}):null;
  const usable=n && summary?.state!=='unavailable' && age<=T.nowcastUsableMinutes;
  const stale=age>T.nowcastFreshMinutes;
  const phase=n?.summary.phase==='snow'?' · troligen som snö':n?.summary.phase==='mixed'?' · regn eller snö':n?.summary.phase==='unknown'?' · nederbördsform ej tillgänglig':'';
  const type=n?.summary.phase==='rain'?'Regn':'Nederbörd';
  let text = n?.coverage==='no coverage'?'Platsen ligger utanför radartäckningen.':n?.coverage==='temporarily unavailable'?'Radarprognos ej tillgänglig just nu (radaravbrott).':'Radarprognos ej tillgänglig just nu';
  let badge: string | null=null;
  if(usable && summary) {
    const minutes=summary.startsAt?Math.max(0,Math.round((Date.parse(summary.startsAt)-+now)/60_000)):null;
    text=summary.state==='dry'?'Ingen nederbörd på radarn under den tillgängliga prognosperioden.':summary.state==='starting'?`${type} väntas börja ca ${formatClock(summary.startsAt)} (om ~${minutes} min).`:`Nederbörd på radarn nu.`;
    if(summary.state!=='dry') {
      text+=` ${summary.intensity}, som mest ca ${formatNumber(summary.peakRateMmH!,1)} mm/h${phase}.`;
      if(summary.endsAt)text+=` Väntas avta runt ${formatClock(summary.endsAt)}.`;
      if(!stale && (summary.state!=='starting'||minutes!<=60))badge=summary.state==='starting'?`${type} om ~${minutes} min`:n?.summary.phase==='rain'?'Regnar nu':'Nederbörd nu';
    }
    if(stale)text='Inaktuell radarprognos · '+text;
  }
  const max=Math.max(1,...(n?.points.map(p=>p.rateMmH??0)??[]));
  const bars=Array.from({length:24},(_,i)=>{
    const at=+now+i*300_000;
    const p=usable?n!.points.find(p=>Date.parse(p.validAt)<=at && Date.parse(p.validAt)+300_000>at):null;
    return { at:formatClock(new Date(at).toISOString()), height:p?.rateMmH==null?null:Math.max(2,p.rateMmH/max*100), label:p?.rateMmH==null?'Ej tillgänglig':`${formatNumber(p.rateMmH,1)} mm/h` };
  });
  return { text,badge,bars,tone:usable && (summary?.peakRateMmH??0)>=T.heavyMmH?'warning':'monitor',
    source:n?`Radarprognos från MET Norway · uppdaterad ${formatClock(n.updatedAt)} · hämtad ${formatClock(n.fetchedAt)} · kan ändras snabbt vid skurar${n.origin==='demo_fixture'?' · demo':''}`:'MET Norway · ej ansluten',
    attribution:n?.attribution??'Data från MET Norway · bearbetad av FastighetsRadar', licenseUrl:'https://creativecommons.org/licenses/by/4.0/' };
}
