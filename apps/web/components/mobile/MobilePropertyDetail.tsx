'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { DetailVM } from '@/lib/view-models/detail';
import { useDashboard } from '@/lib/state/dashboard-state';
import { C } from '@/lib/design/tokens';
import { usePropertyEditor } from '../properties/PropertyEditorHost';
import { detailSceneConfig } from '../three/property-scene';
import { IconChevronLeft, IconChevronRight, IconRain, IconThermometer, IconWind, IconDrop, IconMessage } from '../ui/icons';
import { MobileRiskGauge } from './MobileRiskGauge';
import { MobileSection, MobileStatusBadge, MobileWeatherCard } from './MobilePrimitives';
import { MobileWeatherChart } from './MobileWeatherChart';
import { LocalEvents } from '../properties/LocalEvents';
import { NowcastPanel } from '../properties/NowcastPanel';
import { ForecastDays } from '../properties/ForecastDays';
import { MeasuredRainPanel } from '../properties/MeasuredRainPanel';
import { usePropertyTimeline } from '../properties/use-property-timeline';
import styles from './mobile.module.css';

export function MobilePropertyDetail({ d, onSwitch }: { d: DetailVM; onSwitch: (id: string) => void }) {
  const ds = useDashboard();
  const timeline = usePropertyTimeline(d);
  const editor = usePropertyEditor();
  const config = useMemo(() => ({ ...detailSceneConfig(d.floors, d.hex, d.floodExposure), shift: 0, fit: { top: 30, bottom: 26, side: 12 } }), [d.floors, d.hex, d.floodExposure]);
  return <div className={styles.page} data-screen-label="Mobil fastighetssida">
    <div className={styles.detailNav}><Link className={styles.back} href={`${ds.basePath}/properties`} aria-label="Tillbaka till fastigheter"><IconChevronLeft size={20} /><span className={styles.backLabel}>Fastigheter</span></Link><div className={styles.detailTitle}>{d.area && <div className={styles.detailArea}>{d.area}</div>}<h1 className={styles.detailName}>{d.name}</h1></div><div className={styles.switcher}><button className={styles.iconButton} aria-label="Föregående fastighet" onClick={() => onSwitch(d.prevId)}><IconChevronLeft size={20} /></button><span>{d.pos}</span><button className={styles.iconButton} aria-label="Nästa fastighet" onClick={() => onSwitch(d.nextId)}><IconChevronRight size={20} /></button></div></div>
    <div className={styles.heading} style={{ paddingTop: 0, marginTop: -14 }}>{d.type && <div className={styles.date}>{d.type}</div>}<div className={styles.detailAddress}><MobileStatusBadge label={d.status} color={d.c} background={d.bg} /><span>{d.address}</span></div>{editor.enabled && <button className={styles.more} style={{ width: 'auto', background: '#fff' }} onClick={() => { const snapshot = ds.property(d.id); if (snapshot) editor.openEdit(snapshot); }}>Redigera fastighet</button>}</div>
    <section className={styles.hero} aria-label="Fastighetens risköversikt">
      <div className={styles.heroTop}><span className={styles.heroPill}><span className={styles.dot} style={{ color: ds.mode === 'demo' ? C.demo : d.gauge.c, width: 6, height: 6 }} />{ds.mode === 'demo' ? 'Illustration · Demo' : '3D-illustration'}</span><span className={styles.small}>{d.buildingLine}</span></div>
      <MobileRiskGauge score={d.risk} color={d.gauge.c} label="Fastighetens riskpoäng" config={config} ready={ds.ready} />
      <div className={styles.riskNote}>{d.riskSummary}</div>
      <div className={styles.weatherGrid}>
        <MobileWeatherCard icon={<IconThermometer size={16} />} label="Temperatur" value={`${d.temp}°`} sub={`Känns som ${d.feels}°`} />
        <MobileWeatherCard icon={<IconRain size={16} />} label="Nederbörd 24 h" value={`${d.rain} mm`} sub={d.rainPeak} />
        <MobileWeatherCard icon={<IconWind size={16} />} label="Vind" value={`${d.wind} m/s`} sub={`Byvind ${d.gust} m/s · ${d.windDir}`} />
        <MobileWeatherCard icon={<IconDrop size={16} />} label="Luftfuktighet" value={`${d.hum}%`} sub={`Daggpunkt ${d.dew}°`} />
      </div>
    </section>
    <>
      <MobileSection title="Riskfaktorer" subtitle={d.riskMeta}><div className={`${styles.surface} ${styles.health}`}>{d.factors.map(f => <div className={styles.detailFactor} key={f.label} title={f.title}><div className={styles.detailFactorLabel}><span style={{ color: C.text2 }}>{f.label}</span><span style={{ fontFamily: 'var(--font-geist-mono),monospace' }}>{f.v}</span></div><div className={styles.factorTrack} style={{ height: 6 }}><div style={{ background: f.c, width: f.w }} /></div><div className={styles.small}>{f.title}</div></div>)}<details className={styles.sectionSub}><summary>Så räknas poängen</summary><p>Poängen styrs av den tyngsta faktorn. Bara aktuella officiella varningar kan ge Förhöjd eller Hög. Indexet bygger på offentliga källor och är inte en besiktning eller försäkringsbedömning.</p></details></div></MobileSection>
      <MobileSection title="Officiella varningar" subtitle="SMHI · Krisinformation" meta={<span className={styles.meta}>{d.avail.warnings ? d.warnN : 'Ej ansluten'}</span>}>
        {(!d.avail.warnings || (!d.warnings.length && !d.noWarnings)) && <div className={`${styles.surface} ${styles.empty}`}>Varningar otillgängliga. Det betyder inte att varningar saknas.</div>}
        {d.avail.warnings && d.noWarnings && <div className={`${styles.surface} ${styles.empty}`} style={{ background: 'oklch(.97 .02 155)' }}><strong style={{ color: 'oklch(.45 .11 155)' }}>Inga aktiva officiella varningar</strong><div>Inget utfärdat som omfattar fastighetens läge.</div></div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{d.warnings.map(w => <article key={w.id} className={`${styles.surface} ${styles.health}`} style={{ gap: 10 }}><div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><span className={styles.chip} style={{ color: w.fg, background: w.bg }}>{w.levelLabel}</span><strong style={{ fontSize: 14.5, fontWeight: 500 }}>{w.type}</strong></div><div style={{ fontSize: 13, color: C.text2, lineHeight: 1.5 }}>{w.summary}</div><div className={styles.warningMeta}><span>Från <b>{w.start}</b></span><span>Till <b>{w.end}</b></span><span>{w.src}</span><span>{w.region}</span></div></article>)}</div>
      </MobileSection>
      <MobileWeatherChart d={d} onMetric={ds.setMetric} />
      <MobileSection title="Vatten och översvämning" subtitle="Karterade scenarier och vattennivå" meta={<span className={styles.chip} style={{ color: d.water.fc, background: d.water.fbg }}>{d.water.flood}</span>}>
        <div className={`${styles.surface} ${styles.health}`} style={{ gap: 10 }}>
          <div className={styles.waterLevel}><div className={styles.weatherLabel}>Vattennivå · {d.water.body}</div><strong>{d.water.level}</strong><div className={styles.sectionSub}>{d.water.trend}</div><div className={styles.small}>{d.water.reference}</div><div className={styles.small}>{d.water.source}</div></div>
          {[['Kartlagd översvämningszon', d.water.dist], ['Risk för ytvatten', d.water.surface], ['Källarrisk', d.water.basement]].map(([label, value]) => <div className={styles.waterRow} key={label}><span>{label}</span><strong>{value}</strong></div>)}
          {d.water.note && <div className={styles.small}>{d.water.note}</div>}
          {d.water.watercourse && <div className={styles.sectionSub}>{d.water.watercourse.text}<br />{d.water.watercourse.value} · {d.water.watercourse.classification}<div className={styles.small}>{d.water.watercourse.source}</div></div>}
        </div>
      </MobileSection>
      <div className={styles.detailPanels}><LocalEvents d={d} layout="mobile" mapClassName={styles.detailMap} /></div>
      <MobileSection title="Tidslinje" subtitle="Varningar, larm och avslutade händelser"><div className={`${styles.surface} ${styles.timeline}`}>
        {timeline.entries.length ? timeline.entries.map((t, i) => <div className={styles.timelineRow} key={`${t.time}-${i}`}><span className={styles.timelineDot} style={{ borderColor: t.c }} /><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.35 }}>{t.title}</div><div className={styles.meta} style={{ marginTop: 2 }}>{t.detail}</div></div><span className={styles.time}>{t.time}</span></div>) : <div className={styles.empty}>{timeline.emptyText}</div>}
      </div></MobileSection>
      <div className={styles.detailPanels}>
        <NowcastPanel d={d} /><ForecastDays d={d} /><MeasuredRainPanel d={d} />
      </div>
      <div className={styles.section}>
        {ds.mode === 'live' ? <Link className={`${styles.surface} ${styles.configLink}`} href={`/sms-rules?property=${encodeURIComponent(d.id)}`}><span className={styles.weatherIcon}><IconMessage size={18} /></span><div style={{ flex: 1 }}><strong style={{ fontSize: 15 }}>SMS-inställningar</strong><div className={styles.sectionSub}>Hantera mottagare, regler och aktivering</div></div><IconChevronRight /></Link> : <div className={`${styles.surface} ${styles.configLink}`}><span className={styles.weatherIcon}><IconMessage size={18} /></span><div><strong style={{ fontSize: 15 }}>SMS-bevakning</strong><div className={styles.sectionSub}>Demodata · SMS-inställningar hanteras i ditt konto.</div></div></div>}
      </div>
    </>
  </div>;
}
