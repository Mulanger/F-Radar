'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDashboard } from '@/lib/state/dashboard-state';
import { PropertyPicker } from '../properties/PropertyPicker';

/**
 * Header search as a command palette (⌘K / Ctrl+K or a click on the search field). The first
 * version finds properties only (docs/plans/skalning.md, S-02); the label says so until alarms
 * become searchable. Esc, a click outside or choosing a property closes it and returns focus.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open || typeof document === 'undefined') return null;
  return <PaletteDialog onClose={onClose} />;
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const ds = useDashboard();
  // Captured while rendering, before the search field takes focus: where focus returns on close.
  const [previous] = useState(() => document.activeElement as HTMLElement | null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [previous]);

  return createPortal(
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '12vh 16px 16px', background: 'rgba(20,23,26,0.28)', animation: 'frFade .15s ease both' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sök fastigheter"
        // The search field is the only tab stop; keep focus inside the dialog.
        onKeyDown={(e) => e.key === 'Tab' && e.preventDefault()}
        style={{ width: 'min(560px, 100%)', padding: 8, borderRadius: 20, background: 'rgba(255,255,255,0.97)', border: '1px solid rgba(20,23,26,0.06)', boxShadow: '0 30px 80px -24px rgba(20,23,26,0.45)' }}
      >
        <PropertyPicker
          variant="status"
          maxHeight="min(calc(76vh - 16px), 560px)"
          placeholder="Sök fastigheter på namn, adress, område eller kommun"
          onSelect={(id) => {
            onClose();
            ds.openProperty(id);
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
