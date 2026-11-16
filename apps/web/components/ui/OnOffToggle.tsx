/**
 * Read-only toggle-switch symbol showing whether something is switched on (e.g. SMS alerts).
 * Purely visual: not focusable and not clickable — the caller supplies the accessible label.
 */
export function OnOffToggle({ on, width = 34 }: { on: boolean; width?: number }) {
  const height = Math.round(width * 0.59);
  const pad = 2;
  const knob = height - pad * 2;
  const track = on ? 'oklch(0.62 0.14 155)' : 'oklch(0.86 0.005 250)';
  return (
    <span
      aria-hidden="true"
      style={{ position: 'relative', display: 'inline-block', flexShrink: 0, width, height, borderRadius: height, background: track, boxShadow: 'inset 0 1px 2px rgba(20,23,26,0.12)' }}
    >
      <span
        style={{ position: 'absolute', top: pad, left: on ? width - knob - pad : pad, width: knob, height: knob, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(20,23,26,0.25)' }}
      />
    </span>
  );
}
