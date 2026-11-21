'use client';

import { useState } from 'react';
import {
  COMPARE_COLUMNS, COMPARISON, ENTERPRISE_FROM_SEK, FEATURED_COLUMN, formatSek, monthlyPriceSek,
  type BillingInterval, type CompareCell,
} from '@/lib/pricing/plans';
import { CheckIcon, ChevronIcon } from './icons';
import css from './pricing.module.css';

const featured = (i: number) => (i === FEATURED_COLUMN ? css.featuredCol : undefined);

function columnPrice(column: number, interval: BillingInterval): string {
  if (column === 0) return `${formatSek(0)}/mån`;
  if (column === 4) return `Från ${formatSek(ENTERPRISE_FROM_SEK)}`;
  const plan = (['start', 'pro', 'business'] as const)[column - 1]!;
  return `${formatSek(monthlyPriceSek(plan, interval))}/mån`;
}

function Cell({ value, column }: { value: CompareCell; column: number }) {
  const isFeatured = column === FEATURED_COLUMN;
  let content: React.ReactNode;
  if (value === true) content = <><CheckIcon size={18} strokeWidth={isFeatured ? 1.8 : 1.6} /><span className="fr-sr-only">Ingår</span></>;
  else if (value === false) content = <><span className={css.dash} aria-hidden="true">—</span><span className="fr-sr-only">Ingår inte</span></>;
  else content = value;
  return <td className={[css.cell, featured(column)].filter(Boolean).join(' ')}>{content}</td>;
}

/**
 * Feature matrix. Desktop: the plan header sticks below the site navigation. Phones: the table scrolls
 * sideways with the feature column pinned. Each category can be collapsed.
 */
export function CompareTable({ interval }: { interval: BillingInterval }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <div className={css.compareCard}>
      <div className={css.compareScroll}>
        <table className={css.table}>
          <caption className="fr-sr-only">Jämförelse av vad som ingår i Gratis, Start, Pro, Business och Enterprise</caption>
          <colgroup>
            <col className={css.colLabel} />
            {COMPARE_COLUMNS.map((c) => <col key={c} />)}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Exkl. moms</th>
              {COMPARE_COLUMNS.map((name, i) => (
                <th key={name} scope="col" className={featured(i)}>
                  <span className={css.colName}>{name}{i === FEATURED_COLUMN && <span className={css.colDot} aria-hidden="true" />}</span>
                  <span className={css.colPrice}>{columnPrice(i, interval)}</span>
                </th>
              ))}
            </tr>
          </thead>
          {COMPARISON.map((cat) => {
            const open = !collapsed[cat.id];
            return (
              <tbody key={cat.id}>
                <tr className={css.catRow}>
                  <th scope="rowgroup">
                    <button type="button" className={css.catToggle} aria-expanded={open} onClick={() => setCollapsed((c) => ({ ...c, [cat.id]: open }))}>
                      {cat.title}
                      <ChevronIcon />
                    </button>
                  </th>
                  {COMPARE_COLUMNS.map((name, i) => <td key={name} className={featured(i)} />)}
                </tr>
                {open && cat.rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className={css.rowLabel}>{row.label}</th>
                    {row.cells.map((v, i) => <Cell key={i} value={v} column={i} />)}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
