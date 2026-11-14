'use client';

import type { NearbyObservation } from '@fastighetsradar/domain';
import { formatClock } from '@fastighetsradar/domain';
import type { DetailVM } from '@/lib/view-models/detail';
import { C, card, cardSub, cardTitle, tile } from '@/lib/design/tokens';

/**
 * "Mätningar och sammanhang" – live-only panel (Phase 3).
 * Keeps data classes visibly apart: station OBSERVATIONS (with station, distance, time),
 * modelled GROUNDWATER (regional), STATIC flood scenarios and REGIONAL statistics.
 * Nothing here is a risk score or an alert.
 */
const label: React.CSSProperties = { fontSize: 11.5, color: C.text4 };
const val: React.CSSProperties = { fontSize: 15, fontWeight: 500, marginTop: 2 };
const sect: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: C.text2, margin: '6px 0 2px' };
const pill = (bg: string, fg: string): React.CSSProperties => ({ fontSize: 10.5, fontWeight: 500, padding: '2px 7px', borderRadius: 7, background: bg, color: fg });

const CLASS_PILL = {
  OBSERVATION: pill('oklch(0.95 0.03 240)', 'oklch(0.45 0.08 240)'),
  MODEL: pill('oklch(0.95 0.03 200)', 'oklch(0.42 0.07 200)'),
  STATIC: pill('oklch(0.95 0.03 80)', 'oklch(0.45 0.08 70)'),
  STAT: pill('#F0F1F0', C.text3),
};

const fmtNum = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits).replace('.', ','));

function ObsTile({ o, fmtDist }: { o: NearbyObservation; fmtDist: (m: number | null | undefined) => string }) {
  const digits = o.parameter === 'wind_direction' || o.parameter === 'relative_humidity' ? 0 : 1;
  return (
    <div style={tile} title={`${o.provenance.attribution}${o.quality ? ` · kvalitetskod ${o.quality}` : ''}`}>
      <div style={label}>{o.label}</div>
      <div style={val}>
        {fmtNum(o.value, digits)} <span style={{ fontSize: 12, color: C.text4 }}>{o.unit}</span>
      </div>
      <div style={{ ...label, fontSize: 10.5, marginTop: 2 }}>
        {o.stationName} · {fmtDist(o.distanceMeters)} · {o.observedAt ? `${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(o.observedAt))} ${formatClock(o.observedAt)}` : '—'} · {o.provenance.authority}
        {o.qualityFlags.includes('preliminary') ? ' · preliminär' : ''}
        {o.provenance.sourceId === 'air_quality' ? ` · ${o.qualityFlags.includes('resolution:hour') ? 'timmedel' : o.qualityFlags.includes('resolution:minute') ? 'minutvärde' : o.qualityFlags.includes('resolution:day') ? 'dygnsmedel' : 'tidsupplösning: se källan'}` : ''}
        {o.qualityFlags.includes('suspect_or_aggregated') ? ' · ej granskad' : ''}
      </div>
    </div>
  );
}

