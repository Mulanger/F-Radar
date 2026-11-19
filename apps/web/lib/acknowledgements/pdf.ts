import type { Content, ContentTable, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { AcknowledgementHistoryEntry } from '@fastighetsradar/domain';
import { acknowledgementDay, acknowledgementTime, importedText, severityLabel } from './presentation';

export type AcknowledgementReportFormat = 'compact' | 'full';

function compactEntries(entries: AcknowledgementHistoryEntry[]): ContentTable {
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
        ...entries.map((entry) => [
          entry.title,
          entry.propertyName,
          acknowledgementTime(entry.acknowledgedAt),
          entry.undoneAt ? 'Ångrad' : 'Kvitterad',
        ]),
      ],
    },
  };
}

function fullEntries(entries: AcknowledgementHistoryEntry[]): Content[] {
  const content: Content[] = [];
  for (const entry of entries) {
    content.push(
      { text: entry.title, style: 'entryHeading', headlineLevel: 1 },
      { text: [entry.propertyName, entry.propertyAddress].filter(Boolean).join(' · '), bold: true },
      { text: `${entry.source} · ${severityLabel(entry.severity)}${entry.area ? ` · ${entry.area}` : ''}`, style: 'secondary' },
      { text: `Händelsetid ${acknowledgementTime(entry.eventAt)}`, style: 'secondary' },
      { text: `Kvitterad ${acknowledgementTime(entry.acknowledgedAt)}`, style: 'action' },
    );
    if (entry.undoneAt) content.push({
      text: `Ångrad ${acknowledgementTime(entry.undoneAt)}`,
      style: 'action', color: '#795019',
    });
    if (entry.imported) content.push({ text: importedText, style: 'secondary', italics: true });
    if (entry.description) content.push({ text: entry.description, margin: [0, 5, 0, 0] });
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
): TDocumentDefinitions {
  const compact = format === 'compact';
  const formatLabel = compact ? 'Kort lista' : 'Fullständig rapport';
  return {
    info: { title: `Kvitteringar - ${formatLabel}`, author: 'FastighetsRadar' },
    pageSize: 'A4',
    pageMargins: [42, 44, 42, 48],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#1A231F', lineHeight: 1.22 },
    footer: (page, total) => ({
      columns: [{ text: demo ? 'FastighetsRadar · Demodata' : 'FastighetsRadar' }, { text: `Sida ${page} av ${total}`, alignment: 'right' }],
      margin: [42, 12, 42, 0], fontSize: 9, color: '#54645B',
    }),
    content: [
      { text: 'Kvitteringar', fontSize: 28, bold: true, margin: [0, 0, 0, 5] },
      { text: [organizationName, formatLabel, demo && 'Demodata'].filter(Boolean).join(' · '), bold: true },
      { text: `${selection}\n${entries.length === 1 ? '1 kvittering' : `${entries.length} kvitteringar`} · Exporterad ${acknowledgementTime(exportedAt)} (svensk tid)`, style: 'secondary' },
      ...(compact ? [compactEntries(entries)] : fullEntries(entries)),
    ],
    styles: {
      entryHeading: { fontSize: 13, bold: true, margin: [0, 17, 0, 4] },
      secondary: { color: '#54645B', margin: [0, 2, 0, 0] },
      action: { bold: true, margin: [0, 2, 0, 0] },
    },
    pageBreakBefore: (node, container) => node.headlineLevel === 1 && container.getFollowingNodesOnPage().length === 0,
  };
}

export async function downloadAcknowledgementReport(
  entries: AcknowledgementHistoryEntry[], organizationName: string, selection: string, demo: boolean, format: AcknowledgementReportFormat,
) {
  const [pdf, fonts] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
  const pdfMake = pdf.default ?? pdf;
  pdfMake.addVirtualFileSystem(fonts.default ?? fonts);
  const exportedAt = new Date().toISOString();
  const formatSlug = format === 'compact' ? 'kort-lista' : 'fullstandig-rapport';
  await pdfMake.createPdf(acknowledgementReport(entries, organizationName, selection, demo, exportedAt, format))
    .download(`kvitteringar-${formatSlug}-${acknowledgementDay(exportedAt)}.pdf`);
}
