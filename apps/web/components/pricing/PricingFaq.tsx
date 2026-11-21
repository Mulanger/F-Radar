'use client';

import { useId, useState } from 'react';
import { FAQ, SALES_CONTACT_HREF } from '@/lib/pricing/plans';
import css from './pricing.module.css';

/** Accordion with one answer open at a time (the first one initially). Closed answers stay in the HTML. */
export function PricingFaq() {
  const [open, setOpen] = useState(0);
  const id = useId();
  return (
    <section className={`${css.section} ${css.faqSection}`} aria-labelledby={`${id}-title`}>
      <div className={css.faqIntro}>
        <span className={css.eyebrow}>Frågor &amp; svar</span>
        <h2 id={`${id}-title`} className={css.h2}>Vanliga frågor</h2>
        <p>Hittar du inte svaret? Hör av dig så hjälper vi er att välja rätt nivå.</p>
        <a href={SALES_CONTACT_HREF} className={`${css.btnSecondary} ${css.faqContact}`}>Kontakta oss</a>
      </div>
      <div className={css.faqList}>
        {FAQ.map((item, i) => {
          const expanded = open === i;
          return (
            <div key={item.q} className={css.faqItem}>
              <h3>
                <button
                  type="button"
                  className={css.faqButton}
                  aria-expanded={expanded}
                  aria-controls={`${id}-a${i}`}
                  onClick={() => setOpen(expanded ? -1 : i)}
                >
                  <span className={css.faqQuestion}>{item.q}</span>
                  <span className={css.plus} aria-hidden="true" />
                </button>
              </h3>
              <p id={`${id}-a${i}`} className={css.faqAnswer} hidden={!expanded}>{item.a}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
