'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatClock } from '@fastighetsradar/domain';
import { UPCOMING_ACK_STYLE, UPCOMING_ICON, type UpcomingEvent, type UpcomingView } from '@/lib/view-models/upcoming';
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

export function UpcomingTiles({ sum, desk }: { sum: UpcomingView['sum']; desk?: boolean }) {
  return (
    <div className={`${s.tiles} ${desk ? s.desk : ''}`}>
      <div className={s.tile}>
        <div className={s.tileHead}><span style={{ color: 'oklch(0.6 0.15 55)', display: 'grid' }}><Svg d={UPCOMING_ICON.alert} size={13} sw={2} /></span>Riskvarningar</div>
        <div className={s.tileValue}>{sum.risk}<span className={s.tileUnit}> st</span></div>
        <div className={s.tileSub} title={sum.riskSub}>{sum.riskSub}</div>
      </div>
      <div className={s.tile}>
        <div className={s.tileHead}><span style={{ color: 'oklch(0.54 0.12 245)', display: 'grid' }}><Svg d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z" size={13} sw={2} /></span>Lägsta temp</div>
        <div className={s.tileValue}>{sum.tmin}</div>
        <div className={s.tileSub} title={sum.tminSub}>{sum.tminSub}</div>
      </div>
      <div className={s.tile} title="Kommande händelser som någon i organisationen har gått igenom">
        <div className={s.tileHead}><span style={{ color: 'oklch(0.55 0.12 155)', display: 'grid' }}><Svg d="M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3" size={13} sw={2} /></span>Kvitterade</div>
        <div className={s.tileValue}>{sum.ack}<span className={s.tileUnit}>/{sum.total}</span></div>
        <div className={s.ackTrack}><div className={s.ackFill} style={{ width: sum.ackW }} /></div>
      </div>
    </div>
  );
}

export function UpcomingChips({ chips, onSelect, style }: { chips: UpcomingView['chips']; onSelect: UpcomingState['setFilter']; style?: React.CSSProperties }) {
  return (
    <div className={s.chips} role="group" aria-label="Filtrera kategori" style={style}>
      {chips.map((c) => (
        <button
          key={c.k}
          type="button"
          aria-pressed={c.active}
          className={s.chip}
          onClick={() => onSelect(c.k)}
          style={{ background: c.active ? '#14171A' : '#FFFFFF', color: c.active ? '#FFFFFF' : '#4A5157' }}
        >
          {c.label}
          <span>{c.count}</span>
        </button>
      ))}
    </div>
  );
}

export function UpcomingCard({ e, ackAt, onOpen, desk }: { e: UpcomingEvent; ackAt: string | undefined; onOpen: () => void; desk?: boolean }) {
  const acked = !!ackAt;
  const accent = acked ? UPCOMING_ACK_STYLE.c : e.c;
  return (
    <button type="button" data-testid="upcoming-card" className={`${s.card} ${desk ? s.desk : ''}`} onClick={onOpen} aria-label={`${e.name}: ${e.title}, ${e.value} ${e.unit}${acked ? ', kvitterad' : ''}. Visa detaljer`}>
      <span className={s.stripe} style={{ background: accent, opacity: acked ? 0.6 : 1 }} />
      <div className={s.cardRow}>
        <span className={s.icon} style={{ background: acked ? UPCOMING_ACK_STYLE.bg : e.bg, color: acked ? UPCOMING_ACK_STYLE.c : e.c }}>
          <Svg d={acked ? UPCOMING_ICON.check : e.icon} />
        </span>
        <div className={s.main}>
          <div className={s.nameRow}>
            <span className={s.name}>{e.name}</span>
            <span className={s.time}>{e.t}</span>
          </div>
          <div className={s.eventTitle}>{e.title} <span>· {e.tag}</span></div>
          <div className={s.meta}>
            {acked ? (
              <span className={s.acked}><Svg d={UPCOMING_ICON.check} size={12} sw={2.4} />Kvitterad {formatClock(ackAt)}</span>
            ) : (
              <span>{e.meta}</span>
            )}
          </div>
        </div>
        <div className={s.value}>
          <div className={s.valueNum} style={{ color: e.hot && !acked ? e.c : '#14171A' }}>{e.value}</div>
          {e.unit && <div className={s.valueUnit}>{e.unit}</div>}
        </div>
      </div>
      {e.hint && !acked && (
        <div className={s.hint} style={{ background: e.bg, color: e.fg }}>
          <Svg d={UPCOMING_ICON.alert} size={15} sw={2} />
          <span>{e.hint}</span>
          <Svg d={CHEVRON} size={16} sw={2} />
        </div>
      )}
    </button>
  );
}

