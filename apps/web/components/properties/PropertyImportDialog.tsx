'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PositionReviewItem, PropertyImportResult } from '@fastighetsradar/domain';
import {
  buildPreview,
  COLUMN_ROLE_LABELS,
  detectColumns,
  ImportParseError,
  importRows,
  parseImportText,
  type ColumnRole,
  type ImportTable,
  type PreviewRow,
} from '@/lib/import/parse';
import { runImport, type ImportRunProgress, type SubmitBatch } from '@/lib/import/run';
import styles from './PropertyImport.module.css';

/** Rows drawn in the table at once; the tabs narrow the list down. */
const VISIBLE_ROWS = 200;
/** Address searches per second in the API (IMPORT_GEOCODE_PER_SECOND), for the time hint. */
const SEARCHES_PER_SECOND = 4;
const PRECISION_SV: Record<string, string> = { building: 'byggnad', street: 'gata', approximate: 'ungefärlig', unknown: 'okänd' };
const EXAMPLE = 'Namn\tAdress\tPostnummer\tOrt\nKontoret\tSveavägen 42\t111 34\tStockholm\nLagret\tTorshamnsgatan 2\t164 40\tKista';

type Tone = 'ok' | 'warn' | 'bad' | 'muted';
type Category = 'ready' | 'noTown' | 'created' | 'review' | 'skipped' | 'failed' | 'waiting';

interface RowView {
  row: number;
  name: string;
  address: string;
  group?: string;
  label: string;
  tone: Tone;
  detail: string;
  categories: Category[];
}

function view(p: PreviewRow, r: PropertyImportResult | undefined): RowView {
  const base = { row: p.row, name: p.name, address: p.address, group: p.group };
  const position = p.location ? `Koordinater ${p.location.lat.toFixed(5)}, ${p.location.lon.toFixed(5)}` : '';
  if (p.status === 'invalid') return { ...base, label: 'Fel', tone: 'bad', detail: p.message ?? '', categories: ['failed'] };
  if (p.status === 'duplicate_file') return { ...base, label: 'Dubblett', tone: 'muted', detail: p.message ?? '', categories: ['skipped'] };
  if (p.status === 'exists') return { ...base, label: 'Finns redan', tone: 'muted', detail: p.message ?? '', categories: ['skipped'] };
  if (!r) return { ...base, label: 'Klar', tone: p.warning ? 'warn' : 'ok', detail: p.warning ?? (position || 'Adressen söks'), categories: p.warning ? ['ready', 'noTown', 'waiting'] : ['ready', 'waiting'] };
  const found = r.match ? `${r.match.label ?? ''} · ${PRECISION_SV[r.match.precision] ?? r.match.precision}` : position;
  // The organization already has as many groups as it may: the property is there, its group is not.
  const hit = r.groupNotSet ? `${found ? `${found} · ` : ''}utan grupp (gränsen för antal grupper är nådd)` : found;
  switch (r.status) {
    case 'created':
      return r.needsReview
        ? { ...base, label: 'Kontrollera position', tone: 'warn', detail: hit, categories: ['created', 'review'] }
        : { ...base, label: 'Skapad', tone: 'ok', detail: hit, categories: ['created'] };
    case 'duplicate':
      return { ...base, label: 'Fanns redan', tone: 'muted', detail: r.match?.label ?? 'Samma adress finns redan', categories: ['skipped'] };
    case 'not_found':
      return { ...base, label: 'Hittades inte', tone: 'bad', detail: 'Kontrollera stavning och ort, eller ange koordinater', categories: ['failed'] };
    case 'limit_reached':
      return { ...base, label: 'Gränsen nådd', tone: 'bad', detail: 'Organisationens gräns för antal fastigheter är nådd', categories: ['failed'] };
    case 'geocoding_unavailable':
      return { ...base, label: 'Ej sökt', tone: 'bad', detail: 'Adressökningen är inte tillgänglig – ange koordinater eller försök senare', categories: ['failed'] };
    default:
      return { ...base, label: 'Väntar', tone: 'muted', detail: 'Skickas igen', categories: ['waiting'] };
  }
}

