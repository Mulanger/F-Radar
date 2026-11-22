import type { PropertySnapshot } from '@fastighetsradar/domain';
import { formatClock, formatNumber, summarizeNowcast, WEATHER_WATER as T } from '@fastighetsradar/domain';

/** What both the badge and the full panel derive from the stored nowcast at `nowIso`. */
function nowcastState(s: PropertySnapshot, nowIso: string) {
  const n=s.nowcast, now=new Date(nowIso), age=n?(+now-Date.parse(n.fetchedAt))/60_000:Infinity;
  const summary=n?summarizeNowcast(n.points,now,null,{coverage:n.coverage,fetchedAt:n.fetchedAt}):null;
  const usable=n && summary?.state!=='unavailable' && age<=T.nowcastUsableMinutes;
  const stale=age>T.nowcastFreshMinutes;
  const minutes=usable && summary?.startsAt?Math.max(0,Math.round((Date.parse(summary.startsAt)-+now)/60_000)):null;
  const type=n?.summary.phase==='rain'?'Regn':'Nederbörd';
  return { n, now, summary, usable, stale, minutes, type };
}

function badgeOf(st: ReturnType<typeof nowcastState>): string | null {
  const { n, summary, usable, stale, minutes, type } = st;
  if (!usable || !summary || summary.state === 'dry' || stale) return null;
  if (summary.state === 'starting' && minutes! > 60) return null;
  return summary.state==='starting'?`${type} om ~${minutes} min`:n?.summary.phase==='rain'?'Regnar nu':'Nederbörd nu';
}

function sourceOf(n: PropertySnapshot['nowcast']): string {
  return n?`Radarprognos från MET Norway · uppdaterad ${formatClock(n.updatedAt)} · hämtad ${formatClock(n.fetchedAt)} · kan ändras snabbt vid skurar${n.origin==='demo_fixture'?' · demo':''}`:'MET Norway · ej ansluten';
}

/**
 * What a list row shows of the radar nowcast: the badge ("Regn om ~10 min") and its source line.
 * List views (overview, property list, Snabbväxla) never show the 24 bars of the property page,
 * which were most of `buildOverviewVM` at 500 properties (docs/plans/skalning.md, Fas 3).
 */
export function nowcastBadge(s: PropertySnapshot, nowIso: string): { badge: string | null; source: string } {
  return { badge: badgeOf(nowcastState(s, nowIso)), source: sourceOf(s.nowcast) };
}

/** The full nowcast panel of the property page (text, 24 five-minute bars, tone). */
export function nowcastVM(s: PropertySnapshot, nowIso: string) {
  const st=nowcastState(s, nowIso);
  const { n, now, summary, usable, stale, minutes, type } = st;
  const phase=n?.summary.phase==='snow'?' · troligen som snö':n?.summary.phase==='mixed'?' · regn eller snö':n?.summary.phase==='unknown'?' · nederbördsform ej tillgänglig':'';
  let text = n?.coverage==='no coverage'?'Platsen ligger utanför radartäckningen.':n?.coverage==='temporarily unavailable'?'Radarprognos ej tillgänglig just nu (radaravbrott).':'Radarprognos ej tillgänglig just nu';
  if(usable && summary) {
    text=summary.state==='dry'?'Ingen nederbörd på radarn under den tillgängliga prognosperioden.':summary.state==='starting'?`${type} väntas börja ca ${formatClock(summary.startsAt)} (om ~${minutes} min).`:`Nederbörd på radarn nu.`;
    if(summary.state!=='dry') {
      const intensity=summary.intensity ? summary.intensity[0]!.toUpperCase()+summary.intensity.slice(1) : 'Nederbörd';
      text+=` ${intensity}, som mest ca ${formatNumber(summary.peakRateMmH!,1)} mm/h${phase}.`;
      if(summary.endsAt)text+=` Väntas avta runt ${formatClock(summary.endsAt)}.`;
    }
    if(stale)text='Inaktuell radarprognos · '+text;
  }
  const max=Math.max(1,...(n?.points.map(p=>p.rateMmH??0)??[]));
  const bars=Array.from({length:24},(_,i)=>{
    const at=+now+i*300_000;
    const p=usable?n!.points.find(p=>Date.parse(p.validAt)<=at && Date.parse(p.validAt)+300_000>at):null;
    return { at:formatClock(new Date(at).toISOString()), height:p?.rateMmH==null?null:Math.max(2,p.rateMmH/max*100), label:p?.rateMmH==null?'Ej tillgänglig':`${formatNumber(p.rateMmH,1)} mm/h` };
  });
  return { text,badge:badgeOf(st),bars,tone:usable && (summary?.peakRateMmH??0)>=T.heavyMmH?'warning':'monitor',
    source:sourceOf(n),
    attribution:n?.attribution??'Data från MET Norway · bearbetad av FastighetsRadar', licenseUrl:'https://creativecommons.org/licenses/by/4.0/' };
}
