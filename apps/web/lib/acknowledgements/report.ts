/**
 * The acknowledgement report itself (docs/plans/skalning.md, Fas 2 / S-08): document, PDF and CSV.
 * Kept apart from `pdf.ts`, which starts the Web Worker: the worker imports THIS module, and a worker
 * that imported the module creating it made the production build loop (Turbopack followed the
 * worker entry again inside the worker).
 */
import type { Content, ContentTable, TDocumentDefinitions } from 'pdfmake/interfaces';
import { ACKNOWLEDGEMENT_EXPORT_MAX, groupAcknowledgements, type AcknowledgementEventGroup, type AcknowledgementHistoryEntry } from '@fastighetsradar/domain';
import { legalDomain } from '@/lib/legal/company';
import { pdfLegalFooter } from '@/lib/legal/copy';
import { acknowledgementTime, importedText, severityLabel } from './presentation';

export type AcknowledgementReportFormat = 'compact' | 'full';

/** "18 nov. 2026 09:04" – or the span when the properties were acknowledged at different times. */
function ackTimes(entries: AcknowledgementHistoryEntry[]): string {
  const times = entries.map((e) => e.acknowledgedAt).sort();
  const first = acknowledgementTime(times[0]!);
  const last = acknowledgementTime(times.at(-1)!);
  return first === last ? first : `${first} – ${last}`;
}

function groupStatus(entries: AcknowledgementHistoryEntry[]): string {
  const undone = entries.filter((e) => e.undoneAt).length;
  if (!undone) return 'Kvitterad';
  return undone === entries.length ? 'Ångrad' : `${undone} ångrade`;
}

/** One row per EVENT (docs/plans/skalning.md, Fas 2 / S-08): "300 fastigheter", not 300 rows. */
function compactEntries(groups: AcknowledgementEventGroup[]): ContentTable {
  return {
    layout: 'lightHorizontalLines',
    fontSize: 9,
    margin: [0, 12, 0, 0],
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: ['*', 105, 98, 57],
      body: [
        ['Händelse', 'Fastighet', 'Kvitterad tid', 'Status'].map((text) => ({ text, bold: true })),
        ...groups.map((g) => [
          g.title,
          g.entries.length === 1 ? g.entries[0]!.propertyName : `${g.entries.length} fastigheter`,
          ackTimes(g.entries),
          groupStatus(g.entries),
        ]),
      ],
    },
  };
}

/** Each event once with its text; an event over several properties lists them in a short table. */
function fullEntries(groups: AcknowledgementEventGroup[]): Content[] {
  const content: Content[] = [];
  for (const g of groups) {
    const one = g.entries.length === 1 ? g.entries[0]! : null;
    content.push({ text: g.title, style: 'entryHeading', headlineLevel: 1 });
    if (one) content.push({ text: [one.propertyName, one.propertyAddress].filter(Boolean).join(' · '), bold: true });
    content.push(
      { text: `${g.source} · ${severityLabel(g.severity)}${g.area ? ` · ${g.area}` : ''}`, style: 'secondary' },
      { text: `Händelsetid ${acknowledgementTime(g.eventAt)}`, style: 'secondary' },
    );
    if (one) {
      content.push({ text: `Kvitterad ${acknowledgementTime(one.acknowledgedAt)}`, style: 'action' });
      if (one.undoneAt) content.push({ text: `Ångrad ${acknowledgementTime(one.undoneAt)}`, style: 'action', color: '#795019' });
      if (one.imported) content.push({ text: importedText, style: 'secondary', italics: true });
    } else {
      content.push({ text: `Kvitterad för ${g.entries.length} fastigheter · ${ackTimes(g.entries)}`, style: 'action' });
    }
    if (g.description) content.push({ text: g.description, margin: [0, 5, 0, 0] });
    if (!one) {
      content.push({
        layout: 'lightHorizontalLines',
        fontSize: 8.5,
        margin: [0, 8, 0, 0],
        table: {
          headerRows: 1,
          widths: [120, '*', 92, 92],
          body: [
            ['Fastighet', 'Adress', 'Kvitterad', 'Ångrad'].map((text) => ({ text, bold: true })),
            ...g.entries.map((e) => [e.propertyName, e.propertyAddress, acknowledgementTime(e.acknowledgedAt), e.undoneAt ? acknowledgementTime(e.undoneAt) : '']),
          ],
        },
      });
    }
  }
  return content;
}

