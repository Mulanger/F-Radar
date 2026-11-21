import Link from 'next/link';
import type { ReactNode } from 'react';
import { LEGAL_COMPANY, LEGAL_PLACEHOLDERS, type LegalField } from '@/lib/legal/company';
import css from './legal.module.css';

/** A company detail, or its placeholder ("[ORG_NR]") until it is filled in in lib/legal/company.ts. */
export function Ph({ field }: { field: LegalField }) {
  const value = LEGAL_COMPANY[field];
  return value ? <>{value}</> : <span className={css.placeholder} title="Uppgift saknas – fylls i före lansering">{LEGAL_PLACEHOLDERS[field]}</span>;
}

/** An e-mail address as a mailto link (or its placeholder). */
export function Email({ field }: { field: 'supportEmail' | 'legalEmail' | 'billingEmail' }) {
  const value = LEGAL_COMPANY[field];
  return value ? <a href={`mailto:${value}`}>{value}</a> : <Ph field={field} />;
}

/** A link to one of our pages, written out as "domän/sökväg" like in a printed contract. */
export function SiteLink({ domain, path }: { domain: string; path: string }) {
  return <Link href={path}>{domain}{path}</Link>;
}

export function Clause({ no, children }: { no: string; children: ReactNode }) {
  return (
    <p className={css.clause}>
      <span className={css.clauseNo}>{no}</span>
      <span>{children}</span>
    </p>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className={css.code}>{children}</code>;
}

export function LegalTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: ReactNode[][] }) {
  return (
    <div className={css.tableWrap}>
      <table className={css.table}>
        <caption className="fr-sr-only">{caption}</caption>
        <thead>
          <tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((cell, j) => <td key={j} data-label={columns[j]}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

/** "2026-11-21" → "21 november 2026" (no Intl, so server and client agree). */
export function formatLegalDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}
