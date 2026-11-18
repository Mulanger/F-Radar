'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { UpcomingEvent } from '@/lib/view-models/upcoming';
import type { UpcomingState } from './use-upcoming';
import s from './Upcoming.module.css';

const Svg = ({ d, size = 18, sw = 1.8 }: { d: string; size?: number; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const CHEVRON = 'm9 6 6 6-6 6';

export function UpcomingHeader({ live, title }: { live: boolean; title: React.ReactNode }) {
  return (
    <div className={s.head}>
      {title}
      <span className={s.pill} style={live ? { background: 'oklch(0.95 0.035 155)', color: 'oklch(0.45 0.11 155)' } : { background: 'oklch(0.95 0.05 80)', color: 'oklch(0.45 0.1 70)' }}>
        <span className={s.pillDot} />
        {live ? 'SMHI · 48 h' : 'Demo'}
      </span>
    </div>
  );
}

/** Coloured dot for a row: filled for a warning, a ring for plain information. */
function Dot({ e }: { e: Pick<UpcomingEvent, 'c' | 'hot'> }) {
  return <span className={s.dot} style={e.hot ? { background: e.c } : { boxShadow: `inset 0 0 0 2px ${e.c}` }} />;
}

/** One line of what the next 48 h hold, then the strip "Nu → +48 h" with a dot per row. */
export function UpcomingSummary({ st }: { st: UpcomingState }) {
  const { view } = st;
  return (
    <div className={s.summary}>
      <p className={s.summaryText}>{view.summary}</p>
      {!view.empty && (
        <div className={s.strip} role="group" aria-label="Tidslinje, kommande 48 timmar">
          <div className={s.track}>
            {view.midnights.map((p, i) => (
              <span key={i} className={s.midnight} style={{ left: `${p * 100}%` }}>
                {i === 0 && <span className={s.midnightLabel}>midnatt</span>}
              </span>
            ))}
            {view.dots.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`${s.stripDot} ${st.hoverId === d.id ? s.on : ''}`}
                style={{ left: `${d.pos * 100}%`, ...(d.hot ? { background: d.c } : { background: '#fff', boxShadow: `inset 0 0 0 2px ${d.c}` }) }}
                aria-label={d.label}
                title={d.label}
                onMouseEnter={() => st.setHover(d.id)}
                onMouseLeave={() => st.setHover(null)}
                onFocus={() => st.setHover(d.id)}
                onBlur={() => st.setHover(null)}
                onClick={() => st.openEvent(d.id)}
              />
            ))}
          </div>
          <div className={s.stripEnds}>
            <span>Nu</span>
            <span>+48 h</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function UpcomingRow({ e, st }: { e: UpcomingEvent; st: UpcomingState }) {
  return (
    <button
      type="button"
      data-testid="upcoming-row"
      className={`${s.row} ${st.hoverId === e.id ? s.on : ''}`}
      onClick={() => st.openEvent(e.id)}
      onMouseEnter={() => st.setHover(e.id)}
      onMouseLeave={() => st.setHover(null)}
      aria-label={`${e.title}, ${e.name}, ${e.t}: ${e.value} ${e.unit}. Visa detaljer`}
    >
      <Dot e={e} />
      <span className={s.rowTitle}>{e.title}</span>
      <span className={s.rowTime}>{e.t}</span>
      {/* One cell on a desktop grid row, one flex line under the title on a phone. */}
      <span className={s.rowSub}>
        <span className={s.rowName}>{e.name}</span>
        <span className={s.rowValue} style={{ color: e.hot ? e.c : undefined }}>
          {e.value}
          {e.unit && <span>{e.unit}</span>}
        </span>
      </span>
    </button>
  );
}

export function UpcomingDays({ st }: { st: UpcomingState }) {
  const { view } = st;
  if (view.empty) return null;
  return (
    <div className={s.days}>
      {view.days.map((day) => (
        <section key={day.key} className={s.day} aria-label={`${day.label} · ${day.date}`}>
          <div className={s.dayHead}>
            <span className={s.dayLabel}>{day.label}</span>
            <span className={s.dayDate}>{day.date}</span>
          </div>
          <div className={s.rows}>
            {day.items.map((e) => (
              <UpcomingRow key={e.id} e={e} st={st} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** What a row means and what is good to do. Bottom sheet on mobile, centred dialog on desktop. */
export function UpcomingDetail({ st, variant }: { st: UpcomingState; variant: 'sheet' | 'dialog' }) {
  const e = st.open;
  const closeRef = useRef<HTMLButtonElement>(null);
  const onClose = st.close;
  useEffect(() => {
    if (!e) return;
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [e, onClose]);
  if (!e || typeof document === 'undefined') return null;

  return createPortal(
    <div className={s.overlay} role="dialog" aria-modal="true" aria-labelledby="upcoming-detail-name">
      <div className={s.backdrop} onClick={onClose} />
      <div className={variant === 'sheet' ? s.sheet : s.dialog}>
        {variant === 'sheet' && <div className={s.grabber} />}
        <div className={s.dHead}>
          <span className={s.dIcon} style={{ background: e.bg, color: e.c }}>
            <Svg d={e.icon} size={20} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={s.eyebrow} style={{ color: e.fg }}>{e.catLabel} · {e.toneLabel}</div>
            <div id="upcoming-detail-name" className={s.dName}>{e.title}</div>
            <div className={s.dWhen}>{e.name} · {e.whenLong}</div>
          </div>
          <button ref={closeRef} type="button" className={s.close} onClick={onClose} aria-label="Stäng">
            <Svg d="M6 6l12 12M18 6 6 18" size={16} sw={2.2} />
          </button>
        </div>
        <div className={s.box} style={{ background: '#F6F7F6' }}>
          <div className={s.boxHead}>
            <div className={s.boxTitle}>{e.headline}</div>
            <div className={s.boxValue} style={{ color: e.hot ? e.c : '#14171A' }}>{e.value}</div>
          </div>
          <div className={s.boxBody}>{e.body}</div>
        </div>
        <div className={s.box} style={{ background: e.bg }}>
          <div className={s.actionHead} style={{ color: e.fg }}>Bra att göra</div>
          <div className={s.boxBody} style={{ color: '#14171A' }}>{e.action}</div>
        </div>
        {e.propertyId && (
          <button type="button" className={s.propBtn} onClick={() => st.openProperty(e.propertyId!)}>
            Öppna {e.name}
            <Svg d={CHEVRON} size={16} sw={2} />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
