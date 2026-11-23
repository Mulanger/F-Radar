import { legalDomain } from '@/lib/legal/company';
import { acknowledgementDay } from './presentation';
import { acknowledgementCsv, pdfFromJob, type AcknowledgementPdfJob, type AcknowledgementReportFormat } from './report';
import type { AcknowledgementHistoryEntry } from '@fastighetsradar/domain';

export { acknowledgementCsv, acknowledgementReport, buildAcknowledgementPdf, pdfFromJob, type AcknowledgementPdfJob, type AcknowledgementReportFormat } from './report';

/**
 * Builds the PDF in a Web Worker so a report of thousands of acknowledgements does not freeze the
 * tab (Fas 2 / S-08); on the main thread where workers are unavailable or fail to start.
 */
async function pdfOffMainThread(job: AcknowledgementPdfJob): Promise<Blob> {
  if (typeof Worker === 'undefined') return pdfFromJob(job);
  let worker: Worker;
  try {
    worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return pdfFromJob(job);
  }
  try {
    return await new Promise<Blob>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ blob?: Blob; error?: string }>) => (e.data.blob ? resolve(e.data.blob) : reject(new Error(e.data.error ?? 'PDF')));
      worker.onerror = (e) => {
        e.preventDefault();
        reject(new Error('PDF worker'));
      };
      worker.postMessage(job);
    });
  } catch {
    return pdfFromJob(job);
  } finally {
    worker.terminate();
  }
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadAcknowledgementReport(
  entries: AcknowledgementHistoryEntry[], organizationName: string, selection: string, demo: boolean, format: AcknowledgementReportFormat, truncated = false,
) {
  const exportedAt = new Date().toISOString();
  const formatSlug = format === 'compact' ? 'kort-lista' : 'fullstandig-rapport';
  const blob = await pdfOffMainThread({ entries, organizationName, selection, demo, exportedAt, format, domain: legalDomain(window.location.origin), truncated });
  save(blob, `kvitteringar-${formatSlug}-${acknowledgementDay(exportedAt)}.pdf`);
}

export function downloadAcknowledgementCsv(entries: AcknowledgementHistoryEntry[]) {
  save(new Blob([acknowledgementCsv(entries)], { type: 'text/csv;charset=utf-8' }), `kvitteringar-${acknowledgementDay(new Date().toISOString())}.csv`);
}
