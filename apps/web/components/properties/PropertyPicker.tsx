'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PropertySnapshot } from '@fastighetsradar/domain';
import { useDashboard } from '@/lib/state/dashboard-state';
import { C, FONT_MONO, SEV } from '@/lib/design/tokens';
import { nowcastVM } from '@/lib/view-models/nowcast';
import { riskScore, show } from '@/lib/view-models/snapshot';
import { IconSearch } from '../ui/icons';

/** Rows rendered at most; the rest are reached by searching (docs/plans/skalning.md, S-01). */
export const PICKER_MAX_ROWS = 100;
const RECENT_MAX = 5;
const STATUS_RANK: Record<string, number> = { critical: 0, warning: 1, monitor: 2, normal: 3, unknown: 4 };

const norm = (s: string) => s.toLocaleLowerCase('sv-SE');

/** What the search matches: name, address, area and municipality. */
export function pickerSearchText(s: PropertySnapshot): string {
  const p = s.property;
  return norm([p.name, p.address, p.area, p.municipality].filter(Boolean).join(' '));
}

/** Worst status first, then name. */
export function sortForPicker(list: PropertySnapshot[]): PropertySnapshot[] {
  return [...list].sort((a, b) =>
    (STATUS_RANK[a.property.status] ?? 4) - (STATUS_RANK[b.property.status] ?? 4)
    || a.property.name.localeCompare(b.property.name, 'sv-SE'));
}

/**
 * Every word of the query must occur somewhere in the property's search text. Hits whose NAME
 * equals or starts with the whole query come first ("torsviks torg 4" → "Torsviks Torg 4"),
 * then the rest in the given order (status, name).
 */
