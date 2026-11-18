/**
 * Moon for night-only work ("Nattarbete 21–04"): such roadworks and closures rarely affect the
 * property in daytime. `text` also shows the label next to the moon.
 */
export function NightMoon({ label, text = false }: { label: string; text?: boolean }) {
  return (
    <span
      role="img"
      aria-label={`${label} – påverkar troligen inte dagtid`}
      title={`${label} – påverkar troligen inte dagtid`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, color: 'oklch(0.48 0.09 270)', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8z" />
      </svg>
      {text && <span>{label}</span>}
    </span>
  );
}
