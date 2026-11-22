/// <reference lib="webworker" />
import { pdfFromJob, type AcknowledgementPdfJob } from './pdf';

/** Builds the acknowledgement PDF off the main thread (docs/plans/skalning.md, Fas 2 / S-08). */
self.onmessage = async (e: MessageEvent<AcknowledgementPdfJob>) => {
  try {
    const blob = await pdfFromJob(e.data);
    (self as unknown as Worker).postMessage({ blob });
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: err instanceof Error ? err.message : 'PDF' });
  }
};
