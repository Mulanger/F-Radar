'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { AcknowledgementHistoryEntry, AcknowledgementHistoryFilters, AcknowledgementHistoryPage } from '@fastighetsradar/domain';
import { useDashboard } from '@/lib/state/dashboard-state';
import { acknowledgementTime, importedText, severityLabel } from '@/lib/acknowledgements/presentation';
import { demoAcknowledgementPage } from '@/lib/demo/acknowledgements';
import { IconAcknowledgements, IconChevronDown, IconDownload } from '../ui/icons';
import styles from './AcknowledgementHistory.module.css';

type Filters = Required<Pick<AcknowledgementHistoryFilters, 'from' | 'to' | 'property'>>;
const emptyFilters: Filters = { from: '', to: '', property: '' };

async function loadHistory(filters: Filters, demoEntries?: AcknowledgementHistoryEntry[], cursor?: string, signal?: AbortSignal) {
  if (demoEntries) return demoAcknowledgementPage(demoEntries, { ...filters, cursor });
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, cursor })) {
    if (value) params.set(key, value);
  }
  const response = await fetch(`/api/app/feed/acknowledgements?${params}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('History request failed');
  return await response.json() as AcknowledgementHistoryPage;
}

export function AcknowledgementHistory({ demoEntries }: { demoEntries?: AcknowledgementHistoryEntry[] }) {
  const { portfolio } = useDashboard();
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [history, setHistory] = useState<AcknowledgementHistoryPage | null>(() => demoEntries ? demoAcknowledgementPage(demoEntries, emptyFilters) : null);
  const [loading, setLoading] = useState(!demoEntries);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    loadHistory(applied, demoEntries, undefined, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setHistory(result);
        setLoading(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setHistory(null);
        setError('Kvitteringarna kunde inte hämtas. Försök igen.');
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [applied, demoEntries]);

  function apply(filters: Filters) {
    setError('');
    setLoading(true);
    setApplied({ ...filters });
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    apply({ from: String(fields.get('from') ?? ''), to: String(fields.get('to') ?? ''), property: String(fields.get('property') ?? '') });
  }

  async function loadMore() {
    if (!history?.nextCursor) return;
    setError('');
    setLoading(true);
    try {
      const page = await loadHistory(applied, demoEntries, history.nextCursor);
      setHistory({ ...history, entries: [...history.entries, ...page.entries], nextCursor: page.nextCursor });
    } catch {
      setError('Fler kvitteringar kunde inte hämtas. Försök igen.');
    } finally {
      setLoading(false);
    }
  }

  async function download() {
    if (!history?.entries.length) return;
    setDownloading(true);
    setError('');
    try {
      const entries = [...history.entries];
      let cursor = history.nextCursor;
      while (cursor) {
        const page = await loadHistory(applied, demoEntries, cursor);
        entries.push(...page.entries);
        cursor = page.nextCursor;
      }
      const property = history.properties.find(({ id }) => id === applied.property);
      const period = [applied.from && `Från ${applied.from}`, applied.to && `Till ${applied.to}`].filter(Boolean).join(' · ') || 'Alla datum';
      const selection = `${period} · ${property?.name ?? 'Alla fastigheter'}`;
      const { downloadAcknowledgementReport } = await import('@/lib/acknowledgements/pdf');
      await downloadAcknowledgementReport(entries, portfolio.organizationName, selection, !!demoEntries);
    } catch {
      setError('PDF-filen kunde inte laddas ner. Försök igen.');
    } finally {
      setDownloading(false);
    }
  }

  const entries = history?.entries ?? [];
  const properties = history?.properties ?? [];
  const busy = loading || downloading;
  const filtered = !!(applied.from || applied.to || applied.property);
  const count = history?.nextCursor ? `${entries.length} visade` : entries.length === 1 ? '1 kvittering' : `${entries.length} kvitteringar`;

  return (
    <section className={styles.page} aria-labelledby="acknowledgement-title">
      <header className={styles.heading}>
        <div>
          <h1 id="acknowledgement-title">Kvitteringar</h1>
          <p>Organisationens historik över kvitterade larm och händelser.</p>
        </div>
        <button type="button" className={styles.primary} disabled={busy || !entries.length} onClick={() => void download()}>
          <IconDownload />{downloading ? 'Skapar PDF…' : 'Ladda ner PDF'}
        </button>
      </header>

      <form className={styles.filters} onSubmit={handleSubmit}>
        <label>Från datum<input name="from" type="date" value={draft.from} max={draft.to || undefined} onInput={(e) => setDraft({ ...draft, from: e.currentTarget.value })} /></label>
        <label>Till datum<input name="to" type="date" value={draft.to} min={draft.from || undefined} onInput={(e) => setDraft({ ...draft, to: e.currentTarget.value })} /></label>
        <label className={styles.propertyFilter}>Fastighet
          <select name="property" value={draft.property} onChange={(e) => setDraft({ ...draft, property: e.target.value })}>
            <option value="">Alla fastigheter</option>
            {properties.map((property) => <option key={property.id} value={property.id}>{property.name} · {property.address}</option>)}
          </select>
        </label>
        <div className={styles.filterActions}>
          <button className={styles.secondary} disabled={busy}>Filtrera</button>
          {(filtered || draft.from || draft.to || draft.property) && <button type="button" className={styles.textButton} disabled={busy} onClick={() => { setDraft(emptyFilters); apply(emptyFilters); }}>Rensa</button>}
        </div>
      </form>

      <div className={styles.results} aria-busy={loading}>
        <div className={styles.resultsHeading}>
          <h2>Historik</h2>
          <span role="status">{loading ? 'Hämtar…' : history ? count : ''}</span>
        </div>
        {error && <p className={styles.error} role="alert">{error} {!history && <button className={styles.textButton} type="button" onClick={() => apply(applied)}>Försök igen</button>}</p>}
        {entries.length > 0 ? (
          <>
            <div className={styles.columnLabels} aria-hidden="true"><span>Händelse</span><span>Fastighet</span><span>Kvitterad</span><span>Status</span></div>
            {entries.map((entry) => <HistoryRow key={entry.id} entry={entry} />)}
          </>
        ) : !busy && history && (
          <div className={styles.empty}>
            <IconAcknowledgements size={24} />
            <strong>{filtered ? 'Inga träffar' : 'Inga kvitteringar ännu'}</strong>
            <p>{filtered ? 'Prova ett annat datumintervall eller en annan fastighet.' : 'När någon i organisationen kvitterar ett larm visas det här.'}</p>
          </div>
        )}
        {history?.nextCursor && (
          <div className={styles.more}><button type="button" className={styles.secondary} disabled={busy} onClick={() => void loadMore()}>Visa fler kvitteringar</button></div>
        )}
      </div>
    </section>
  );
}

function HistoryRow({ entry }: { entry: AcknowledgementHistoryEntry }) {
  return (
    <details className={styles.record}>
      <summary className={styles.recordSummary}>
        <span className={styles.recordTitle}><strong>{entry.title}</strong><span>{entry.source}</span></span>
        <span className={styles.recordProperty}>{entry.propertyName}</span>
        <time className={styles.recordTime} dateTime={entry.acknowledgedAt}>{acknowledgementTime(entry.acknowledgedAt)}</time>
        <span className={styles.recordStatus}>
          <span className={entry.undoneAt ? styles.reversed : styles.confirmed}>{entry.undoneAt ? 'Ångrad' : 'Kvitterad'}</span>
          <IconChevronDown />
        </span>
      </summary>
      <div className={styles.details}>
        <dl>
          <div><dt>Fastighet</dt><dd>{entry.propertyName} · {entry.propertyAddress}</dd></div>
          {entry.area && <div><dt>Område</dt><dd>{entry.area}</dd></div>}
          <div><dt>Händelsetid</dt><dd><time dateTime={entry.eventAt}>{acknowledgementTime(entry.eventAt)}</time></dd></div>
          <div><dt>Allvarlighetsgrad</dt><dd>{severityLabel(entry.severity)}</dd></div>
          {entry.undoneAt && <div><dt>Ångrad</dt><dd><time dateTime={entry.undoneAt}>{acknowledgementTime(entry.undoneAt)}</time></dd></div>}
        </dl>
        {entry.imported && <p className={styles.imported}>{importedText}</p>}
        <h3>Händelsetext</h3>
        <p className={styles.description}>{entry.description || 'Källan lämnade ingen ytterligare beskrivning.'}</p>
      </div>
    </details>
  );
}
