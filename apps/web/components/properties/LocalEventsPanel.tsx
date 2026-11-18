'use client';

import { formatTrafficRadius } from '@fastighetsradar/domain';
import { NightMoon } from '../dashboard/NightMoon';
import type { DetailVM } from '@/lib/view-models/detail';
import { C, card, cardSub, cardTitle, tile } from '@/lib/design/tokens';
import type { EventMapState } from './use-event-map';
import s from './LocalEventsPanel.module.css';

const MAP_ICON = 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14';

/** "Local Events & Disruptions" list + counters. Events with a position open "Visa på karta". */
export function LocalEventsPanel({ d, map }: { d: DetailVM; map?: EventMapState }) {
  return (
    <div style={{ ...card, flex: '1 1 380px', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={cardTitle}>Händelser och störningar i närheten</div>
        <div style={cardSub}>{d.live ? `Trafikverket inom ${d.trafficRadiusM ? formatTrafficRadius(d.trafficRadiusM) : 'valt avstånd'} · Krisinformation per län (regional information)` : 'Inom 1,5 km från fastigheten'}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {[
          ['Länsinfo', d.crisisN],
          ['Trafik', d.trafficN],
          ['Övrigt', d.otherN],
        ].map(([label, n]) => (
          <div key={label} style={tile}>
            <div style={{ fontSize: 11.5, color: C.text4 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 500 }}>{n}</div>
          </div>
        ))}
      </div>
      {!d.avail.events && (
        <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: C.text3, borderRadius: 14, background: '#F8F9F8' }}>
          {d.live ? 'Händelsekällorna (Krisinformation, Trafikverket) kunde inte hämtas – händelser i närheten kan inte visas.' : 'Händelsekällorna (Krisinformation, Trafikverket) är inte anslutna – händelser i närheten kan inte visas.'}
        </div>
      )}
      {d.avail.events && d.noEvents && !d.outageEvents.length && <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: C.text3, borderRadius: 14, background: '#F8F9F8' }}>{d.live ? 'Inga rapporterade händelser i närheten' : 'Inga rapporterade störningar i närheten'}</div>}
      {/* Outages come first: those that cover the property, then (with a caveat) ongoing ones in its postal/operating area. */}
      {d.outageEvents.map((o) => (
        <div key={o.id} data-testid="outage-event" style={{ display: 'flex', gap: 12, padding: '12px 0', borderTop: '1px solid rgba(20,23,26,0.05)' }}>
          <span style={{ flexShrink: 0, alignSelf: 'flex-start', fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 7, background: o.bg, color: o.c }}>{o.kind}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, lineHeight: 1.35 }}>{o.title}</div>
            <div style={{ fontSize: 11.5, color: C.text2, marginTop: 3 }}>
              {o.areaOnly ? <span style={{ color: C.text3 }}>{o.scope}</span> : <b style={{ fontWeight: 600 }}>{o.scope}</b>} · {o.when}
            </div>
            {o.operatorText && <div style={{ fontSize: 11.5, color: C.text3, marginTop: 3 }}>Nätbolaget: ”{o.operatorText}”</div>}
            <div style={{ fontSize: 11, color: C.text4, marginTop: 3 }}>
              Källa:{' '}
              {o.sourceUrl ? (
                <a href={o.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>{o.source}</a>
              ) : (
                o.source
              )}
            </div>
          </div>
        </div>
      ))}
      {d.events.map((e) => {
        const onMap = Boolean(map?.mappable.has(e.id));
        const body = (
          <>
            <span className={s.kind} style={{ background: e.bg, color: e.c }}>{e.kind}</span>
            <span className={s.main}>
              <span className={s.title}>{e.title}</span>
              <span className={s.meta}>{e.src} · {e.dist} · {e.time}{e.nightWork && <> · <NightMoon label={e.nightWork} text /></>}</span>
              {onMap && (
                <span className={s.pill}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={MAP_ICON} /></svg>
                  Visa på karta
                </span>
              )}
            </span>
            {onMap && <svg className={s.chev} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>}
          </>
        );
        return onMap ? (
          <button key={e.id} type="button" className={`${s.row} ${s.button}`} onClick={() => map!.open(e.id)} aria-label={`${e.title}. Visa på karta`}>{body}</button>
        ) : (
          <div key={e.id} className={s.row}>{body}</div>
        );
      })}
      {d.live && <div style={{ fontSize: 11, color: C.text4, lineHeight: 1.45, marginTop: 'auto' }}>{d.live.eventsLine}</div>}
    </div>
  );
}
