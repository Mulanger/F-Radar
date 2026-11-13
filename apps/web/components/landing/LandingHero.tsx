'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { HERO_ANNOTATIONS, HERO_SMS, HERO_SOURCES, HERO_STATS, SEVERITY, type SeverityKey } from '@/lib/landing/content';
import type { AnnotationEls, LandingSceneHandle } from './hero-scene';
import { LogoMark, MonoChip } from './Primitives';
import { glass, MONO } from './styles';
import css from './landing.module.css';

/**
 * Hero with the interactive 3D property island (drag to rotate). three.js is loaded lazily after
 * first paint; if WebGL is unavailable the hero keeps its gradient background and all text.
 */
export function LandingHero({ signedIn }: { signedIn: boolean }) {
  const heroRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  const smsRef = useRef<HTMLDivElement>(null);
  const annRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [sev, setSev] = useState<SeverityKey>('warning');

  useEffect(() => {
    let handle: LandingSceneHandle | null = null;
    let cancelled = false;
    import('./hero-scene')
      .then(({ createLandingScene }) => {
        const hero = heroRef.current;
        const canvas = canvasRef.current;
        const col = colRef.current;
        if (cancelled || !hero || !canvas || !col) return;
        const annotations: Array<AnnotationEls | null> = annRefs.current.map((el) => {
          if (!el) return null;
          const card = el.querySelector<HTMLElement>('[data-r="card"]');
          const dot = el.querySelector<HTMLElement>('[data-r="dot"]');
          const line = el.querySelector<HTMLElement>('[data-r="line"]');
          return card && dot && line ? { el, card, dot, line } : null;
        });
        try {
          handle = createLandingScene({
            hero, canvas, col, annotations, sms: smsRef.current,
            severities: HERO_ANNOTATIONS.map((a) => a.severity),
            onSeverity: setSev,
          });
        } catch (e) {
          console.warn('3D-scenen kunde inte laddas', e instanceof Error ? e.message : e);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      handle?.dispose();
    };
  }, []);

  const s = SEVERITY[sev];
  return (
    <section id="top" aria-label="Introduktion" style={{ padding: '14px clamp(12px,2vw,24px) 0' }}>
      <div
        ref={heroRef}
        style={{
          position: 'relative', maxWidth: 1320, margin: '0 auto', borderRadius: 32, overflow: 'hidden',
          background: 'linear-gradient(180deg,#E6EEF1 0%,#EDF1F1 55%,#F1F3F2 100%)', border: '1px solid rgba(255,255,255,0.9)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8),0 30px 60px -40px rgba(20,23,26,0.25)',
        }}
      >
        <canvas ref={canvasRef} className={css.canvas} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', zIndex: 0 }} />

        <div style={{ position: 'relative', zIndex: 3, display: 'flex', flexWrap: 'wrap', minHeight: 760, pointerEvents: 'none' }}>
          <div style={{ flex: '1 1 420px', maxWidth: 620, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28, padding: 'clamp(32px,5vw,72px) clamp(24px,4vw,56px)', pointerEvents: 'auto' }}>
            <div style={{ display: 'flex' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 14px', borderRadius: 999, ...glass(0.7, 10), fontSize: 14, color: '#4A5157' }}>
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: '#3FA66B', boxShadow: '0 0 0 3px rgba(63,166,107,0.18)' }} />
                Live-data från svenska myndigheter
              </span>
            </div>
            <h1 style={{ margin: 0, fontWeight: 500, fontSize: 'clamp(44px,5.4vw,78px)', lineHeight: 0.98, letterSpacing: '-0.045em', color: '#14171A', textWrap: 'balance' }}>
              Allt som påverkar dina fastigheter. På ett ställe.
            </h1>
            <p style={{ margin: 0, fontSize: 'clamp(17px,1.4vw,19px)', lineHeight: 1.55, color: '#4A5157', maxWidth: '31em', textWrap: 'pretty' }}>
              FastighetsRadar bevakar varje adress med data från SMHI, Krisinformation, Trafikverket, SGU och fler. Du ser läget direkt — och får SMS när
              något faktiskt kräver åtgärd.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <Link
                href={signedIn ? '/overview' : '/sign-up'}
                className={css.primary}
                style={{ height: 52, display: 'flex', alignItems: 'center', gap: 10, padding: '0 26px', borderRadius: 999, background: '#14171A', fontSize: 16, fontWeight: 500, boxShadow: '0 10px 24px -12px rgba(20,23,26,0.5)' }}
              >
                {signedIn ? 'Öppna översikten' : 'Kom igång'}
                <span aria-hidden="true" style={{ fontSize: 15, opacity: 0.7 }}>→</span>
              </Link>
              <a href="#sa-fungerar-det" className={css.secondary} style={{ height: 52, display: 'flex', alignItems: 'center', padding: '0 24px', borderRadius: 999, background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(20,23,26,0.07)', fontSize: 16, fontWeight: 500 }}>
                Se hur det fungerar
              </a>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
              <span style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6B737B' }}>Källor</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {HERO_SOURCES.map((src) => (
                  <MonoChip key={src}>{src}</MonoChip>
                ))}
              </div>
            </div>
          </div>

          <div ref={colRef} className={css.heroCol} style={{ flex: '1.45 1 480px', position: 'relative', minHeight: 600, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: 22, left: 22, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 14px', borderRadius: 999, ...glass(0.72, 12), boxShadow: '0 6px 20px -12px rgba(20,23,26,0.2)', maxWidth: 'calc(100% - 44px)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, color: '#14171A', fontWeight: 500, whiteSpace: 'nowrap' }}>Augustendal Brygga</span>
              <span style={{ fontSize: 13.5, color: '#6B737B', whiteSpace: 'nowrap' }}>· Nacka Strand</span>
              <span
                aria-live="polite"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 999, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', transition: 'background .4s,color .4s', background: s.bg, color: s.fg }}
              >
                <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />
                {s.label}
              </span>
            </div>

            <div
              ref={smsRef}
              aria-hidden="true"
              style={{ position: 'absolute', top: 18, right: 18, width: 300, maxWidth: 'calc(100% - 36px)', opacity: 0, zIndex: 4, padding: '14px 16px', borderRadius: 20, background: 'rgba(255,255,255,0.86)', border: '1px solid rgba(255,255,255,0.95)', backdropFilter: 'blur(18px) saturate(1.5)', WebkitBackdropFilter: 'blur(18px) saturate(1.5)', boxShadow: '0 18px 40px -18px rgba(20,23,26,0.35)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <LogoMark size={26} radius={8} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#14171A' }}>SMS · FastighetsRadar</span>
                <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11.5, color: '#6B737B' }}>nu</span>
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.45, color: '#14171A' }}>{HERO_SMS}</div>
            </div>

            <dl style={{ position: 'absolute', left: 22, bottom: 22, margin: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 26px', padding: '14px 22px', borderRadius: 20, ...glass(0.72, 14), boxShadow: '0 10px 30px -18px rgba(20,23,26,0.25)', maxWidth: 'calc(100% - 44px)', boxSizing: 'border-box' }}>
              {HERO_STATS.map((st) => (
                <div key={st.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <dt style={{ fontSize: 12.5, color: '#6B737B' }}>{st.label}</dt>
                  <dd style={{ margin: 0, fontSize: 21, letterSpacing: '-0.02em' }}>{st.value}</dd>
                </div>
              ))}
            </dl>

            <div aria-hidden="true" className={css.dragHint} style={{ position: 'absolute', right: 24, bottom: 30, fontFamily: MONO, fontSize: 11.5, color: '#6B737B', letterSpacing: '0.02em' }}>
              ← dra för att rotera →
            </div>
          </div>
        </div>

        {/* Annotation cards, positioned every frame by the scene (decorative → aria-hidden). */}
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
          {HERO_ANNOTATIONS.map((a, i) => (
            <div key={a.title} ref={(el) => { annRefs.current[i] = el; }} style={{ position: 'absolute', left: 0, top: 0, opacity: 0 }}>
              <div data-r="line" style={{ position: 'absolute', left: 0, top: 0, height: 1, background: 'rgba(20,23,26,0.28)', transformOrigin: '0 50%' }} />
              <div data-r="dot" style={{ position: 'absolute', left: -6, top: -6, width: 12, height: 12, borderRadius: '50%', background: a.dot, border: '2px solid #FFFFFF', boxSizing: 'border-box', boxShadow: `0 0 0 5px ${a.dot}38` }} />
              <div data-r="card" style={{ position: 'absolute', left: 0, top: 0, width: 248, padding: '13px 15px 14px', borderRadius: 18, background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.95)', backdropFilter: 'blur(16px) saturate(1.4)', WebkitBackdropFilter: 'blur(16px) saturate(1.4)', boxShadow: '0 16px 36px -18px rgba(20,23,26,0.32)', boxSizing: 'border-box' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
                  <span style={{ fontFamily: MONO, fontSize: 11.5, padding: '3px 7px', borderRadius: 6, background: '#F1F3F2', color: '#4A5157' }}>{a.source}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11.5, color: '#6B737B' }}>{a.time}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500, padding: '3px 8px', borderRadius: 7, background: a.badge.bg, color: a.badge.fg }}>{a.badge.label}</span>
                  <span style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em' }}>{a.title}</span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.4, color: '#6B737B', marginTop: 6 }}>{a.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
