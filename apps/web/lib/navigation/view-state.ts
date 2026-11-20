'use client';

import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

export function readView<T>(key: string, fallback: T): T {
  try {
    const stored = sessionStorage.getItem(`fr-view:${key}`);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch {
    return fallback;
  }
}

export function writeView<T>(key: string, value: T) {
  try {
    sessionStorage.setItem(`fr-view:${key}`, JSON.stringify(value));
  } catch {
    // A restricted browser can still navigate normally without restoring view state.
  }
}

export function useSavedView<T>(key: string, fallback: T) {
  const [saved, setSaved] = useState<{ key: string; value: T }>();
  const value = saved?.key === key ? saved.value : fallback;
  useLayoutEffect(() => {
    setSaved({ key, value: readView(key, fallback) });
  }, [key, fallback]);
  function update(next: T) {
    setSaved({ key, value: next });
    writeView(key, next);
  }
  return [value, update, saved?.key === key] as const;
}

export function useViewScroll(key: string, ready = true, element?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!ready) return;
    const target = element?.current;
    if (element && !target) return;
    const initialPath = window.location.pathname;
    const scroller = target ?? window;
    const save = () => {
      if (window.location.pathname !== initialPath) return;
      writeView(key, target?.scrollTop ?? window.scrollY);
    };
    const frame = requestAnimationFrame(() => {
      if (window.location.pathname !== initialPath) return;
      const previous = readView<number | null>(key, null);
      if (typeof previous === 'number' && Number.isFinite(previous)) {
        if (target) target.scrollTop = previous;
        else if (window.scrollY !== previous) window.scrollTo({ top: previous, behavior: 'instant' });
      }
      scroller.addEventListener('scroll', save, { passive: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', save);
    };
  }, [key, ready, element]);
}
