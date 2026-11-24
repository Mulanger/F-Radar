'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDashboard } from '@/lib/state/dashboard-state';
import type { WxItem, WxSplit } from '@/lib/view-models/overview';
import { WL } from '@/lib/design/tokens';
import s from './WeatherKpiPills.module.css';

/** Offer the larger list for groups with more than five properties. */
export const WX_CARD_MAX = 5;

const Chevron = () => (
  <span className={s.chev}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
  </span>
);

function Rows({ items, onOpen }: { items: WxItem[]; onOpen: (id: string) => void }) {
  return (
    <ul className={s.list}>
      {items.map((x) => (
        <li key={x.propertyId}>
          <button type="button" className={s.row} onClick={() => onOpen(x.propertyId)} title="Öppna fastigheten">
            <span className={s.rowMain}>
              <span className={s.rowName}>{x.name}</span>
              <span className={s.rowText}>{x.text}</span>
            </span>
            <Chevron />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Regn/Vind/Frost pills of "Väderhändelser idag". A pill with properties opens a small card
 * naming them (worst first); more than WX_CARD_MAX opens a scrollable modal from "Visa alla".
 */
export function WeatherKpiPills({ split, available, pillClassName, pillStyle }: { split: (WxSplit & { warningLevel?: keyof typeof WL })[]; available: boolean; pillClassName?: string; pillStyle?: React.CSSProperties }) {
  const ds = useDashboard();
  const [open, setOpen] = useState<string | null>(null);
  const [modal, setModal] = useState<string | null>(null);
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const btns = useRef<Record<string, HTMLButtonElement | null>>({});
  const popRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const current = split.find((x) => x.label === open) ?? null;
  const full = split.find((x) => x.label === modal) ?? null;

  // Place the card under the pill (above it when there is no room), clamped to the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const b = btns.current[open];
    if (!b) return;
    const r = b.getBoundingClientRect();
    const width = Math.min(290, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
    const h = popRef.current?.offsetHeight ?? 220;
    const below = window.innerHeight - r.bottom - 14;
    const above = r.top - 14;
    setPos(h > below && above > below
      ? { left, bottom: window.innerHeight - r.top + 6, maxHeight: above }
      : { left, top: r.bottom + 6, maxHeight: below });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && popRef.current?.contains(e.target)) return;
      close();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btns.current[open]?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        btns.current[open]?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  useEffect(() => {
    if (!modal) return;
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModal(null);
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [modal]);

  const openProperty = (id: string) => {
    setOpen(null);
    setModal(null);
    ds.openProperty(id);
  };

  return (
    <>
      {split.map((x) => {
        const clickable = available && x.items.length > 0;
        const colors = x.warningLevel && WL[x.warningLevel];
        const countLabel = colors ? (x.n === 1 ? 'varning' : 'varningar') : (x.n === 1 ? 'fastighet' : 'fastigheter');
        return (
          <button
            key={x.label}
            ref={(el) => {
              btns.current[x.label] = el;
            }}
            type="button"
            className={`${s.pill} ${pillClassName ?? ''}`}
            style={colors ? { ...pillStyle, color: colors.fg, background: colors.bg } : pillStyle}
            disabled={!clickable}
            aria-haspopup={clickable ? 'dialog' : undefined}
            aria-expanded={clickable ? open === x.label : undefined}
            aria-label={available ? `${x.label}: ${x.n} ${countLabel}${clickable ? '. Visa vilka' : ''}` : `${x.label}: prognos saknas`}
            onClick={() => {
              setPos(null);
              setOpen((o) => (o === x.label ? null : x.label));
            }}
          >
            {x.label} <b style={{ fontWeight: 600, color: colors ? 'inherit' : '#14171A' }}>{colors && '×'}{available ? x.n : '—'}</b>
          </button>
        );
      })}

      {current &&
        typeof document !== 'undefined' &&
        createPortal(
          <div ref={popRef} className={s.pop} role="dialog" aria-label={`${current.title}: fastigheter`} style={pos ?? { left: -9999, top: 0 }}>
            <div className={s.popHead}>
              <span className={s.popTitle}>{current.title}</span>
              <span className={s.popCount}>{current.items.length} {current.items.length === 1 ? 'fastighet' : 'fastigheter'}</span>
            </div>
            {current.rule && <div className={s.rule}>{current.rule}</div>}
            <div className={s.previewScroll}>
              <Rows items={current.items} onOpen={openProperty} />
            </div>
            {current.items.length > WX_CARD_MAX && (
              <button
                type="button"
                className={s.more}
                onClick={() => {
                  setModal(current.label);
                  setOpen(null);
                }}
              >
                Visa alla {current.items.length}
              </button>
            )}
          </div>,
          document.body,
        )}

      {full &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className={s.overlay} role="dialog" aria-modal="true" aria-labelledby="wx-modal-title">
            <div className={s.backdrop} onClick={() => setModal(null)} />
            <div className={s.dialog}>
              <div className={s.dHead}>
                <div style={{ minWidth: 0 }}>
                  <h2 id="wx-modal-title" className={s.dTitle}>{full.title} · {full.items.length} {full.items.length === 1 ? 'fastighet' : 'fastigheter'}</h2>
                  {full.rule && <div className={s.dSub}>{full.rule}</div>}
                </div>
                <button ref={closeRef} type="button" className={s.close} onClick={() => setModal(null)} aria-label="Stäng">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </div>
              <div className={s.scroll}>
                <Rows items={full.items} onOpen={openProperty} />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
