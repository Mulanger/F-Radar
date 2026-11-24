'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { DashboardLink } from '../shell/DashboardLink';
import { propertyHref } from '@/lib/navigation/dashboard';
import { useSavedView, useViewScroll } from '@/lib/navigation/view-state';
import { useMobileDashboard } from '@/lib/design/use-mobile-dashboard';
import { PropertyStatusTable } from '../dashboard/PropertyStatusTable';
import { useDashboard } from '@/lib/state/dashboard-state';
import { buildOverviewVM } from '@/lib/view-models/overview';
import { metricValue, show } from '@/lib/view-models/snapshot';
import { C, SEV } from '@/lib/design/tokens';
import { usePropertyEditor } from './PropertyEditorHost';
import { PositionReview } from './PositionReview';
import { GroupFilter } from '../groups/GroupFilter';
import groupStyles from '../groups/GroupFilter.module.css';
import { DEFAULT_DIR, SORT_LABELS, areaOptions, propertyArea, sortProperties, type PropertySortKey, type SortDir } from '@/lib/view-models/property-sort';
import importStyles from './PropertyImport.module.css';
import { IconPlus, IconSearch } from '../ui/icons';
import { MobileStatusBadge, shortStatus } from '../mobile/MobilePrimitives';
import styles from '../mobile/mobile.module.css';

// `dir` and `area` are optional: views saved before them (Fas 4 / S-19) have neither.
type Filters = { query: string; status: string; sort: PropertySortKey; dir?: SortDir; area?: string };
const initialFilters: Filters = { query: '', status: 'all', sort: 'risk' };
const SORT_KEYS = Object.keys(SORT_LABELS) as PropertySortKey[];
/**
 * Rows drawn at a time (S-19). Sorting 1 000 properties takes ~3 ms; drawing them is the cost –
 * re-sorting 500 table rows took 140–350 ms in the development build. Search, filters and sorting
 * work on every property; "Visa fler" draws the next 100.
 */
const PAGE = 100;