export function acknowledgementReport(
  entries: AcknowledgementHistoryEntry[],
  organizationName: string,
  selection: string,
  demo: boolean,
  exportedAt: string,
  format: AcknowledgementReportFormat,
  /** Host shown in the legal footer ("… Se <domän>/villkor."). */
  domain = legalDomain(),
  /** More entries matched than the export includes (ACKNOWLEDGEMENT_EXPORT_MAX). */
  truncated = false,
): TDocumentDefinitions {
  const compact = format === 'compact';
  const formatLabel = compact ? 'Kort lista' : 'Fullständig rapport';
  const groups = groupAcknowledgements(entries);
  const counts = `${entries.length === 1 ? '1 kvittering' : `${entries.length} kvitteringar`}${groups.length !== entries.length ? ` · ${groups.length} händelser` : ''}`;
  const limit: Content[] = truncated
    ? [{ text: `Urvalet har fler än ${ACKNOWLEDGEMENT_EXPORT_MAX} kvitteringar; rapporten tar med de ${ACKNOWLEDGEMENT_EXPORT_MAX} senaste. Välj ett kortare datumintervall för resten.`, color: '#795019', margin: [0, 6, 0, 0] }]
    : [];
  return {
    info: { title: `Kvitteringar - ${formatLabel}`, author: 'FastighetsRadar' },
    pageSize: 'A4',
    pageMargins: [42, 44, 42, 58],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#1A231F', lineHeight: 1.22 },
    footer: (page, total) => ({
      columns: [
        { text: `${demo ? 'Demodata · ' : ''}${pdfLegalFooter(domain)}`, width: '*' },
        { text: `Sida ${page} av ${total}`, alignment: 'right', width: 'auto' },
      ],
      columnGap: 16, margin: [42, 14, 42, 0], fontSize: 8, color: '#54645B',
    }),
    content: [
      { text: 'Kvitteringar', fontSize: 28, bold: true, margin: [0, 0, 0, 5] },
      { text: [organizationName, formatLabel, demo && 'Demodata'].filter(Boolean).join(' · '), bold: true },
      { text: `${selection}\n${counts} · Exporterad ${acknowledgementTime(exportedAt)} (svensk tid)`, style: 'secondary' },
      ...limit,
      ...(compact ? [compactEntries(groups)] : fullEntries(groups)),
    ],
    styles: {
      entryHeading: { fontSize: 13, bold: true, margin: [0, 17, 0, 4] },
      secondary: { color: '#54645B', margin: [0, 2, 0, 0] },
      action: { bold: true, margin: [0, 2, 0, 0] },
    },
    pageBreakBefore: (node, container) => node.headlineLevel === 1 && container.getFollowingNodesOnPage().length === 0,
  };
}

/** The PDF as a Blob, built on the calling thread (the worker and the fallback both use it). */
export async function buildAcknowledgementPdf(doc: TDocumentDefinitions): Promise<Blob> {
  const [pdf, fonts] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
  const pdfMake = pdf.default ?? pdf;
  pdfMake.addVirtualFileSystem(fonts.default ?? fonts);
  return pdfMake.createPdf(doc).getBlob();
}

export interface AcknowledgementPdfJob {
  entries: AcknowledgementHistoryEntry[];
  organizationName: string;
  selection: string;
  demo: boolean;
  exportedAt: string;
  format: AcknowledgementReportFormat;
  domain: string;
  truncated: boolean;
}

export const pdfFromJob = (job: AcknowledgementPdfJob) => buildAcknowledgementPdf(
  acknowledgementReport(job.entries, job.organizationName, job.selection, job.demo, job.exportedAt, job.format, job.domain, job.truncated),
);

const csvCell = (v: string | null | undefined) => `"${(v ?? '').replace(/"/g, '""')}"`;

/**
 * One row per acknowledged property, for a spreadsheet (Fas 2 / S-08). Semicolons and a BOM so Excel
 * with Swedish settings opens it with å, ä and ö intact. No person is named, as in the PDF.
 */
export function acknowledgementCsv(entries: AcknowledgementHistoryEntry[]): string {
  const head = ['Händelse', 'Källa', 'Allvarlighetsgrad', 'Område', 'Händelsetid', 'Fastighet', 'Adress', 'Kvitterad', 'Ångrad', 'Uppdatering', 'Importerad'];
  const rows = entries.map((e) => [
    e.title, e.source, severityLabel(e.severity), e.area, acknowledgementTime(e.eventAt), e.propertyName, e.propertyAddress,
    acknowledgementTime(e.acknowledgedAt), e.undoneAt ? acknowledgementTime(e.undoneAt) : '', e.isUpdate ? 'Ja' : 'Nej', e.imported ? 'Ja' : 'Nej',
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
