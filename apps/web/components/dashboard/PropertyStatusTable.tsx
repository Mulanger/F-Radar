'use client';

import type { OverviewVM } from '@/lib/view-models/overview';
import { SORT_LABELS, propertyArea, type PropertySortKey, type SortDir } from '@/lib/view-models/property-sort';
import { C, FONT_MONO, card, cardSub, cardTitle } from '@/lib/design/tokens';
import { IconChevronRight } from '../ui/icons';

const COLS = 'minmax(210px,1.8fr) 120px 112px minmax(190px,1.3fr) 150px 96px 130px 92px 60px 128px 24px';

/** Columns in order; `sort` makes the header a button (docs/plans/skalning.md, Fas 4 / S-19). */
const HEADERS: Array<{ label: string; sort?: PropertySortKey }> = [
  { label: 'Fastighet', sort: 'name' },
  { label: 'Område', sort: 'area' },
  { label: 'Status', sort: 'status' },
  { label: 'Väder nu' },
  { label: 'Officiell varning', sort: 'warning' },
  { label: 'Översvämning' },
  { label: 'I närheten' },
  { label: 'Luft' },
  { label: 'Larm', sort: 'alerts' },
  { label: 'Riskpoäng', sort: 'risk' },
  { label: '' },
];

const headerButton: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, border: 'none', background: 'none', font: 'inherit', letterSpacing: 'inherit',
  textTransform: 'inherit', color: 'inherit', cursor: 'pointer',
};

export function PropertyStatusTable({
  vm,
  onOpen,
  sort,
  onSort,
  scroll = false,
}: {
  vm: OverviewVM;
  onOpen: (id: string) => void;
  /** The list's order; with `onSort` the headers sort (the overview's table stays by risk). */
  sort?: { key: PropertySortKey; dir: SortDir };
  onSort?: (key: PropertySortKey) => void;
  /** Long lists scroll inside the card with the header row fixed at the top. */
  scroll?: boolean;
}) {
  const order = sort ? `${SORT_LABELS[sort.key].toLocaleLowerCase('sv-SE')}${sort.dir === 'asc' ? ' (stigande)' : ''}` : 'risk';
  return (
    <div style={{ ...card, padding: '20px 20px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <div style={cardTitle}>Bevakningsstatus</div>
          <div style={cardSub}>Aktuella värden per fastighet · sorterat efter {order}</div>
        </div>
        <div style={{ fontSize: 12, color: C.text4 }}>Uppdaterad {vm.updatedAt}</div>
      </div>
      <div style={{ overflow: 'auto', ...(scroll ? { maxHeight: 'min(760px, calc(100vh - 200px))', overscrollBehavior: 'contain' } : {}) }}>
        <div style={{ minWidth: 1300 }} role="table" aria-label="Bevakningsstatus per fastighet">
          <div
            role="row"
            style={{
              display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '10px 12px', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.text4,
              borderBottom: '1px solid rgba(20,23,26,0.06)', position: 'sticky', top: 0, zIndex: 1, background: C.white,
            }}
          >
            {HEADERS.map((h, i) => {
              const active = sort && h.sort === sort.key;
              return (
                <div key={i} role="columnheader" aria-sort={!onSort || !h.sort ? undefined : active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {onSort && h.sort ? (
                    <button type="button" style={{ ...headerButton, color: active ? C.ink : 'inherit', fontWeight: active ? 600 : 'inherit' }} onClick={() => onSort(h.sort!)}
                      title={`Sortera efter ${h.label.toLocaleLowerCase('sv-SE')}`}>
                      {h.label}
                      <span aria-hidden="true" style={{ fontSize: 10, opacity: active ? 1 : 0.35 }}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  ) : h.label}
                </div>
              );
            })}
          </div>
          {vm.rows.map((r) => (
            <div
              key={r.id}
              role="row"
              tabIndex={0}
              className="fr-hover-row"
              onClick={() => onOpen(r.id)}
              onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen(r.id)}
              style={{
                display: 'grid', gridTemplateColumns: COLS, gap: 12, alignItems: 'center', padding: '14px 12px', borderBottom: '1px solid rgba(20,23,26,0.05)', cursor: 'pointer', borderRadius: 14, transition: 'background .2s',
                // Rendering budget (S-19): rows outside the scrolled view are not laid out or painted.
                contentVisibility: 'auto', containIntrinsicSize: 'auto 72px',
              }}
            >
              <div role="cell" style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{r.name}</div>{r.nowcast.badge && <div title={r.nowcast.source} style={{ fontSize:11, color:'#4A86C5', marginTop:3 }}>{r.nowcast.badge}</div>}
                <div style={{ fontSize: 12, color: C.text4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.address}</div>
              </div>
              <div role="cell" style={{ fontSize: 12.5, color: C.text2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{propertyArea(r.snapshot) || '—'}</div>
              <div role="cell">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 10, background: r.bg, color: r.c }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
                  {r.status}
                </span>
              </div>
              <div role="cell" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.02em' }}>{r.temp}°</span>
                <span style={{ fontSize: 12, color: C.text3 }}>{r.rain} mm · {r.wind} m/s · {r.hum}%</span>
              </div>
              <div role="cell">
                <span style={{ fontSize: 12, padding: '3px 8px', borderRadius: 8, background: r.wBg, color: r.wFg }}>{vm.avail.warnings ? r.warn : '—'}</span>
              </div>
              <div role="cell" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <span style={{ display: 'flex', gap: 2 }}>
                  <span style={{ width: 4, height: 12, borderRadius: 2, background: r.f1 }} />
                  <span style={{ width: 4, height: 12, borderRadius: 2, background: r.f2 }} />
                  <span style={{ width: 4, height: 12, borderRadius: 2, background: r.f3 }} />
                </span>
                {r.flood}
              </div>
              <div role="cell" style={{ fontSize: 12.5, color: C.text2 }}>{vm.avail.events ? r.nearby : '—'}</div>
              <div role="cell" style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.aqC }} />
                {r.aq}
              </div>
              <div role="cell" style={{ fontSize: 14, fontWeight: 500 }}>{r.alerts}</div>
              <div role="cell" title={r.riskTitle} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 5, borderRadius: 3, background: C.chip, overflow: 'hidden' }}>
                  <div style={{ height: 5, borderRadius: 3, width: r.riskW, background: r.riskC, transition: 'width 1s' }} />
                </div>
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, width: 22, textAlign: 'right' }}>{r.risk}</span>
              </div>
              <IconChevronRight stroke={C.text4} />
            </div>
          ))}
        </div>
      </div>
      {vm.rows.some(r=>r.nowcast.badge) && <p style={{fontSize:11,color:C.text3,lineHeight:1.6}}>Data från MET Norway · bearbetad av FastighetsRadar · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></p>}
    </div>
  );
}