export function UpcomingDays({ st, desk }: { st: UpcomingState; desk?: boolean }) {
  const { view } = st;
  if (view.empty) {
    return (
      <div className={s.empty}>
        <div className={s.emptyTitle}>Inget i prognosen</div>
        <div className={s.emptySub}>Inga händelser över tröskelvärdena de kommande 48 h.</div>
      </div>
    );
  }
  return (
    <>
      {view.days.map((day) => (
        <section key={day.key} className={s.day} aria-label={`${day.label} · ${day.date}`}>
          <div className={s.dayHead}>
            <span className={s.dayLabel}>{day.label}<span> · {day.date}</span></span>
            <span className={s.dayCount}>{day.count}</span>
          </div>
          <div className={desk ? s.panelCards : s.cards}>
            {day.items.map((e) => (
              <UpcomingCard key={e.id} e={e} ackAt={st.acks[e.ackKey]} onOpen={() => st.openEvent(e.id)} desk={desk} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/** Event details with "Kvittera". Bottom sheet on mobile, centred dialog on desktop. */
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

  const ackAt = st.acks[e.ackKey];
  const name = (
    <>
      {e.name}
      {e.propertyId && <span style={{ color: '#9AA1A8', display: 'grid' }}><Svg d={CHEVRON} size={20} sw={2} /></span>}
    </>
  );
  return createPortal(
    <div className={s.overlay} role="dialog" aria-modal="true" aria-labelledby="upcoming-detail-name">
      <div className={s.backdrop} onClick={onClose} />
      <div className={variant === 'sheet' ? s.sheet : s.dialog}>
        {variant === 'sheet' && <div className={s.grabber} />}
        <div className={s.dHead}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={s.eyebrow} style={{ color: e.fg }}>{e.catLabel} · {e.toneLabel}</div>
            {e.propertyId ? (
              <button type="button" id="upcoming-detail-name" className={s.dName} onClick={() => st.openProperty(e.propertyId!)} title="Öppna fastigheten">{name}</button>
            ) : (
              <div id="upcoming-detail-name" className={s.dName}>{name}</div>
            )}
            <div className={s.dWhen}>{e.whenLong}</div>
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
          <div className={s.actionHead} style={{ color: e.fg }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
            Rekommenderad åtgärd
          </div>
          <div className={s.boxBody} style={{ color: '#14171A' }}>{e.action}</div>
        </div>
        <div className={s.actions}>
          <button
            type="button"
            className={s.ackBtn}
            onClick={() => {
              st.toggleAck(e.ackKey);
              if (!ackAt) onClose();
            }}
            style={ackAt ? { background: UPCOMING_ACK_STYLE.bg, color: UPCOMING_ACK_STYLE.fg } : { background: 'oklch(0.55 0.13 155)', color: '#FFFFFF' }}
          >
            <Svg d={UPCOMING_ICON.check} size={17} sw={2.2} />
            {ackAt ? `Kvitterad ${formatClock(ackAt)} · ångra` : 'Kvittera händelse'}
          </button>
          <button type="button" className={s.closeBtn} onClick={onClose}>Stäng</button>
        </div>
        <div className={s.note}>{st.live ? 'Kvitteringen syns för alla i organisationen.' : 'Demo: kvitteringen sparas inte.'}</div>
      </div>
    </div>,
    document.body,
  );
}
