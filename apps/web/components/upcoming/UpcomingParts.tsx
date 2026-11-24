'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { UpcomingBar, UpcomingPlaceRow } from '@/lib/view-models/upcoming';
import type { UpcomingState } from './use-upcoming';
import s from './Upcoming.module.css';

type Variant = 'desktop' | 'mobile';
const pct = (f: number) => `${(f * 100).toFixed(3)}%`;

/** Title, subtitle and the source badge ("SMHI · uppdaterad 16:00"). */
export function UpcomingHeader({ st, variant }: { st: UpcomingState; variant: Variant }) {
  const source = st.hasOutages ? st.hasWeather ? 'SMHI och leverantörer' : 'Leverantörer' : 'SMHI';
  const updated = st.hasOutages ? null : st.updated;
  const badge = (
    <span className={s.badge}>
      <span className={s.badgeDot} style={{ background: st.live ? 'oklch(0.65 0.14 155)' : 'oklch(0.72 0.12 75)' }} />
      <span>
        {st.live ? '' : 'Demo · '}
        {variant === 'desktop' ? `${source}${updated ? ` · uppdaterad ${updated}` : ''}` : `${source}${updated ? ` ${updated}` : ''}`}
      </span>
    </span>
  );
  return (
    <div className={s.head}>
      <div className={s.headTop}>
        <h2 className={s.title}>Kommande förhållanden</h2>
        {variant === 'desktop' && <UpcomingSearch st={st} />}
        {badge}
      </div>
      <div className={s.sub}>{st.hasOutages ? 'Prognos, officiella varningar och planerade avstängningar' : 'Prognos och officiella varningar'} · nästa 48 h</div>
      {variant === 'mobile' && <UpcomingSearch st={st} />}
    </div>
  );
}

/** Finds a property in the list by name or address. */
function UpcomingSearch({ st }: { st: UpcomingState }) {
  if (st.view.empty) return null;
  return (
    <input
      type="search"
      className={s.search}
      value={st.query}
      onChange={(e) => st.setQuery(e.target.value)}
      placeholder="Sök fastighet eller adress"
      aria-label="Sök fastighet eller adress i kommande förhållanden"
    />
  );
}

/** Under the rows: "no match", or a button for the next rows of a long list. */
function ListFooter({ st }: { st: UpcomingState }) {
  if (st.matchCount === 0) return <div className={s.listNote} role="status">Ingen fastighet matchar ”{st.query.trim()}”.</div>;
  const rest = st.matchCount - st.rows.length;
  if (rest <= 0) return null;
  return (
    <div className={s.listNote}>
      <span>Visar {st.rows.length} av {st.matchCount}</span>
      <button type="button" className={s.chip} onClick={st.showMore}>Visa {Math.min(rest, 100)} till</button>
    </div>
  );
}

export function UpcomingHeadline({ st }: { st: UpcomingState }) {
  return (
    <div className={s.lead}>
      <p className={s.headline}>{st.view.headline}</p>
      {st.view.subline && <p className={s.subline}>{st.view.subline}</p>}
    </div>
  );
}

function Legend({ st }: { st: UpcomingState }) {
  if (!st.view.night.length) return null;
  return (
    <span className={s.legend}>
      <span className={s.legendNight} />
      Mörker
    </span>
  );
}

/** Kind filter: "Alla 8", "Halka 1", … */
export function UpcomingChips({ st, variant }: { st: UpcomingState; variant: Variant }) {
  const chips = (
    <div className={s.chips} role="group" aria-label="Filtrera typ av händelse">
      {st.view.chips.map((c) => (
        <button key={c.k} type="button" aria-pressed={c.active} className={`${s.chip} ${c.active ? s.on : ''}`} onClick={() => st.setFilter(c.k)}>
          {c.sw && <span className={s.swatch} style={{ background: c.sw }} />}
          <span>{c.label}</span>{' '}
          <span className={s.chipN}>{c.n}</span>
        </button>
      ))}
    </div>
  );
  if (variant === 'mobile') return chips;
  return (
    <div className={s.chipRow}>
      {chips}
      <div className={s.chipMeta}>
        <Legend st={st} />
        <span>{st.view.countText}</span>
      </div>
    </div>
  );
}

