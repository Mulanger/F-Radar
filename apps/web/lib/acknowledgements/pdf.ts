import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { AcknowledgementHistoryEntry } from '@fastighetsradar/domain';
import { acknowledgementDay, acknowledgementTime, importedText, severityLabel } from './presentation';

export function acknowledgementReport(
  entries: AcknowledgementHistoryEntry[],
  organizationName: string,
  selection: string,
  demo: boolean,
  exportedAt: string,
): TDocumentDefinitions {
  const layers: Content[] = [];
  for (const entry of entries) {
    layers.push(
      { text: entry.title, style: 'entryHeading', headlineLevel: 1 },
      { text: [entry.propertyName, entry.propertyAddress].filter(Boolean).join(' · '), bold: true },
      { text: `${entry.source} · ${severityLabel(entry.severity)}${entry.area ? ` · ${entry.area}` : ''}`, style: 'secondary' },
      { text: `Händelsetid ${acknowledgementTime(entry.eventAt)}`, style: 'secondary' },
      { text: `Kvitterad ${acknowledgementTime(entry.acknowledgedAt)}`, style: 'action' },
    );
    if (entry.undoneAt) layers.push({
      text: `Ångrad ${acknowledgementTime(entry.undoneAt)}`,
      style: 'action', color: '#795019',
    });
    if (entry.imported) layers.push({ text: importedText, style: 'secondary', italics: true });
    if (entry.description) layers.push({ text: entry.description, margin: [0, 5, 0, 0] });
  }

  return {
    info: { title: 'Kvitteringar', author: 'FastighetsRadar' },
    pageSize: 'A4',
    pageMargins: [42, 44, 42, 48],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#1A231F', lineHeight: 1.22 },
    footer: (page, total) => ({
      columns: [{ text: demo ? 'FastighetsRadar · Demodata' : 'FastighetsRadar' }, { text: `Sida ${page} av ${total}`, alignment: 'right' }],
      margin: [42, 12, 42, 0], fontSize: 9, color: '#54645B',
    }),
    content: [
      { text: 'Kvitteringar', fontSize: 28, bold: true, margin: [0, 0, 0, 5] },
      { text: [organizationName, demo && 'Demodata'].filter(Boolean).join(' · '), bold: true },
      { text: `${selection}\n${entries.length === 1 ? '1 kvittering' : `${entries.length} kvitteringar`} · Exporterad ${acknowledgementTime(exportedAt)} (svensk tid)`, style: 'secondary' },
      ...layers,
    ],
    styles: {
      entryHeading: { fontSize: 13, bold: true, margin: [0, 17, 0, 4] },
      secondary: { color: '#54645B', margin: [0, 2, 0, 0] },
      action: { bold: true, margin: [0, 2, 0, 0] },
    },
    pageBreakBefore: (node, container) => node.headlineLevel === 1 && container.getFollowingNodesOnPage().length === 0,
  };
}

export async function downloadAcknowledgementReport(entries: AcknowledgementHistoryEntry[], organizationName: string, selection: string, demo: boolean) {
  const [pdf, fonts] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
  const pdfMake = pdf.default ?? pdf;
  pdfMake.addVirtualFileSystem(fonts.default ?? fonts);
  const exportedAt = new Date().toISOString();
  await pdfMake.createPdf(acknowledgementReport(entries, organizationName, selection, demo, exportedAt))
    .download(`kvitteringar-${acknowledgementDay(exportedAt)}.pdf`);
}
