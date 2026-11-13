'use client';

import { useEffect, useRef } from 'react';
import type { DetailVM } from '@/lib/view-models/detail';
import { C, card, cardSub, cardTitle, tile } from '@/lib/design/tokens';

/**
 * Animated wave canvas ported from the prototype (`waveRef`). Purely decorative:
 * it eases toward `level` (0–1) and is NOT a measured water level visualisation.
 */
function WaveCanvas({ level }: { level: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const st = { raf: 0, lv: 0.15 };
    const draw = (ts: number) => {
      const t = reduced ? 0 : ts / 1000;
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      st.lv += ((levelRef.current || 0.3) - st.lv) * (reduced ? 1 : 0.03);
      const base = h * (1 - st.lv);
      ([[0.3, 'rgba(126,182,204,0.35)', 1.1, 7], [0.55, 'rgba(96,158,186,0.5)', -0.8, 5], [0.9, null, 0.6, 3.5]] as const).forEach(([, c, sp, a], k) => {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 4)
          ctx.lineTo(x, base + k * 5 + Math.sin((x / w) * Math.PI * 2 * (1.1 + k * 0.45) + t * sp * 1.6) * a + Math.sin((x / w) * Math.PI * 6 + t * sp) * a * 0.35);
        ctx.lineTo(w, h);
        ctx.closePath();
        if (c) ctx.fillStyle = c;
        else {
          const gr = ctx.createLinearGradient(0, base, 0, h);
          gr.addColorStop(0, 'rgba(84,148,176,0.92)');
          gr.addColorStop(1, 'rgba(46,104,136,0.98)');
          ctx.fillStyle = gr;
        }
        ctx.fill();
      });
      st.raf = requestAnimationFrame(draw);
    };
    st.raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(st.raf);
  }, []);

  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden="true" />;
}

/** "Water Risk" – mapped flood exposure (static scenario) + nearby water body level. */
export function WaterRiskPanel({ d }: { d: DetailVM }) {
  const w = d.water;
  return (
    <div style={{ ...card, flex: '1 1 340px', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={cardTitle}>Vattenrisk</div>
          <div style={cardSub}>Översvämningsexponering och vattennivå</div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 10, background: w.fbg, color: w.fc }} title="Karterat översvämningsscenario (MCF) vid adresspunkten – statiskt, inte en aktuell vattennivå eller pågående översvämning">
          Karterat: {w.flood}
        </span>
      </div>
      <div style={{ position: 'relative', height: 190, borderRadius: 18, overflow: 'hidden', background: 'linear-gradient(180deg,#F7FAFB,#E9F0F2)' }}>
        <WaveCanvas level={w.levelFill} />

        <div style={{ position: 'absolute', left: 14, top: 14, padding: '8px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(10px)' }}>
          <div style={{ fontSize: 11, color: C.text3 }}>{w.body}</div>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em' }}>{w.level}</div><div style={{fontSize:11,color:C.text3}}>{w.hasLevel ? w.reference : "Ej tillgänglig"}</div>
        </div>
      </div>
      <div style={{fontSize:11,color:C.text3,lineHeight:1.5}}>{w.source}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          ['Karterad översvämningszon', w.dist],
          ['Trend', w.trend],
          ['Ytvatten', w.surface],
          ['Källarrisk', w.basement],
        ].map(([label, value]) => (
          <div key={label} style={tile}>
            <div style={{ fontSize: 11.5, color: C.text4 }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 500, marginTop: 2 }}>{value}</div>
          </div>
        ))}
      </div>
      {w.note && <div style={{ fontSize: 11, color: C.text4, lineHeight: 1.45 }}>{w.note} Källa: MCF Översvämningsportalen.</div>}
    </div>
  );
}
