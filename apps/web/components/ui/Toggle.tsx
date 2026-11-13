'use client';

import { C } from '@/lib/design/tokens';

/**
 * Pill switch from the prototype (34×20 small, 42×24 large). Rendered as an
 * accessible `role="switch"` button. Toggling is local UI state – no SMS is sent.
 */
export function Toggle({
  on,
  onToggle,
  label,
  size = 'sm',
  disabled = false,
}: {
  on: boolean;
  onToggle: (e: React.MouseEvent | React.KeyboardEvent) => void;
  label: string;
  size?: 'sm' | 'lg';
  disabled?: boolean;
}) {
  const lg = size === 'lg';
  const w = lg ? 42 : 34;
  const h = lg ? 24 : 20;
  const knob = lg ? 20 : 16;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      title={disabled ? 'Inte tillgängligt än' : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e);
      }}
      style={{
        width: w,
        height: h,
        borderRadius: h / 2,
        background: on ? C.toggleOn : C.toggleOff,
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background .25s',
        border: 'none',
        padding: 0,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          width: knob,
          height: knob,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,.2)',
          transform: `translateX(${on ? (lg ? 18 : 14) : 0}px)`,
          transition: 'transform .25s',
        }}
      />
    </button>
  );
}
