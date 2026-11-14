'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FORECAST, type ForecastTab } from '@/lib/landing/content';
import { chartModel, smsPreview, type SmsLevels } from '@/lib/landing/logic';
import { storeSignupEmail } from '@/lib/landing/signup-email';
import { LogoMark } from './Primitives';
import { card, cardHead, cardSub, cardTitle, MONO } from './styles';
import css from './landing.module.css';

/* ------------------------------------------------------------------ */
/* Decorative water waves (Vattenrisk)                                 */
/* ------------------------------------------------------------------ */

export function WaterCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let visible = true;
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => (visible = es[0]?.isIntersecting ?? true)) : null;
    io?.observe(c);
    const layers = [
      { a: 7, f: 0.011, s: 0.7, dy: -8, c: 'rgba(150,192,208,0.45)' },
      { a: 5, f: 0.017, s: -1.0, dy: 0, c: 'rgba(110,162,186,0.6)' },
      { a: 4, f: 0.008, s: 0.45, dy: 12, c: null },
    ];
    let raf = 0;
    const draw = (now: number) => {
      if (!reduced) raf = requestAnimationFrame(draw);
      if (!visible) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (!w || !h) return;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const t = reduced ? 0 : now / 1000;
      const level = h * 0.44;
      for (const L of layers) {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w + 6; x += 6) ctx.lineTo(x, level + L.dy + Math.sin(x * L.f + t * L.s * 2) * L.a + Math.sin(x * L.f * 2.3 - t * L.s) * L.a * 0.45);
        ctx.lineTo(w, h);
        ctx.closePath();
        if (L.c) ctx.fillStyle = L.c;
        else {
          const g = ctx.createLinearGradient(0, level, 0, h);
          g.addColorStop(0, '#5B93AE');
          g.addColorStop(1, '#2F6684');
          ctx.fillStyle = g;
        }
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, []);
  return <canvas ref={ref} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />;
}

/* ------------------------------------------------------------------ */
/* 24 h forecast chart with tabs (Väderförhållanden)                   */
/* ------------------------------------------------------------------ */