const TABS_BEFORE: Array<{ id: Category | 'all'; label: string }> = [
  { id: 'all', label: 'Alla' },
  { id: 'ready', label: 'Klara' },
  { id: 'noTown', label: 'Utan ort' },
  { id: 'skipped', label: 'Finns redan' },
  { id: 'failed', label: 'Med fel' },
];
const TABS_AFTER: Array<{ id: Category | 'all'; label: string }> = [
  { id: 'all', label: 'Alla' },
  { id: 'created', label: 'Skapade' },
  { id: 'review', label: 'Kontrollera position' },
  { id: 'skipped', label: 'Fanns redan' },
  { id: 'failed', label: 'Ej importerade' },
  { id: 'waiting', label: 'Väntar' },
];

/** Reads a file as UTF-8, or as Windows-1252 when it is not (Excel's plain "CSV" on Swedish Windows). */
async function readText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 90) return 'någon minut';
  return `cirka ${Math.round(seconds / 60)} minuter`;
}

/**
 * Bulk import (docs/plans/skalning.md, Fas 6 / S-28): paste rows from Excel or pick a CSV file, check
 * the preview, import. The rows go to the API in batches with a status per row; uncertain positions
 * end up on the review list on the property page. No SMS rule is switched on for imported properties.
 */
export function PropertyImportDialog({
  submit,
  existingAddresses,
  demo,
  onClose,
}: {
  submit: SubmitBatch;
  /** Addresses (and search labels) the organization already has. */
  existingAddresses: string[];
  demo: boolean;
  /** How many properties the import created, and those whose position needs checking. */
  onClose: (outcome: { created: number; review: PositionReviewItem[] }) => void;
}) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [roleOverride, setRoleOverride] = useState<{ table: ImportTable; roles: ColumnRole[] } | null>(null);
  const [tab, setTab] = useState<Category | 'all'>('all');
  const [progress, setProgress] = useState<ImportRunProgress | null>(null);
  const abort = useRef<AbortController | null>(null);
  const results = useRef(new Map<number, PropertyImportResult>());
  const fileInput = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const parsed = useMemo((): { table: ImportTable | null; error: string | null } => {
    if (!text.trim()) return { table: null, error: null };
    try {
      return { table: parseImportText(text), error: null };
    } catch (err) {
      return { table: null, error: err instanceof ImportParseError ? err.message : 'Raderna gick inte att läsa.' };
    }
  }, [text]);
  const table = parsed.table;
  const roles = useMemo(() => (table ? (roleOverride?.table === table ? roleOverride.roles : detectColumns(table)) : []), [table, roleOverride]);
  const preview = useMemo(() => (table ? buildPreview(table, roles, existingAddresses) : []), [table, roles, existingAddresses]);
  const withGroups = useMemo(() => preview.some((p) => p.group), [preview]);
  const rows = useMemo(() => importRows(preview), [preview]);
  const missingAddress = table !== null && !roles.includes('address');

  const running = progress?.state === 'running';
  const started = progress !== null;
  const views = useMemo(() => preview.map((p) => view(p, progress?.results.get(p.row))), [preview, progress]);
  const counts = useMemo(() => {
    const c: Record<Category | 'all', number> = { all: views.length, ready: 0, noTown: 0, created: 0, review: 0, skipped: 0, failed: 0, waiting: 0 };
    for (const v of views) for (const k of v.categories) c[k]++;
    return c;
  }, [views]);
  const tabs = (started ? TABS_AFTER : TABS_BEFORE).filter((t) => t.id === 'all' || counts[t.id] > 0);
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'all';
  const shown = activeTab === 'all' ? views : views.filter((v) => v.categories.includes(activeTab));
  const searches = rows.filter((r) => !r.location).length;

  useEffect(() => {
    textRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !abort.current && onClose({ created: 0, review: [] });
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => () => abort.current?.abort(), []);

  const pickFile = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    if (/\.(xlsx|xls|xlsm|numbers|ods)$/i.test(file.name)) {
      setFileError('Excel-filer läses inte direkt. Spara som CSV (Arkiv → Spara som → CSV UTF-8) eller markera raderna i Excel, kopiera och klistra in dem här.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFileError('Filen är större än 5 MB.');
      return;
    }
    setFileName(file.name);
    setRoleOverride(null);
    setText(await readText(file));
  };

  const start = useCallback(async () => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setTab('all');
    try {
      await runImport(rows, submit, { signal: ctrl.signal, results: results.current, onProgress: (p) => setProgress({ ...p }) });
    } finally {
      abort.current = null;
    }
  }, [rows, submit]);

  const close = () => {
    const review: PositionReviewItem[] = [];
    for (const p of preview) {
      const r = progress?.results.get(p.row);
      if (r?.status !== 'created' || !r.needsReview || !r.propertyId) continue;
      const precision = r.match?.precision === 'street' || r.match?.precision === 'approximate' ? r.match.precision : 'unknown';
      // The API's own review list carries the position; this one is only shown (demo mode).
      review.push({ id: r.propertyId, name: p.name, address: p.address, label: r.match?.label ?? null, precision, location: p.location ?? { lat: 0, lon: 0 } });
    }
    onClose({ created: counts.created, review });
  };
  const setRole = (column: number, role: ColumnRole) => {
    if (!table) return;
    const next = roles.map((r, i) => (i === column ? role : r === role && role !== 'ignore' ? 'ignore' : r));
    setRoleOverride({ table, roles: next });
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="property-import-title" onMouseDown={(e) => e.target === e.currentTarget && !running && close()}>
      <div className={styles.dialog}>
        <div className={styles.head}>
          <div>
            <h2 id="property-import-title" className={styles.title}>Importera fastigheter</h2>
            <p className={styles.lead}>
              Klistra in rader från Excel eller välj en CSV-fil. En rad per fastighet med namn och adress – gärna postnummer och ort – eller latitud och longitud.
            </p>
          </div>
          <button className={`${styles.button} ${styles.close}`} onClick={close} disabled={running} aria-label="Stäng">
            ✕
          </button>
        </div>

        {demo && <p className={styles.demo}>Demoläge: inga fastigheter sparas och inga adresser söks – utfallet per rad är simulerat.</p>}

        {!started && (
          <div className={styles.input}>
            <label htmlFor="import-text" className="fr-sr-only">Rader att importera</label>
            <textarea
              id="import-text"
              ref={textRef}
              value={text}
              onChange={(e) => {
                setFileName(null);
                setRoleOverride(null);
                setText(e.target.value);
              }}
              placeholder={EXAMPLE}
              spellCheck={false}
            />
            <div className={styles.fileRow}>
              <input ref={fileInput} id="import-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={(e) => void pickFile(e.target.files?.[0])} />
              <button type="button" className={`${styles.button} ${styles.small}`} onClick={() => fileInput.current?.click()}>Välj CSV-fil</button>
              {fileName ? <span>{fileName}</span> : <span>eller klistra in ovan. Första raden får vara rubriker (Namn, Adress, Postnummer, Ort, Latitud, Longitud, Grupp).</span>}
            </div>
          </div>
        )}

        {(fileError || parsed.error) && <p className={styles.error} role="alert">{fileError ?? parsed.error}</p>}

        {table && (
          <>
            {!started && (
              <div className={styles.mapping} role="group" aria-label="Kolumner">
                {roles.map((role, i) => (
                  <label key={i}>
                    {table.header?.[i] || `Kolumn ${i + 1}`}
                    <select value={role} onChange={(e) => setRole(i, e.target.value as ColumnRole)}>
                      {(Object.keys(COLUMN_ROLE_LABELS) as ColumnRole[]).map((r) => (
                        <option key={r} value={r}>{COLUMN_ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
            {missingAddress && <p className={styles.error} role="alert">Ange vilken kolumn som är adressen.</p>}

            {started ? (
              <div className={styles.progress} role="status" aria-live="polite">
                <div>
                  {progress.state === 'running' && `Importerar… ${progress.done} av ${progress.total}`}
                  {progress.state === 'done' && `Klart – ${counts.created} ${counts.created === 1 ? 'fastighet skapad' : 'fastigheter skapade'}.`}
                  {progress.state === 'done' && ` ${counts.review} väntar på positionskontroll.`}
                  {progress.state === 'stopped' && `Stoppad efter ${progress.done} av ${progress.total}.`}
                  {progress.state === 'paused' && progress.message}
                </div>
                <div className={styles.bar} aria-hidden="true"><div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }} /></div>
              </div>
            ) : (
              <div className={styles.summary} role="status">
                <span><b>{preview.length}</b> rader</span>
                <span><b>{rows.length}</b> klara att importera</span>
                {counts.skipped > 0 && <span><b>{counts.skipped}</b> finns redan eller är dubbletter</span>}
                {counts.failed > 0 && <span><b>{counts.failed}</b> med fel</span>}
                {counts.noTown > 0 && <span><b>{counts.noTown}</b> utan ort</span>}
              </div>
            )}

            <div className={styles.tabs} role="group" aria-label="Visa rader">
              {tabs.map((t) => (
                <button key={t.id} className={styles.tab} aria-pressed={activeTab === t.id} onClick={() => setTab(t.id)}>
                  {t.label}<span>{counts[t.id]}</span>
                </button>
              ))}
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Rad</th><th>Namn</th><th>Adress</th>{withGroups && <th>Grupp</th>}<th>Status</th><th>{started ? 'Träff' : 'Position'}</th></tr>
                </thead>
                <tbody>
                  {shown.slice(0, VISIBLE_ROWS).map((v) => (
                    <tr key={v.row}>
                      <td className={styles.num}>{v.row}</td>
                      <td>{v.name}</td>
                      <td>{v.address}</td>
                      {withGroups && <td>{v.group ?? ''}</td>}
                      <td><span className={`${styles.status} ${styles[v.tone]}`}>{v.label}</span></td>
                      <td className={styles.detail}>{v.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length > VISIBLE_ROWS && <div className={styles.more}>Visar {VISIBLE_ROWS} av {shown.length} rader.</div>}
            </div>
          </>
        )}

        <div className={styles.foot}>
          <p className={styles.footNote}>
            {!started && rows.length > 0 && (
              <>
                {searches > 0 && `${searches} adresser söks via Geoapify, ${formatDuration(searches / SEARCHES_PER_SECOND)}. Låt fönstret vara öppet. `}
                Inga SMS-regler slås på för de importerade fastigheterna. Avbryts importen kan du importera samma fil igen – redan inlagda adresser hoppas över.
              </>
            )}
            {started && counts.review > 0 && progress.state !== 'running' &&
              'På sidan Fastigheter, öppna ”Kontrollera position” och bekräfta varje nål på kartan.'}
          </p>
          <div className={styles.actions}>
            {!started && (
              <>
                <button className={styles.button} onClick={close}>Avbryt</button>
                <button className={styles.primary} onClick={() => void start()} disabled={!rows.length || missingAddress}>
                  Importera {rows.length} {rows.length === 1 ? 'fastighet' : 'fastigheter'}
                </button>
              </>
            )}
            {running && <button className={styles.button} onClick={() => abort.current?.abort()}>Stoppa</button>}
            {started && !running && progress.state !== 'done' && (
              <>
                <button className={styles.button} onClick={close}>Stäng</button>
                <button className={styles.primary} onClick={() => void start()}>Fortsätt</button>
              </>
            )}
            {progress?.state === 'done' && <button className={styles.primary} onClick={close}>Klar</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
