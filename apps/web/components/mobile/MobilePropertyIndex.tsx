'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDashboard } from '@/lib/state/dashboard-state';
import { buildOverviewVM } from '@/lib/view-models/overview';
import { metricValue, show } from '@/lib/view-models/snapshot';
import { C, SEV } from '@/lib/design/tokens';
import { usePropertyEditor } from '../properties/PropertyEditorHost';
import { IconPlus, IconSearch } from '../ui/icons';
import { MobileStatusBadge, shortStatus } from './MobilePrimitives';
import styles from './mobile.module.css';

export function MobilePropertyIndex() {
  const ds = useDashboard();
  const editor = usePropertyEditor();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<'risk' | 'name'>('risk');
  // Keep the established desktop shortcut to the selected property.
  useEffect(() => {
    if (!window.matchMedia('(max-width: 899.98px)').matches) router.replace(ds.selectedId ? `${ds.basePath}/properties/${encodeURIComponent(ds.selectedId)}` : `${ds.basePath}/overview`);
  }, [ds.basePath, ds.selectedId, router]);
  const vm = buildOverviewVM(ds.portfolio, { ready: ds.ready, group: 'all', isSmsOn: ds.isSmsOn, isRuleOn: ds.isRuleOn });
  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('sv-SE');
    const filtered = vm.rows.filter(r => (status === 'all' || r.snapshot.property.status === status) && (!q || `${r.name} ${r.address} ${r.snapshot.property.area}`.toLocaleLowerCase('sv-SE').includes(q)));
    return sort === 'name' ? filtered.sort((a, b) => a.name.localeCompare(b.name, 'sv-SE')) : filtered;
  }, [query, status, sort, vm.rows]);
  const filters = [{ id: 'all', label: 'Alla', color: C.text3, count: vm.rows.length }, ...Object.entries(SEV).map(([id, style]) => ({ id, label: shortStatus(style.label), color: style.c, count: vm.rows.filter(r => r.snapshot.property.status === id).length })).filter(f => f.count > 0)];
  return <div className={`${styles.page} ${styles.listPage}`} data-screen-label="Mobil fastighetslista">
    <div className={`${styles.heading} ${styles.listHeading}`}><div><div className={styles.date}>{ds.portfolio.properties.length} fastigheter{ds.mode === 'demo' ? ' · Demodata' : ''}</div><h1>Fastigheter</h1></div><button className={styles.iconButton} style={{ background: C.ink, color: '#fff' }} aria-label="Lägg till fastighet" title={editor.enabled ? 'Lägg till fastighet' : 'Demodata kan inte redigeras'} disabled={!editor.enabled} onClick={editor.openCreate}><IconPlus size={18} /></button></div>
    <label className={styles.search}><IconSearch /><span className="fr-sr-only">Sök fastighet, adress eller område</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Sök fastighet, adress eller område" type="search" /></label>
    <div className={styles.filters} role="group" aria-label="Filtrera fastighetsstatus">{filters.map(f => <button key={f.id} className={styles.filter} aria-label={`${f.label} ${f.count}`} aria-pressed={status === f.id} onClick={() => setStatus(f.id)}><span className={styles.dot} style={{ color: f.color }} />{f.label}<span className={styles.count}>{f.count}</span></button>)}</div>
    <div className={styles.sortRow}><span role="status">{rows.length} {rows.length === 1 ? 'fastighet' : 'fastigheter'}</span><div className={styles.sort} role="group" aria-label="Sortera fastigheter"><button aria-pressed={sort === 'risk'} onClick={() => setSort('risk')}>Risk</button><button aria-pressed={sort === 'name'} onClick={() => setSort('name')}>Namn</button></div></div>
    <div className={styles.cards}>
      {rows.map(r => {
        const p = r.snapshot.property;
        const score = Number(r.risk);
        const dash = ds.ready && Number.isFinite(score) ? score / 100 * Math.PI * 40 : 0;
        return <Link className={`${styles.surface} ${styles.propertyCard}`} key={r.id} href={`${ds.basePath}/properties/${encodeURIComponent(r.id)}`}>
          <div className={styles.propertyCardTop}><div className={styles.miniGauge}><svg width="48" height="48" viewBox="0 0 48 48" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true"><circle cx="24" cy="24" r="20" fill="none" stroke={C.chip} strokeWidth="5" /><circle cx="24" cy="24" r="20" fill="none" stroke={r.riskC} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${dash} ${Math.PI * 40}`} style={{ transition: 'stroke-dasharray 1.2s' }} /></svg><span>{r.risk}</span></div><div style={{ flex: 1, minWidth: 0 }}><div className={styles.propertyTitle}>{r.name}</div><div className={styles.propertyArea}>{[p.area, p.building?.type].filter(Boolean).join(' · ')}</div></div><MobileStatusBadge label={r.status} color={r.c} background={r.bg} /></div>
          <div className={styles.propertyWeather}><div><span className={styles.small}>Temp</span><strong>{r.temp}°</strong></div><div><span className={styles.small}>Regn 24 h</span><strong>{r.rain} mm</strong></div><div><span className={styles.small}>Byvind</span><strong>{show(metricValue(r.snapshot, 'weather.wind_gust'))} m/s</strong></div></div>
          {r.warn !== 'Ingen' && <div><span className={styles.chip} style={{ color: r.wFg, background: r.wBg }}>{r.warn}</span></div>}
          {r.nowcast.badge && <div className={styles.small} style={{ color: '#4A86C5' }} title={r.nowcast.source}>{r.nowcast.badge} · MET Norway · <span style={{ color: C.text4 }}>CC BY 4.0</span></div>}
        </Link>;
      })}
      {!rows.length && <div className={`${styles.surface} ${styles.empty}`}><strong>Inga fastigheter matchar</strong><div>Prova en annan sökning eller ett annat filter.</div>{(query || status !== 'all') && <button className={styles.more} onClick={() => { setQuery(''); setStatus('all'); }}>Rensa filter</button>}</div>}
    </div>
  </div>;
}