export function MonitoringContextPanel({ d }: { d: DetailVM }) {
  const live = d.live;
  if (!live) return null;
  const m = live.monitoring;
  const fmtDist = live.fmtDist;
  const obs = m?.observations ?? [];
  const air = m?.airQuality ?? [];
  const gw = m?.groundwater ?? null;
  const st = m?.statistics ?? null;
  const fl = m?.flood ?? null;
  const cov = (id: string) => m?.coverage.find((c) => c.sourceId === id);

  return (
    <div style={{ ...card, padding: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={cardTitle}>Mätningar och sammanhang</div>
          <div style={cardSub}>
            Närmaste mätstationer, grundvatten, översvämningskartering och kommunstatistik
            {m?.county ? ` · ${m.county.name}` : ''}
          </div>
        </div>
        {live.statusReason && <div style={{ fontSize: 12, color: C.text3, maxWidth: 420, textAlign: 'right' }}>Status: {live.statusReason}</div>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={sect}>Väderobservationer (SMHI)</div>
        <span style={CLASS_PILL.OBSERVATION}>Observation</span>
      </div>
      {obs.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 8 }}>
          {obs.map((o) => <ObsTile key={o.parameter} o={o} fmtDist={fmtDist} />)}
        </div>
      ) : (
        <div style={label}>{cov('smhi_observations')?.status === 'loading' ? 'Hämtas…' : 'Ingen SMHI-station inom 50 km med värden de senaste 3 timmarna.'}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={sect}>Luftkvalitet (mätstationer)</div>
        <span style={CLASS_PILL.OBSERVATION}>Observation · preliminär</span>
      </div>
      {air.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 8 }}>
          {air.map((o) => <ObsTile key={o.parameter} o={o} fmtDist={fmtDist} />)}
        </div>
      ) : (
        <div style={label}>Ingen luftmätstation inom 25 km med värden de senaste 6 timmarna. Index ej bedömt.</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14, marginTop: 4 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={sect}>Uppmätt grundvatten (SGU)</div><span style={CLASS_PILL.OBSERVATION}>Observation</span>
          </div>
          {m?.observedGroundwater ? <><ObsTile o={m.observedGroundwater} fmtDist={fmtDist} /><div style={label}>Djup under stationens markyta. Inte en mätning under byggnaden.</div></> : <div style={label}>— · Ingen aktuell observation inom 10 km (högst 31 dagar gammal).</div>}
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={sect}>Grundvatten (SGU)</div>
            <span style={CLASS_PILL.MODEL}>Modell · 4×4 km</span>
          </div>
          {gw ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                <div style={tile}>
                  <div style={label}>Små magasin – fyllnadsgrad</div>
                  <div style={val}>{gw.fillSmall === null ? 'Ej tillämpligt' : `${gw.fillSmall}:e percentilen`}</div>
                </div>
                <div style={tile}>
                  <div style={label}>Små magasin – jämfört med årstiden</div>
                  <div style={val}>{gw.situationSmall === null ? 'Ej tillämpligt' : `${gw.situationSmall}:e percentilen`}</div>
                </div>
                <div style={tile}>
                  <div style={label}>Stora magasin – fyllnadsgrad</div>
                  <div style={val}>{gw.fillLarge === null ? 'Ej tillämpligt' : `${gw.fillLarge}:e percentilen`}</div>
                </div>
                <div style={tile}>
                  <div style={label}>Stora magasin – jämfört med årstiden</div>
                  <div style={val}>{gw.situationLarge === null ? 'Ej tillämpligt' : `${gw.situationLarge}:e percentilen`}</div>
                </div>
              </div>
              <div style={{ ...label, fontSize: 10.5, marginTop: 6 }}>Modelldatum {gw.date} · område {gw.areaId}. {gw.note}</div>
            </>
          ) : (
            <div style={label}>{cov('sgu_groundwater')?.note ?? (cov('sgu_groundwater')?.status === 'loading' ? 'Hämtas…' : 'Ingen modelldata.')}</div>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={sect}>Översvämningskartering (MCF)</div>
            <span style={CLASS_PILL.STATIC}>Statiskt scenario</span>
          </div>
          {fl ? (
            <>
              <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
                {fl.scenarios.map((s) => (
                  <div key={s.scenario} style={{ ...tile, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12.5 }}>{s.label}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{s.inside ? 'Träff i sökruta ±15 m' : s.withinMeters !== null ? `Inom ${s.withinMeters} m` : `Inget inom ${fl.maxRadiusMeters} m`}</span>
                  </div>
                ))}
              </div>
              <div style={{ ...label, fontSize: 10.5, marginTop: 6 }}>{fl.note}{fl.datasetVersion ? ` Dataversion ${fl.datasetVersion}.` : ''}</div>
            </>
          ) : (
            <div style={label}>{cov('mcf_flood')?.status === 'loading' || !cov('mcf_flood') ? 'Kontrolleras…' : 'Kunde inte kontrolleras.'}</div>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={sect}>Kommunstatistik (SCB)</div>
            <span style={CLASS_PILL.STAT}>Regional statistik</span>
          </div>
          {st ? (
            <>
              <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
                {st.values.map((v) => (
                  <div key={v.key} style={{ ...tile, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12.5 }}>{v.label}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{v.value === null ? '—' : v.value.toLocaleString('sv-SE')} <span style={{ color: C.text4, fontWeight: 400 }}>{v.unit}</span></span>
                  </div>
                ))}
              </div>
              <div style={{ ...label, fontSize: 10.5, marginTop: 6 }}>
                {st.regionName} ({st.regionCode}) · {st.period} · tabell {st.tableId}
                {st.provenance.sourceTimestamp ? ` · publicerad ${new Date(st.provenance.sourceTimestamp).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Stockholm' })}` : ''}. {st.note}
              </div>
            </>
          ) : (
            <div style={label}>{cov('scb')?.note ?? (cov('scb') ? 'Ingen statistik.' : 'Hämtas…')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
