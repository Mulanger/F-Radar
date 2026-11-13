import type { CSSProperties, ReactNode } from 'react';
import { SEVERITY, type SeverityKey } from '@/lib/landing/content';
import { MONO } from './styles';

/** FastighetsRadar mark: dark rounded square with a ring and a light-blue dot. */
export function LogoMark({ size = 32, radius = 10 }: { size?: number; radius?: number }) {
  const ring = Math.round(size * 0.47);
  const dot = Math.max(4, Math.round(size * 0.15));
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: radius, background: '#14171A', display: 'grid', placeItems: 'center', flex: 'none' }}>
      <span style={{ width: ring, height: ring, borderRadius: '50%', border: `${size >= 40 ? 2 : 1.6}px solid #E9EEF0`, display: 'grid', placeItems: 'center', boxSizing: 'border-box' }}>
        <span style={{ width: dot, height: dot, borderRadius: '50%', background: '#7CC7DD' }} />
      </span>
    </span>
  );
}

export function StatusPill({ severity, label, size = 'md' }: { severity: SeverityKey; label?: string; size?: 'sm' | 'md' }) {
  const s = SEVERITY[severity];
  const sm = size === 'sm';
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: sm ? 6 : 7, height: sm ? undefined : 30, padding: sm ? '4px 9px' : '0 12px',
        borderRadius: 999, background: s.bg, color: s.fg, fontSize: sm ? 12.5 : 13.5, fontWeight: 500, whiteSpace: 'nowrap', justifySelf: 'start',
      }}
    >
      <span style={{ width: sm ? 5 : 6, height: sm ? 5 : 6, borderRadius: '50%', background: s.dot }} />
      {label ?? s.label}
    </span>
  );
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: '6px 0 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((t) => (
        <li key={t} style={{ display: 'flex', gap: 12, alignItems: 'baseline', fontSize: 16, lineHeight: 1.45 }}>
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: '#14171A', flex: 'none', transform: 'translateY(-2px)' }} />
          {t}
        </li>
      ))}
    </ul>
  );
}

export function MonoChip({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ fontFamily: MONO, fontSize: 12.5, padding: '5px 9px', borderRadius: 8, background: 'rgba(255,255,255,0.7)', color: '#4A5157', ...style }}>{children}</span>;
}

export function Badge({ label, bg, fg, style }: { label: string; bg: string; fg: string; style?: CSSProperties }) {
  return <span style={{ fontSize: 12.5, fontWeight: 500, padding: '3px 8px', borderRadius: 7, background: bg, color: fg, whiteSpace: 'nowrap', ...style }}>{label}</span>;
}
