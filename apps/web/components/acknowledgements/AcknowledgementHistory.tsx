'use client';

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import type { AcknowledgementExport, AcknowledgementHistoryEntry, AcknowledgementHistoryFilters, AcknowledgementHistoryPage } from '@fastighetsradar/domain';
import { readView, useSavedView, useViewScroll, writeView } from '@/lib/navigation/view-state';
import { useDashboard } from '@/lib/state/dashboard-state';
import { acknowledgementTime, importedText, severityLabel } from '@/lib/acknowledgements/presentation';
import type { AcknowledgementReportFormat } from '@/lib/acknowledgements/pdf';
import { demoAcknowledgementExport, demoAcknowledgementPage } from '@/lib/demo/acknowledgements';
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

/** The whole selection for the report in one request (docs/plans/skalning.md, Fas 2 / S-08). */
async function loadExport(filters: Filters, demoEntries?: AcknowledgementHistoryEntry[]): Promise<AcknowledgementExport> {
  if (demoEntries) return demoAcknowledgementExport(demoEntries, filters);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const response = await fetch(`/api/app/feed/acknowledgements/export?${params}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Export request failed');
  return await response.json() as AcknowledgementExport;
}

export function AcknowledgementHistory({ demoEntries, onDemoUndo, back }: {
  back?: React.ReactNode;
  demoEntries?: AcknowledgementHistoryEntry[];
  onDemoUndo?: (id: string, undoneAt: string) => void;
}) {
  const { basePath, portfolio, refresh } = useDashboard();
  const viewKey = `${basePath}:${portfolio.organizationId}:acknowledgements`;
  const pagesKey = `${viewKey}:pages`;
  const [draft, setDraft] = useSavedView(`${viewKey}:draft`, emptyFilters);
  const [applied, setApplied, restored] = useSavedView(`${viewKey}:filters`, emptyFilters);
  const [history, setHistory] = useState<AcknowledgementHistoryPage | null>(() => demoEntries ? demoAcknowledgementPage(demoEntries, emptyFilters) : null);
  const [loading, setLoading] = useState(!demoEntries);
  const [downloading, setDownloading] = useState<false | 'pdf' | 'csv'>(false);
  const [propertySearch, setPropertySearch] = useState('');
  const [undoing, setUndoing] = useState<string | null>(null);
  const [pdfFormat, setPdfFormat] = useState<AcknowledgementReportFormat>('compact');
  const [error, setError] = useState('');

  useViewScroll(`${viewKey}:scroll`, restored && !loading && history !== null);

  useEffect(() => {
    if (!restored) return;
    const controller = new AbortController();
    async function restoreHistory() {
      let result = await loadHistory(applied, demoEntries, undefined, controller.signal);
      const savedPages = readView(pagesKey, 1);
      for (let page = 1; page < savedPages && result.nextCursor && !controller.signal.aborted; page++) {
        const next = await loadHistory(applied, demoEntries, result.nextCursor, controller.signal);
        result = { ...result, entries: [...result.entries, ...next.entries], nextCursor: next.nextCursor };
      }
      return result;
    }
    restoreHistory().then((result) => {
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
  }, [applied, demoEntries, pagesKey, restored]);

  function apply(filters: Filters) {
    setError('');
    setLoading(true);
    writeView(pagesKey, 1);
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
      writeView(pagesKey, readView(pagesKey, 1) + 1);
    } catch {
      setError('Fler kvitteringar kunde inte hämtas. Försök igen.');
    } finally {
      setLoading(false);
    }
  }

  async function download(kind: 'pdf' | 'csv') {
    if (!history?.entries.length) return;
    setDownloading(kind);
    setError('');
    try {
      const { entries, truncated } = await loadExport(applied, demoEntries);
      if (kind === 'csv') {
        const { downloadAcknowledgementCsv } = await import('@/lib/acknowledgements/pdf');
        downloadAcknowledgementCsv(entries);
        return;
      }
      const property = history.properties.find(({ id }) => id === applied.property);
      const period = [applied.from && `Från ${applied.from}`, applied.to && `Till ${applied.to}`].filter(Boolean).join(' · ') || 'Alla datum';
      const selection = `${period} · ${property?.name ?? 'Alla fastigheter'}`;
      const { downloadAcknowledgementReport } = await import('@/lib/acknowledgements/pdf');
      if (truncated) await downloadAcknowledgementReport(entries, portfolio.organizationName, selection, !!demoEntries, pdfFormat, true);
      else await downloadAcknowledgementReport(entries, portfolio.organizationName, selection, !!demoEntries, pdfFormat);
    } catch {
      setError(kind === 'csv' ? 'CSV-filen kunde inte laddas ner. Försök igen.' : 'PDF-filen kunde inte laddas ner. Försök igen.');
    } finally {
      setDownloading(false);
    }
  }

  async function undo(entry: AcknowledgementHistoryEntry) {
    if (busy || entry.undoneAt) return;
    setUndoing(entry.id);
    setError('');
    try {
      let undoneAt: string;
      if (demoEntries) {
        if (!onDemoUndo) return;
        undoneAt = new Date().toISOString();
        onDemoUndo(entry.id, undoneAt);
      } else {
        const response = await fetch(`/api/app/feed/acknowledgements/${encodeURIComponent(entry.id)}/undo`, { method: 'POST' });
        if (!response.ok) throw new Error('Undo request failed');
        ({ undoneAt } = await response.json() as { undoneAt: string });
      }
      setHistory((page) => page && { ...page, entries: page.entries.map((item) => item.id === entry.id ? { ...item, undoneAt } : item) });
      if (!demoEntries) refresh();
    } catch {
      setError('Kvitteringen kunde inte ångras. Försök igen.');
    } finally {
      setUndoing(null);
    }
  }

  const entries = history?.entries ?? [];
  const properties = useMemo(() => history?.properties ?? [], [history?.properties]);
  // A searchable property filter (S-08): with hundreds of properties the list is filtered as you type.
  const shownProperties = useMemo(() => {
    const words = propertySearch.toLocaleLowerCase('sv').split(/\s+/).filter(Boolean);
    return words.length
      ? properties.filter((p) => p.id === draft.property || words.every((w) => `${p.name} ${p.address}`.toLocaleLowerCase('sv').includes(w)))
      : properties;
  }, [properties, propertySearch, draft.property]);
  const busy = loading || downloading !== false || undoing !== null;
  const filtered = !!(applied.from || applied.to || applied.property);
  const count = history?.nextCursor ? `${entries.length} visade` : entries.length === 1 ? '1 kvittering' : `${entries.length} kvitteringar`;

  return (
    <section className={styles.page} aria-labelledby="acknowledgement-title">
      {back}
      <header className={styles.heading}>
        <div>
          <h1 id="acknowledgement-title">Kvitteringar</h1>
          <p>Organisationens historik över kvitterade larm och händelser.</p>
        </div>
        <div className={styles.exportControls}>
          <label className={styles.exportFormat}>
            <span className="fr-sr-only">PDF-format</span>
            <select value={pdfFormat} disabled={busy} onChange={(event) => setPdfFormat(event.currentTarget.value === 'full' ? 'full' : 'compact')}>
              <option value="compact">Kort lista</option>
              <option value="full">Fullständig rapport</option>
            </select>
          </label>
          <button type="button" className={styles.primary} disabled={busy || !entries.length} onClick={() => void download('pdf')}>
            <IconDownload />{downloading === 'pdf' ? 'Skapar PDF…' : 'Ladda ner PDF'}
          </button>
          <button type="button" className={styles.secondary} disabled={busy || !entries.length} onClick={() => void download('csv')}>
            {downloading === 'csv' ? 'Skapar CSV…' : 'Ladda ner CSV'}
          </button>
        </div>
      </header>

      <form className={styles.filters} onSubmit={handleSubmit}>
        <label>Från datum<input name="from" type="date" value={draft.from} max={draft.to || undefined} onInput={(e) => setDraft({ ...draft, from: e.currentTarget.value })} /></label>
        <label>Till datum<input name="to" type="date" value={draft.to} min={draft.from || undefined} onInput={(e) => setDraft({ ...draft, to: e.currentTarget.value })} /></label>
        <div className={styles.propertyFilter}>
          <label>Fastighet
            <select name="property" value={draft.property} onChange={(e) => setDraft({ ...draft, property: e.target.value })}>
              <option value="">Alla fastigheter</option>
              {shownProperties.map((property) => <option key={property.id} value={property.id}>{property.name} · {property.address}</option>)}
            </select>
          </label>
          {properties.length > 10 && (
            <input type="search" className={styles.propertySearch} value={propertySearch} placeholder={`Sök bland ${properties.length} fastigheter`}
              aria-label="Sök fastighet i filtret" onChange={(e) => setPropertySearch(e.target.value)} />
          )}
        </div>
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
            {entries.map((entry) => <HistoryRow key={entry.id} entry={entry}
              onUndo={!entry.undoneAt && (!demoEntries || onDemoUndo) ? () => void undo(entry) : undefined}
              disabled={busy} undoing={undoing === entry.id} />)}
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

function HistoryRow({ entry, onUndo, disabled, undoing }: {
  entry: AcknowledgementHistoryEntry;
  onUndo?: () => void;
  disabled: boolean;
  undoing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <div className={styles.record} data-open={open}>
      <div className={styles.recordHeader}>
        <button type="button" className={styles.recordSummary} aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((value) => !value)}>
          <span className={styles.recordTitle}><strong>{entry.title}</strong><span>{entry.source}{entry.isUpdate && ' · Uppdaterad'}</span></span>
          <span className={styles.recordProperty}>{entry.propertyName}</span>
          <time className={styles.recordTime} dateTime={entry.acknowledgedAt}>{acknowledgementTime(entry.acknowledgedAt)}</time>
          <span className={styles.recordStatus}>
            <span className={entry.undoneAt ? styles.reversed : styles.confirmed}>{entry.undoneAt ? 'Ångrad' : 'Kvitterad'}</span>
            <IconChevronDown />
          </span>
        </button>
        {onUndo && <button type="button" className={`${styles.textButton} ${styles.recordUndo}`} disabled={disabled}
          aria-label={`Ångra kvittering: ${entry.title} · ${entry.propertyName}`} onClick={onUndo}>
          {undoing ? 'Ångrar…' : 'Ångra'}
        </button>}
      </div>
      <div id={detailsId} className={styles.details} hidden={!open}>
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
    </div>
  );
}
