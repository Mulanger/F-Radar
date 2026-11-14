'use client';

import { useRef, useState, type ReactNode } from 'react';
import css from './landing.module.css';

/** The same three steps form a desktop grid and a touch/keyboard carousel on phones. */
export function StepsCarousel({ children }: { children: ReactNode }) {
  const list = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState(0);

  function selectStep(index: number) {
    const element = list.current;
    const first = element?.children[0] as HTMLElement | undefined;
    const step = element?.children[index] as HTMLElement | undefined;
    if (!element || !first || !step) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element.scrollTo({ left: step.offsetLeft - first.offsetLeft, behavior: reducedMotion ? 'instant' : 'smooth' });
    setActive(index);
  }

  function updateStep() {
    const element = list.current;
    const first = element?.children[0] as HTMLElement | undefined;
    if (!element || !first) return;
    let nearest = 0;
    let distance = Infinity;
    Array.from(element.children).forEach((child, index) => {
      const offset = Math.abs((child as HTMLElement).offsetLeft - first.offsetLeft - element.scrollLeft);
      if (offset < distance) {
        distance = offset;
        nearest = index;
      }
    });
    setActive(nearest);
  }

  return (
    <div className={css.stepsCarousel}>
      <ol ref={list} className={css.stepsList} onScroll={updateStep} aria-label="Från adress till besked">
        {children}
      </ol>
      <div className={css.stepsPagination} role="group" aria-label="Välj steg">
        {[0, 1, 2].map((index) => (
          <button
            key={index}
            type="button"
            aria-label={`Visa steg ${index + 1}`}
            aria-pressed={active === index}
            onClick={() => selectStep(index)}
          >
            <span />
          </button>
        ))}
      </div>
    </div>
  );
}
