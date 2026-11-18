'use client';

import type { UpcomingBar, UpcomingRow } from '@/lib/view-models/upcoming';
import type { UpcomingState } from './use-upcoming';
import s from './Upcoming.module.css';

type Variant = 'desktop' | 'mobile';
const pct = (f: number) => `${(f * 100).toFixed(3)}%`;

/** Title, subtitle and the source badge ("SMHI · uppdaterad 16:00"). */
export function UpcomingHeader({ st, variant }: { st: UpcomingState; variant: Variant }) {
  const badge = (
    <span className={s.badge}>
      <span className={s.badgeDot} style={{ background: st.live ? 'oklch(0.65 0.14 155)' : 'oklch(0.72 0.12 75)' }} />
      <span>
        {st.live ? '' : 'Demo · '}
        {variant === 'desktop' ? `SMHI${st.updated ? ` · uppdaterad ${st.updated}` : ''}` : `SMHI${st.updated ? ` ${st.updated}` : ''}`}
      </span>
    </span>
  );
  return (
    <div className={s.head}>
      <div className={s.headTop}>
        <h2 className={s.title}>Kommande förhållanden</h2>
        {badge}
      </div>
      <div className={s.sub}>Prognos och officiella varningar · nästa 48 h</div>
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

/** Kind filter: "Alla 8", "Halka 1", … – the mobile row scrolls sideways. */
export function UpcomingChips({ st, variant }: { st: UpcomingState; variant: Variant }) {
  const chips = (
    <div className={variant === 'desktop' ? s.chips : s.chipsScroll} role="group" aria-label="Filtrera typ av händelse">
      {st.view.chips.map((c) => (
        <button key={c.k} type="button" aria-pressed={c.active} className={`${s.chip} ${c.active ? s.on : ''}`} onClick={() => st.setFilter(c.k)}>
          {c.sw && <span className={s.swatch} style={{ background: c.sw }} />}
          <span>{c.label}</span>
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
        <div className={s.factWide}><span>Källa</span><span>{e.src}</span></div>
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

function PlaceName({ r, st }: { r: UpcomingRow; st: UpcomingState }) {
  return r.propertyId ? (
    <button type="button" className={s.placeName} onClick={() => st.openProperty(r.propertyId!)} title={`Öppna ${r.name}`}>
      {r.name}
    </button>
  ) : (
    <span className={s.placeName}>{r.name}</span>
  );
}

/** Desktop: PLATS | HÄNDELSE | the 48 h axis | VÄRDE, one row per property, one line per condition. */
export function UpcomingTimeline({ st }: { st: UpcomingState }) {
  const { view } = st;
  if (view.empty) return null;
  return (
    <div className={s.table}>
      <div className={s.thead}>
        <div className={s.th}>Plats</div>
        <div className={s.lineGrid}>
          <div className={s.th}>Händelse</div>
          <div className={s.axis} aria-hidden="true">
            {view.axis.midnights.map((m) => (
              <span key={m.pos} className={s.axisLine} style={{ left: pct(m.pos) }} />
            ))}
            {view.axis.today && <span className={s.axisDay} style={{ left: 0 }}>{view.axis.today}</span>}
            {view.axis.midnights.map((m) => (
              <span key={`d${m.pos}`} className={`${s.axisDay} ${s.afterLine}`} style={{ left: pct(m.pos) }}>{m.day} <span>{m.date}</span></span>
            ))}
            <span className={`${s.axisHour} ${s.nowHour}`} style={{ left: 0 }}>{view.axis.now}</span>
            {view.axis.midnights.map((m) => (
              <span key={`h${m.pos}`} className={`${s.axisHour} ${s.afterLine}`} style={{ left: pct(m.pos) }}>00</span>
            ))}
            {view.axis.ticks.map((t) => (
              <span key={t.pos} className={`${s.axisHour} ${s.centred}`} style={{ left: pct(t.pos) }}>{t.label}</span>
            ))}
          </div>
          <div className={`${s.th} ${s.right}`}>Värde</div>
          <div />
        </div>
      </div>
      {view.rows.map((r) => (
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
    </div>
  );
}

/** Mobile: a compact axis, then per property its conditions – label and value, the bar under. */
export function UpcomingListMobile({ st }: { st: UpcomingState }) {
  const { view } = st;
  if (view.empty) return null;
  return (
    <div className={s.mList}>
      <div className={s.mAxis} aria-hidden="true">
        {view.axis.midnights.map((m) => (
          <span key={m.pos} className={s.mAxisLine} style={{ left: pct(m.pos) }} />
        ))}
        {view.axis.today && <span className={s.axisDay} style={{ left: 0 }}>{view.axis.today}</span>}
        {view.axis.midnights.map((m) => (
          <span key={`d${m.pos}`} className={`${s.axisDay} ${s.afterLine}`} style={{ left: pct(m.pos) }}>{m.short}</span>
        ))}
        <span className={`${s.mAxisHour} ${s.nowHour}`} style={{ left: 0 }}>Nu</span>
        {view.axis.midnights.map((m) => (
          <span key={`h${m.pos}`} className={`${s.mAxisHour} ${s.afterLine}`} style={{ left: pct(m.pos) }}>00</span>
        ))}
        {view.axis.ticks.filter((t) => t.label === '12').map((t) => (
          <span key={t.pos} className={`${s.mAxisHour} ${s.centred}`} style={{ left: pct(t.pos) }}>{t.label}</span>
        ))}
      </div>
      {view.rows.map((r) => (
        <div key={r.key} className={s.mPlace}>
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
        </div>
      ))}
      <div className={s.mFoot}>
        <span>{view.countText}</span>
        <Legend st={st} />
      </div>
    </div>
  );
}
