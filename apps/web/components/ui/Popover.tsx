'use client';

import { useEffect, useRef } from 'react';

/**
 * Frosted dropdown panel from the prototype. Closes on Escape or a click outside its
 * positioned parent (so the trigger button keeps toggling normally).
 */
export function Popover({
  open,
  onClose,
  style,
  children,
}: {
  open: boolean;
  onClose: () => void;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const scope = ref.current?.parentElement;
      if (scope && !scope.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        zIndex: 1000,
        padding: 8,
        borderRadius: 18,
        background: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(20,23,26,0.06)',
        boxShadow: '0 24px 60px -20px rgba(20,23,26,0.3)',
        animation: 'frFade .2s ease both',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