export function ForecastPanel() {
  const [tab, setTab] = useState<ForecastTab>('t');
  const ch = chartModel(tab);
  return (
    <div className={css.forecastPanel} style={{ ...card, boxShadow: '0 1px 2px rgba(20,23,26,0.04)', padding: 'clamp(20px,3vw,28px)', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={cardHead}>
        <span style={cardTitle}>Väderförhållanden</span>
        <span style={cardSub}>Modell · SMHI punktprognos · kommande 24 h · illustration</span>
      </div>
      <div role="tablist" aria-label="Prognosvärde" style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 999, background: '#F1F3F2', alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {(Object.keys(FORECAST) as ForecastTab[]).map((k) => {
          const on = tab === k;
          return (
            <button
              key={k}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(k)}
              style={{ border: 0, cursor: 'pointer', height: 34, padding: '0 16px', borderRadius: 999, fontSize: 14, transition: 'background .2s', background: on ? '#FFFFFF' : 'transparent', color: on ? '#14171A' : '#4A5157', boxShadow: on ? '0 1px 3px rgba(20,23,26,0.12)' : 'none' }}
            >
              {FORECAST[k].label}
            </button>
          );
        })}
      </div>
      <dl style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 32px', margin: 0 }}>
        {([['Nu', ch.now], ['Min', ch.min], ['Max', ch.max], ['Medel', ch.avg]] as const).map(([l, v]) => (
          <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <dt style={{ fontSize: 13, color: '#6B737B' }}>{l}</dt>
            <dd style={{ margin: 0, fontSize: 22, letterSpacing: '-0.02em' }}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className={css.forecastGraph} style={{ position: 'relative', height: 170 }}>
        <svg viewBox="0 0 600 170" preserveAspectRatio="none" role="img" aria-label={`Prognosdiagram: ${FORECAST[tab].label}, ${ch.peakLabel}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
          <defs>
            <linearGradient id="frLandingArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={ch.color} stopOpacity="0.22" />
              <stop offset="1" stopColor={ch.color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[10, 85, 160].map((y) => (
            <line key={y} x1="0" y1={y} x2="600" y2={y} stroke="rgba(20,23,26,0.08)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={ch.area} fill="url(#frLandingArea)" />
          <path d={ch.line} fill="none" stroke={ch.color} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
        </svg>
        <span aria-hidden="true" style={{ position: 'absolute', width: 12, height: 12, margin: '-6px 0 0 -6px', borderRadius: '50%', background: '#FFFFFF', border: `2.5px solid ${ch.color}`, boxSizing: 'border-box', left: ch.peakX, top: ch.peakY }} />
        <span className={css.forecastTooltip} aria-hidden="true" style={{ position: 'absolute', transform: 'translate(-100%,-150%)', marginLeft: 8, whiteSpace: 'nowrap', fontSize: 12.5, padding: '5px 9px', borderRadius: 8, background: '#14171A', color: '#FFFFFF', left: ch.peakX, top: ch.peakY }}>{ch.peakLabel}</span>
      </div>
      <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 11.5, color: '#6B737B' }}>
        <span>Nu</span><span>20:00</span><span>02:00</span><span>08:00</span><span>14:00</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Interactive SMS-rule demo                                           */
/* ------------------------------------------------------------------ */

const LEVEL_STYLE = {
  gul: { label: 'Gul', bg: '#FAF0BE', fg: '#7A5E00', dot: '#D9B21F' },
  orange: { label: 'Orange', bg: '#FCE1C6', fg: '#A9530C', dot: '#E08A2E' },
  rod: { label: 'Röd', bg: '#FCE1DD', fg: '#B8362B', dot: '#D8473A' },
} as const;

export function SmsRuleDemo() {
  const [levels, setLevels] = useState<SmsLevels>({ gul: false, orange: true, rod: true });
  const [quiet, setQuiet] = useState(true);
  const p = smsPreview(levels);
  return (
    <div className={css.smsDemo} style={{ position: 'relative', paddingBottom: 40 }}>
      <div className={css.smsRule} style={{ ...card, padding: 'clamp(20px,3vw,30px)', display: 'flex', flexDirection: 'column', gap: 22, width: '88%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={cardTitle}>Skapa regel</span>
          <span style={{ fontFamily: MONO, fontSize: 12, padding: '4px 8px', borderRadius: 7, background: '#F1F3F2', color: '#4A5157' }}>SMHI officiella varningar</span>
        </div>
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <legend style={{ fontSize: 13.5, color: '#4A5157', padding: 0, marginBottom: 10 }}>Varningsnivåer</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(Object.keys(LEVEL_STYLE) as Array<keyof SmsLevels>).map((k) => {
              const on = levels[k];
              const st = LEVEL_STYLE[k];
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setLevels((l) => ({ ...l, [k]: !l[k] }))}
                  style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 14px', borderRadius: 999, fontSize: 14.5, fontWeight: 500, transition: 'all .2s', background: on ? st.bg : '#FFFFFF', color: on ? st.fg : '#6B737B', border: `1px solid ${on ? 'transparent' : 'rgba(20,23,26,0.12)'}` }}
                >
                  <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: '50%', boxSizing: 'border-box', border: `1.5px solid ${on ? st.fg : '#6B737B'}`, background: on ? st.dot : 'transparent' }} />
                  {st.label}
                </button>
              );
            })}
          </div>
          <span aria-live="polite" style={{ fontSize: 13.5, color: '#6B737B' }}>{p.levelsText}</span>
        </fieldset>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 13.5, color: '#4A5157' }}>Fastigheter</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['Augustendal Brygga', 'Sjöstaden Kaj'].map((n) => (
              <span key={n} style={{ height: 34, display: 'inline-flex', alignItems: 'center', padding: '0 13px', borderRadius: 999, background: '#F1F3F2', fontSize: 14 }}>{n}</span>
            ))}
            <span style={{ height: 34, display: 'inline-flex', alignItems: 'center', padding: '0 13px', borderRadius: 999, border: '1px dashed rgba(20,23,26,0.18)', fontSize: 14, color: '#6B737B' }}>+ 6 till</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 14, background: '#F7F8F6' }}>
          <button
            type="button"
            role="switch"
            aria-checked={quiet}
            aria-label="Tysta timmar"
            onClick={() => setQuiet((q) => !q)}
            style={{ position: 'relative', width: 44, height: 26, borderRadius: 999, border: 0, cursor: 'pointer', flex: 'none', padding: 0, transition: 'background .2s', background: quiet ? '#14171A' : '#C9CED2' }}
          >
            <span style={{ position: 'absolute', top: 3, left: 3, width: 20, height: 20, borderRadius: '50%', background: '#FFFFFF', boxShadow: '0 1px 3px rgba(20,23,26,0.3)', transition: 'transform .2s', transform: quiet ? 'translateX(18px)' : 'translateX(0px)' }} />
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 14.5, fontWeight: 500 }}>Tysta timmar</span>
            <span style={{ fontSize: 13, color: '#6B737B' }}>{quiet ? 'Inga SMS mellan 22:00 och 07:00' : 'SMS skickas dygnet runt'}</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {([['Max per fastighet och dag', '3'], ['Minsta tid mellan SMS', '6 h']] as const).map(([l, v]) => (
            <div key={l} style={{ borderRadius: 14, border: '1px solid rgba(20,23,26,0.08)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 12.5, color: '#6B737B' }}>{l}</span>
              <span style={{ fontSize: 18 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div
        className={css.smsPreview}
        aria-live="polite"
        style={{ position: 'absolute', right: 0, bottom: 0, width: 'min(330px,72%)', padding: '16px 18px', borderRadius: 22, background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.95)', backdropFilter: 'blur(18px) saturate(1.5)', WebkitBackdropFilter: 'blur(18px) saturate(1.5)', boxShadow: '0 28px 56px -24px rgba(20,23,26,0.4)', display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <LogoMark size={28} />
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Förhandsvisning</span>
          <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11.5, color: '#6B737B' }}>SMS</span>
        </div>
        {p.body ? (
          <div style={{ padding: '12px 14px', borderRadius: '16px 16px 16px 6px', background: '#E8EBEA', fontSize: 14, lineHeight: 1.45 }}>{p.body}</div>
        ) : (
          <div style={{ padding: '12px 14px', borderRadius: 16, border: '1px dashed rgba(20,23,26,0.16)', fontSize: 14, lineHeight: 1.45, color: '#6B737B' }}>{p.empty}</div>
        )}
        <span style={{ fontFamily: MONO, fontSize: 11.5, color: '#6B737B' }}>Till 2 mottagare · simulerad förhandsvisning</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Get started (account creation)                                      */
/* ------------------------------------------------------------------ */

export function GetStartedForm({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  if (signedIn) {
    return (
      <Link href="/overview" className={css.primary} style={{ height: 54, display: 'flex', alignItems: 'center', padding: '0 28px', borderRadius: 999, background: '#14171A', fontSize: 16, fontWeight: 500 }}>
        Öppna översikten
      </Link>
    );
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    storeSignupEmail(email);
    router.push('/sign-up');
  };
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, width: '100%', maxWidth: 520, paddingTop: 8 }}>
      <label htmlFor="lp-email" className="fr-sr-only">E-postadress</label>
      <input
        id="lp-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="namn@foretaget.se"
        className={css.emailInput}
        style={{ flex: '1 1 260px', height: 54, padding: '0 22px', borderRadius: 999, border: '1px solid rgba(20,23,26,0.1)', background: '#FFFFFF', fontFamily: 'inherit', fontSize: 16, color: '#14171A', boxSizing: 'border-box' }}
      />
      <button type="submit" className={css.primary} style={{ height: 54, padding: '0 28px', borderRadius: 999, border: 0, background: '#14171A', fontSize: 16, fontWeight: 500, cursor: 'pointer' }}>
        Skapa konto
      </button>
    </form>
  );
}