/** The 48 h track behind a bar: darkness, the midnights and the bar itself. */
function Track({ e, st, variant }: { e: UpcomingBar; st: UpcomingState; variant: Variant }) {
  return (
    <span className={variant === 'desktop' ? s.track : s.trackM} aria-hidden="true">
      {st.view.night.map((n, i) => (
        <span key={i} className={s.night} style={{ left: pct(n.start), width: pct(n.end - n.start) }} />
      ))}
      {st.view.axis.midnights.map((m) => (
        <span key={m.pos} className={s.midLine} style={{ left: pct(m.pos) }} />
      ))}
      <span className={s.bar} style={{ left: pct(e.left), width: pct(e.width), background: e.bar }} />
      {e.cross && (
        <>
          <span className={s.cross} style={{ left: pct(e.left) }} />
          <span className={s.cross} style={{ left: pct(e.right) }} />
        </>
      )}
    </span>
  );
}

function Details({ e, st, variant }: { e: UpcomingBar; st: UpcomingState; variant: Variant }) {
  return (
    <div className={variant === 'desktop' ? s.details : s.detailsM}>
      <div className={s.note}>{e.note}</div>
      <div className={s.facts}>
        <div><span>Från</span><span className={s.mono}>{e.from}</span></div>
        <div><span>Till</span><span className={s.mono}>{e.to}</span></div>
        <div className={s.factWide}><span>Källa</span><span>{e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">{e.src}</a> : e.src}</span></div>
      </div>
      {e.propertyId && (
        <button type="button" className={s.propLink} onClick={() => st.openProperty(e.propertyId!)}>
          Öppna {e.name} →
        </button>
      )}
    </div>
  );
}

function Value({ e, inline }: { e: UpcomingBar; inline?: boolean }) {
  return (
    <span className={inline ? s.valueInline : s.value}>
      <span className={s.valueNum}>{e.value}</span>
      {e.unit && <span className={s.valueUnit}>{e.unit}</span>}
    </span>
  );
}

function PlaceName({ r, st }: { r: UpcomingPlaceRow; st: UpcomingState }) {
  return (
    <div className={s.placeIdentity}>
      {r.propertyId ? (
        <button type="button" className={s.placeName} onClick={() => st.openProperty(r.propertyId!)} title={`Öppna ${r.name}`}>
          {r.name}
        </button>
      ) : <span className={s.placeName}>{r.name}</span>}
      {r.address && r.address !== r.name && <span className={s.groupAddress}>{r.address}</span>}
    </div>
  );
}

function Axis({ axis, variant }: { axis: UpcomingState['view']['axis']; variant: Variant }) {
  const ref = useRef<HTMLDivElement>(null);
  const now = useRef<HTMLSpanElement>(null);
  const [hidden, setHidden] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!ref.current || !now.current || typeof ResizeObserver === 'undefined') return;
    const node = ref.current;
    const nowLabel = now.current;
    const observer = new ResizeObserver(() => {
      const right = node.getBoundingClientRect().right;
      const kept = [nowLabel.getBoundingClientRect()];
      const hidden = new Set<string>();
      // Midnight labels first: in a narrow card a crowded 06 or 18 gives way to the 00 beside the day line.
      const labels = [...node.querySelectorAll<HTMLElement>('[data-axis-clock]')]
        .sort((a, b) => Number('axisMidnight' in b.dataset) - Number('axisMidnight' in a.dataset));
      for (const label of labels) {
        const bounds = label.getBoundingClientRect();
        const crowded = kept.some((k) => bounds.left < k.right + 4 && bounds.right + 4 > k.left);
        if (crowded || bounds.right > right) hidden.add(label.dataset.axisClock!);
        else kept.push(bounds);
      }
      setHidden(hidden);
    });
    observer.observe(node);
    observer.observe(nowLabel);
    return () => observer.disconnect();
  }, [axis, variant]);

  const mobile = variant === 'mobile';
  const hourClass = mobile ? s.mAxisHour : s.axisHour;
  const hours = [
    ...axis.midnights.map((m) => ({ pos: m.pos, label: '00', align: s.afterLine, midnight: true })),
    ...axis.ticks.filter((t) => !mobile || t.label === '12').map((t) => ({ ...t, align: s.centred, midnight: false })),
  ];
  return (
    <div ref={ref} className={mobile ? s.mAxis : s.axis} aria-hidden="true">
      {axis.midnights.map((m) => (
        <span key={m.pos} className={mobile ? s.mAxisLine : s.axisLine} style={{ left: pct(m.pos) }} />
      ))}
      {axis.today && <span className={s.axisDay} style={{ left: 0 }}>{axis.today}</span>}
      {axis.midnights.map((m) => (
        <span key={m.pos} className={`${s.axisDay} ${m.pos > 0.78 ? s.beforeLine : s.afterLine}`} style={{ left: pct(m.pos) }}>
          {mobile ? m.short : <>{m.day} <span>{m.date}</span></>}
        </span>
      ))}
      <span ref={now} className={`${hourClass} ${s.nowHour}`} style={{ left: 0 }}>{axis.now}</span>
      {hours.map(({ pos, label, align, midnight }) => (
        <span key={pos} data-axis-clock={pos} data-axis-midnight={midnight || undefined} className={`${hourClass} ${align}`} style={{ left: pct(pos), visibility: !hidden || hidden.has(String(pos)) ? 'hidden' : undefined }}>{label}</span>
      ))}
    </div>
  );
}