export function matchProperties(sorted: PropertySnapshot[], texts: Map<string, string>, query: string): PropertySnapshot[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return sorted;
  const whole = words.join(' ');
  const rank = (s: PropertySnapshot) => {
    const name = norm(s.property.name).replace(/\s+/g, ' ');
    return name === whole ? 0 : name.startsWith(whole) ? 1 : 2;
  };
  return sorted
    .filter((s) => {
      const text = texts.get(s.property.id) ?? '';
      return words.every((w) => text.includes(w));
    })
    .map((s, i) => ({ s, i, r: rank(s) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.s);
}

function recentKey(basePath: string, organizationId: string) {
  return `fr:recent-properties:${basePath || 'live'}:${organizationId}`;
}

function readRecent(key: string): string[] {
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(key);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function writeRecent(key: string, id: string) {
  try {
    const next = [id, ...readRecent(key).filter((x) => x !== id)].slice(0, RECENT_MAX);
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* storage unavailable (private window, blocked): recent list is a convenience only */
  }
}

type Section = { label: string | null; items: PropertySnapshot[] };

/**
 * Searchable property list shared by the header "Snabbväxla", the detail-page switcher and the
 * header search (command palette). Keyboard: type to filter, ↑/↓ to move, Enter to open; Esc is
 * handled by the surrounding popover/dialog. Renders at most PICKER_MAX_ROWS rows and scrolls
 * inside its own box, so 500 properties stay a short, searchable menu.
 */
export function PropertyPicker({
  variant,
  currentId,
  onSelect,
  maxHeight = 'min(calc(60vh - 18px), 520px)', // popover padding + border: whole menu ≤ 60 % of the window
  placeholder = 'Sök namn, adress, område eller kommun',
}: {
  variant: 'status' | 'risk';
  currentId?: string;
  onSelect: (id: string) => void;
  maxHeight?: string;
  placeholder?: string;
}) {
  const { portfolio, basePath } = useDashboard();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const storageKey = recentKey(basePath, portfolio.organizationId);
  const [query, setQuery] = useState('');
  const [recentIds] = useState(() => readRecent(storageKey));

  const sorted = useMemo(() => sortForPicker(portfolio.properties), [portfolio.properties]);
  const texts = useMemo(() => new Map(portfolio.properties.map((s) => [s.property.id, pickerSearchText(s)])), [portfolio.properties]);
  // Keyed by snapshot object: a refreshed portfolio has new snapshots, so stale entries never hit.
  const radar = useRef(new WeakMap<PropertySnapshot, ReturnType<typeof nowcastVM>>()).current;
  const radarOf = (s: PropertySnapshot) => {
    let vm = radar.get(s);
    if (!vm) radar.set(s, (vm = nowcastVM(s, portfolio.generatedAt)));
    return vm;
  };

  const { sections, total } = useMemo(() => {
    if (query.trim()) {
      const hits = matchProperties(sorted, texts, query);
      return { sections: [{ label: null, items: hits.slice(0, PICKER_MAX_ROWS) }] as Section[], total: hits.length };
    }
    const byId = new Map(sorted.map((s) => [s.property.id, s]));
    const recent = recentIds.flatMap((id) => byId.get(id) ?? []);
    if (!recent.length || sorted.length <= RECENT_MAX) return { sections: [{ label: null, items: sorted.slice(0, PICKER_MAX_ROWS) }] as Section[], total: sorted.length };
    const recentSet = new Set(recent.map((s) => s.property.id));
    const rest = sorted.filter((s) => !recentSet.has(s.property.id)).slice(0, PICKER_MAX_ROWS - recent.length);
    return { sections: [{ label: 'Senast besökta', items: recent }, { label: 'Alla fastigheter', items: rest }] as Section[], total: sorted.length };
  }, [query, recentIds, sorted, texts]);

  const options = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const shown = options.length;
  // New results start at the top, or at the current property when the list is unfiltered.
  const startIndex = useMemo(() => {
    const i = query.trim() || !currentId ? -1 : options.findIndex((s) => s.property.id === currentId);
    return i >= 0 ? i : 0;
  }, [currentId, options, query]);
  const [active, setActive] = useState(startIndex);
  useEffect(() => setActive(startIndex), [startIndex, options]);

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, listId]);

  const choose = (id: string) => {
    writeRecent(storageKey, id);
    onSelect(id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!shown) return;
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 }[e.key];
    if (step) {
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(shown - 1, a + step)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const s = options[active];
      if (s) choose(s.property.id);
    }
  };

  let index = -1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxHeight, minHeight: 0 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 12px', margin: '0 0 6px', borderRadius: 12, background: C.page, color: C.text4, flex: 'none' }}>
        <IconSearch />
        <span className="fr-sr-only">Sök fastighet</span>
        <input
          ref={inputRef}
          // Focused in the commit itself, so keys typed right after ⌘K or a click are not lost.
          autoFocus
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown ? `${listId}-${active}` : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          style={{ border: 'none', outline: 'none', background: 'transparent', font: 'inherit', fontSize: 13.5, color: C.ink, flex: 1, minWidth: 0 }}
        />
      </label>
      <div id={listId} role="listbox" aria-label="Fastigheter" style={{ overflowY: 'auto', overscrollBehavior: 'contain', flex: '1 1 auto', minHeight: 0 }}>
        {sections.map((section) => (
          <div key={section.label ?? 'all'} role="group" aria-label={section.label ?? 'Fastigheter'}>
            {section.label && <div aria-hidden="true" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: C.text4, padding: '8px 12px 4px' }}>{section.label}</div>}
            {section.items.map((s) => {
              const i = ++index;
              const p = s.property;
              const st = SEV[p.status] ?? SEV.unknown;
              const nowcast = radarOf(s);
              const current = p.id === currentId;
              return (
                <div
                  key={p.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  aria-current={current ? 'true' : undefined}
                  onMouseMove={() => i !== active && setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(p.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
                    background: i === active ? 'rgba(20,23,26,0.07)' : current ? C.page : 'transparent',
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: st.c, flex: 'none' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: current ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    {nowcast.badge && <div title={nowcast.source} style={{ fontSize: 11, color: '#4A86C5', marginTop: 3 }}>{nowcast.badge} · MET Norway</div>}
                    <div style={{ fontSize: 12, color: C.text4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current ? 'Visas nu · ' : ''}{p.area || p.address}</div>
                  </div>
                  {variant === 'status' ? (
                    <span style={{ fontSize: 11.5, color: st.c, flex: 'none' }}>{st.label}</span>
                  ) : (
                    <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.text3, flex: 'none' }}>Risk {show(riskScore(s))}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {!shown && <div role="status" style={{ padding: '14px 12px', fontSize: 13, color: C.text3 }}>Inga fastigheter matchar ”{query.trim()}”.</div>}
      </div>
      {total > shown && (
        <div role="status" style={{ flex: 'none', padding: '8px 12px 4px', fontSize: 12, color: C.text4, borderTop: '1px solid rgba(20,23,26,0.06)', marginTop: 4 }}>
          Visar {shown} av {total} – {query.trim() ? 'skriv mer för att begränsa' : 'skriv för att söka'}
        </div>
      )}
    </div>
  );
}
