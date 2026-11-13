'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import css from './landing.module.css';

/**
 * Fade-and-rise on first scroll into view (design: `data-reveal`). Content is rendered visible on
 * the server and only hidden after hydration, so it is never lost without JavaScript or for crawlers;
 * prefers-reduced-motion disables the effect (CSS).
 */
export function Reveal({ children, style, as: Tag = 'div', id, className }: { children: ReactNode; style?: CSSProperties; as?: 'div' | 'section'; id?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) return; // already on screen: no flash
    el.classList.add(css.revealHidden!);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.remove(css.revealHidden!);
          io.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -30px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} id={id} className={[css.reveal, className].filter(Boolean).join(' ')} style={style}>
      {children}
    </Tag>
  );
}
