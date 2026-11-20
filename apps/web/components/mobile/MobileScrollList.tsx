'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useViewScroll } from '@/lib/navigation/view-state';
import styles from './mobile.module.css';

/**
 * Keeps a long mobile list at the height of its first `visible` rows and scrolls the rest inside
 * the card, so the page below (e.g. Portföljkarta) stays close instead of being pushed far down.
 */
export function MobileScrollList({ visible, count, label, children, scrollKey }: { scrollKey: string; visible: number; count: number; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState<number | null>(null);
  const [atEnd, setAtEnd] = useState(false);
  const scrolls = count > visible;
  useViewScroll(scrollKey, scrolls && max !== null, ref);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !scrolls) {
      setMax(null);
      return;
    }
    const measure = () => {
      const row = el.children[visible - 1] as HTMLElement | undefined;
      // Half of the next row peeks out, which shows that the list continues.
      const next = el.children[visible] as HTMLElement | undefined;
      if (row) setMax(row.offsetTop + row.offsetHeight + (next ? Math.round(next.offsetHeight * 0.45) : 0));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible, scrolls, count]);

  return (
    <div className={`${styles.scrollWrap} ${scrolls && !atEnd ? styles.scrollFade : ''}`}>
      <div
        ref={ref}
        className={scrolls ? styles.scrollList : undefined}
        style={scrolls && max ? { maxHeight: max } : undefined}
        tabIndex={scrolls ? 0 : undefined}
        role={scrolls ? 'region' : undefined}
        aria-label={scrolls ? `${label}, ${count} st – scrolla för fler` : undefined}
        onScroll={(e) => {
          const t = e.currentTarget;
          setAtEnd(t.scrollTop + t.clientHeight >= t.scrollHeight - 4);
        }}
      >
        {children}
      </div>
    </div>
  );
}
