/** Round check (on) / cross (off) badge, e.g. for whether SMS alerts are switched on. */
export function OnOffBadge({ on, size = 22 }: { on: boolean; size?: number }) {
  const c = on ? 'oklch(0.58 0.13 155)' : 'oklch(0.6 0.18 27)';
  const glyph = Math.round(size * 0.55);
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: `color-mix(in oklch, ${c} 14%, white)`, boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${c} 28%, white)` }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {on ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M7 7l10 10M17 7L7 17" />}
      </svg>
    </span>
  );
}
