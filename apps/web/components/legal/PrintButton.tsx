'use client';

import css from './legal.module.css';

/** "Skriv ut / Spara som PDF" – the browser's print dialog (the page has print styles). */
export function PrintButton() {
  return (
    <button type="button" className={`${css.pill} ${css.noPrint}`} onClick={() => window.print()}>
      Skriv ut / Spara som PDF
    </button>
  );
}
