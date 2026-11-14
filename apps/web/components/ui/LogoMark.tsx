import { C } from '@/lib/design/tokens';

/** Keep the original ring and blue centre, without the square or its horizontal padding. */
export function LogoMark({ size = 32 }: { size?: number }) {
  const diameter = Math.round(size / 2);
  return (
    <span
      aria-hidden="true"
      style={{ width: diameter, height: size, display: 'grid', placeItems: 'center', flex: 'none', background: 'transparent' }}
    >
      <svg width={diameter} height={diameter} viewBox="0 0 24 24" fill="none" focusable="false">
        <circle cx="12" cy="12" r="10.5" stroke={C.text3} strokeWidth="2.4" />
        <circle cx="12" cy="12" r="3.5" fill="#7CC7DD" />
      </svg>
    </span>
  );
}