export function PropertyIndex() {
  const ds = useDashboard();
  const editor = usePropertyEditor();
  const mobile = useMobileDashboard();
  const viewKey = `${ds.basePath}:${ds.portfolio.organizationId}:properties`;
  const [filtersState, setFilters, restored] = useSavedView(viewKey, initialFilters);
  const { query, status } = filtersState;
  const sort: PropertySortKey = SORT_KEYS.includes(filtersState.sort) ? filtersState.sort : 'risk';
  const dir = filtersState.dir ?? DEFAULT_DIR[sort];
  useViewScroll(`${viewKey}:scroll:${mobile ? 'mobile' : 'desktop'}`, restored);
  // Built once per portfolio/override change, not per keystroke (docs/plans/skalning.md, S-03).
  const { portfolio, ready, group, isSmsOn, isRuleOn } = ds;
  const vm = useMemo(() => buildOverviewVM(portfolio, { ready, group, isSmsOn, isRuleOn }), [portfolio, ready, group, isSmsOn, isRuleOn]);
  const searchText = useMemo(() => new Map(vm.rows.map(r => [r.id, `${r.name} ${r.address} ${r.snapshot.property.area} ${r.snapshot.property.municipality ?? ''}`.toLocaleLowerCase('sv-SE')])), [vm.rows]);
  // The field updates at once; filtering 500 rows may lag a frame behind while typing.
  const deferredQuery = useDeferredValue(query);
  // Kommun or area (S-19); one that is not in the chosen group (or no longer exists) reads as all.
  const areas = useMemo(() => areaOptions(vm.rows), [vm.rows]);
  const area = filtersState.area && areas.some((a) => a.area === filtersState.area) ? filtersState.area : 'all';
  const inArea = useMemo(() => (area === 'all' ? vm.rows : vm.rows.filter((r) => propertyArea(r.snapshot) === area)), [vm.rows, area]);
  const rows = useMemo(() => {
    const q = deferredQuery.trim().toLocaleLowerCase('sv-SE');
    const filtered = inArea.filter(r => (status === 'all' || r.snapshot.property.status === status) && (!q || searchText.get(r.id)!.includes(q)));
    return sortProperties(filtered, sort, dir);
  }, [deferredQuery, status, sort, dir, inArea, searchText]);
  // A new selection or order starts again at the first page.
  const selection = `${group}|${area}|${status}|${deferredQuery}|${sort}|${dir}`;
  const [page, setPage] = useState({ selection, count: PAGE });
  const limit = page.selection === selection ? page.count : PAGE;
  const visible = useMemo(() => rows.slice(0, limit), [rows, limit]);
  const tableVm = useMemo(() => ({ ...vm, rows: visible }), [vm, visible]);
  const filters = [{ id: 'all', label: 'Alla', color: C.text3, count: inArea.length }, ...Object.entries(SEV).map(([id, style]) => ({ id, label: shortStatus(style.label), color: style.c, count: inArea.filter(r => r.snapshot.property.status === id).length })).filter(f => f.count > 0)];
  // A header click sorts by that column; a second click on it turns the order around.
  const sortBy = (key: PropertySortKey) => setFilters({ ...filtersState, sort: key, dir: key === sort ? (dir === 'asc' ? 'desc' : 'asc') : DEFAULT_DIR[key] });
  const filtered = !!query || status !== 'all' || group !== 'all' || area !== 'all';
  return <div className={`${styles.page} ${styles.listPage}`} data-screen-label="Fastighetslista">
    <div className={`${styles.heading} ${styles.listHeading}`}><div><div className={styles.date}>{ds.portfolio.properties.length} fastigheter{ds.mode === 'demo' ? ' · Demodata' : ''}</div><h1>Fastigheter</h1></div><div className={importStyles.headActions}><button className={importStyles.importButton} onClick={editor.openGroups} title={editor.enabled ? 'Skapa grupper och välj deras fastigheter' : 'Prova grupperna – i demoläget sparas inget'}>Grupper</button><button className={importStyles.importButton} onClick={editor.openImport} title={editor.enabled ? 'Importera fastigheter från Excel eller CSV' : 'Prova importen – i demoläget sparas inget'}>Importera</button><button className={styles.iconButton} style={{ background: C.ink, color: '#fff' }} aria-label="Lägg till fastighet" onClick={editor.openCreate}><IconPlus size={18} /></button></div></div>
    <PositionReview />
    {(portfolio.groups.length > 0 || areas.length > 1) && <div className={styles.groupRow}>
      <GroupFilter />
      {areas.length > 1 && <label className={`${groupStyles.select} ${area !== 'all' ? groupStyles.active : ''}`}>Område
        <select value={area} onChange={e => setFilters({ ...filtersState, area: e.target.value })}>
          <option value="all">Alla områden ({vm.rows.length})</option>
          {areas.map(a => <option key={a.area} value={a.area}>{a.area} ({a.count})</option>)}
        </select>
      </label>}
    </div>}
    <label className={styles.search}><IconSearch /><span className="fr-sr-only">Sök fastighet, adress eller område</span><input value={query} onChange={e => setFilters({ ...filtersState, query: e.target.value })} placeholder="Sök fastighet, adress eller område" type="search" /></label>
    <div className={styles.filters} role="group" aria-label="Filtrera fastighetsstatus">{filters.map(f => <button key={f.id} className={styles.filter} aria-label={`${f.label} ${f.count}`} aria-pressed={status === f.id} onClick={() => setFilters({ ...filtersState, status: f.id })}><span className={styles.dot} style={{ color: f.color }} />{f.label}<span className={styles.count}>{f.count}</span></button>)}</div>
    <div className={styles.sortRow}><span role="status">{rows.length} {rows.length === 1 ? 'fastighet' : 'fastigheter'}</span>
      {/* On a computer the table's headers sort; the cards have this menu. */}
      {mobile && <label className={groupStyles.select}>Sortera
        <select value={sort} onChange={e => setFilters({ ...filtersState, sort: e.target.value as PropertySortKey, dir: undefined })}>
          {SORT_KEYS.map(k => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
        </select>
      </label>}
    </div>
    {!mobile && rows.length > 0 && <PropertyStatusTable vm={tableVm} onOpen={ds.openProperty} sort={{ key: sort, dir }} onSort={sortBy} scroll />}
    <div className={styles.cards}>
      {mobile && visible.map(r => {
        const p = r.snapshot.property;
        const score = Number(r.risk);
        const dash = ds.ready && Number.isFinite(score) ? score / 100 * Math.PI * 40 : 0;
        return <DashboardLink className={`${styles.surface} ${styles.propertyCard}`} key={r.id} href={propertyHref(ds.basePath, r.id, 'properties')}>
          <div className={styles.propertyCardTop}><div className={styles.miniGauge}><svg width="48" height="48" viewBox="0 0 48 48" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true"><circle cx="24" cy="24" r="20" fill="none" stroke={C.chip} strokeWidth="5" /><circle cx="24" cy="24" r="20" fill="none" stroke={r.riskC} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${dash} ${Math.PI * 40}`} style={{ transition: 'stroke-dasharray 1.2s' }} /></svg><span>{r.risk}</span></div><div style={{ flex: 1, minWidth: 0 }}><div className={styles.propertyTitle}>{r.name}</div><div className={styles.propertyArea}>{[p.area, p.building?.type].filter(Boolean).join(' · ')}</div></div><MobileStatusBadge label={r.status} color={r.c} background={r.bg} /></div>
          <div className={styles.propertyWeather}><div><span className={styles.small}>Temp</span><strong>{r.temp}°</strong></div><div><span className={styles.small}>Regn 24 h</span><strong>{r.rain} mm</strong></div><div><span className={styles.small}>Byvind</span><strong>{show(metricValue(r.snapshot, 'weather.wind_gust'))} m/s</strong></div></div>
          {r.warn !== 'Ingen' && <div><span className={styles.chip} style={{ color: r.wFg, background: r.wBg }}>{r.warn}</span></div>}
          {r.nowcast.badge && <div className={styles.small} style={{ color: '#4A86C5' }} title={r.nowcast.source}>{r.nowcast.badge}</div>}
        </DashboardLink>;
      })}
      {mobile && visible.some((r) => r.nowcast.badge) && <div className={styles.small} style={{ color: C.text3 }}>MET Norway · bearbetad av FastighetsRadar · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></div>}
      {rows.length > limit && <div className={styles.pageMore} role="group" aria-label="Fler fastigheter">
        <span>Visar {limit} av {rows.length}</span>
        <button className={styles.more} onClick={() => setPage({ selection, count: limit + PAGE })}>Visa {Math.min(PAGE, rows.length - limit)} till</button>
        <button className={styles.more} onClick={() => setPage({ selection, count: rows.length })}>Visa alla</button>
      </div>}
      {!rows.length && <div className={`${styles.surface} ${styles.empty}`}><strong>Inga fastigheter matchar</strong><div>Prova en annan sökning eller ett annat filter.</div>{filtered && <button className={styles.more} onClick={() => { setFilters({ ...filtersState, query: '', status: 'all', area: 'all' }); ds.setGroup('all'); }}>Rensa filter</button>}</div>}
    </div>
  </div>;
}