export function UpcomingScroll({ st, variant, children }: { st: UpcomingState; variant: Variant; children: ReactNode }) {
  const mobile = variant === 'mobile';
  return (
    <div ref={st.scrollRef} className={`${s.scroll} ${mobile ? s.mobileScroll : s.table}`} style={{ maxHeight: mobile ? 780 : 640, overflowY: 'auto', overflowX: 'hidden' }} role="region" aria-label="Tidslinje" tabIndex={0}>
      {children}
    </div>
  );
}

/** Desktop: PLATS | HÄNDELSE | the 48 h axis | VÄRDE. */
export function UpcomingTimeline({ st }: { st: UpcomingState }) {
  const { view } = st;
  if (view.empty) return null;
  return (
    <UpcomingScroll st={st} variant="desktop">
      <div className={s.thead}>
        <div className={s.th}>Plats</div>
        <div className={s.lineGrid}>
          <div className={s.th}>Händelse</div>
          <Axis axis={view.axis} variant="desktop" />
          <div className={`${s.th} ${s.right}`}>Värde</div>
          <div />
        </div>
      </div>
      {st.rows.map((r) => (
        <div key={r.key} className={s.place}>
          <div className={s.placeHead}>
            <PlaceName r={r} st={st} />
            {r.countText && <div className={s.placeCount}>{r.countText}</div>}
          </div>
          <div className={s.lines}>
            {r.events.map((e) => {
              const open = st.openId === e.id;
              return (
                <div key={e.id} className={s.lineWrap}>
                  <button type="button" data-testid="upcoming-row" className={`${s.lineGrid} ${s.line}`} aria-expanded={open} onClick={() => st.toggle(e.id)} aria-label={`${e.label}, ${e.name}, ${e.from} till ${e.to}: ${e.value} ${e.unit}`}>
                    <span className={s.label}>
                      <span className={s.swatch} style={{ background: e.bar }} />
                      <span>{e.label}</span>
                    </span>
                    <Track e={e} st={st} variant="desktop" />
                    <Value e={e} />
                    <span className={`${s.chev} ${open ? s.up : ''}`} />
                  </button>
                  {open && <Details e={e} st={st} variant="desktop" />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <ListFooter st={st} />
    </UpcomingScroll>
  );
}

/** Mobile: the compact 48 h axis (in the top card) with the count and the darkness legend under it. */
export function UpcomingMobileAxis({ st }: { st: UpcomingState }) {
  const { view } = st;
  if (view.empty) return null;
  return (
    <div className={s.mList}>
      <Axis axis={view.axis} variant="mobile" />
      <div className={s.mFoot}>
        <span>{view.countText}</span>
        <Legend st={st} />
      </div>
    </div>
  );
}

/**
 * Mobile: a card per property or place, with the timeline under the condition label.
 */
export function UpcomingMobilePlaces({ st }: { st: UpcomingState }) {
  return <>{st.rows.map((r) => (
    <section key={r.key} className={s.mPlaceCard} aria-label={r.name}>
      <div className={s.mPlaceHead}>
        <PlaceName r={r} st={st} />
        {r.countText && <div className={s.placeCount}>{r.countText}</div>}
      </div>
      {r.events.map((e) => {
        const open = st.openId === e.id;
        return (
          <div key={e.id} className={s.lineWrap}>
            <button type="button" data-testid="upcoming-row" className={s.mLine} aria-expanded={open} onClick={() => st.toggle(e.id)} aria-label={`${e.label}, ${e.name}, ${e.from} till ${e.to}: ${e.value} ${e.unit}`}>
              <span className={s.mLineTop}>
                <span className={s.swatch} style={{ background: e.bar }} />
                <span className={s.mLabel}>{e.label}</span>
                <Value e={e} inline />
              </span>
              <Track e={e} st={st} variant="mobile" />
            </button>
            {open && <Details e={e} st={st} variant="mobile" />}
          </div>
        );
      })}
    </section>
  ))}<ListFooter st={st} /></>;
}
