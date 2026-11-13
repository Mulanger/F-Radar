import type { CSSProperties } from 'react';

/** Shared inline styles for the landing page (values from the approved design). */
export const MONO = "var(--font-geist-mono), 'Geist Mono', ui-monospace, monospace";

export const eyebrow: CSSProperties = { fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6B737B' };
export const h2: CSSProperties = { margin: 0, fontWeight: 500, fontSize: 'clamp(34px,4.2vw,56px)', lineHeight: 1.02, letterSpacing: '-0.04em', textWrap: 'balance' };
export const lead: CSSProperties = { margin: 0, fontSize: 18, lineHeight: 1.55, color: '#4A5157', textWrap: 'pretty' };
export const container: CSSProperties = { maxWidth: 1240, margin: '0 auto', padding: '0 clamp(20px,4vw,40px)' };
export const card: CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 26,
  border: '1px solid rgba(20,23,26,0.06)',
  boxShadow: '0 1px 2px rgba(20,23,26,0.04),0 24px 50px -32px rgba(20,23,26,0.28)',
};
export const smallCard: CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 22,
  border: '1px solid rgba(20,23,26,0.06)',
  boxShadow: '0 1px 2px rgba(20,23,26,0.04)',
  padding: '22px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minHeight: 190,
  boxSizing: 'border-box',
};
export const glass = (alpha: number, blur: number): CSSProperties => ({
  background: `rgba(255,255,255,${alpha})`,
  border: '1px solid rgba(255,255,255,0.9)',
  backdropFilter: `blur(${blur}px)`,
  WebkitBackdropFilter: `blur(${blur}px)`,
});
export const sourceChip: CSSProperties = { fontFamily: MONO, fontSize: 11.5, padding: '3px 7px', borderRadius: 6, background: '#F1F3F2', color: '#4A5157' };
export const textBlock: CSSProperties = { flex: '1 1 380px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 520 };
export const visualBlock: CSSProperties = { flex: '1.3 1 460px', minWidth: 0 };
export const featureRow = (reverse = false): CSSProperties => ({ display: 'flex', flexWrap: reverse ? 'wrap-reverse' : 'wrap', gap: 56, alignItems: 'center' });
export const cardHead: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3 };
export const cardTitle: CSSProperties = { fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em' };
export const cardSub: CSSProperties = { fontSize: 14, color: '#4A5157' };
