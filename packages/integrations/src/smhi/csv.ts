/** Streams an SMHI CSV archive line by line (bounded memory; the reader is always released). */
export async function readSmhiCsv(response: Response, line: (line: string) => void): Promise<void> {
  if (!response.body) throw new Error('Empty archive');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const text of lines) line(text.replace(/\r$/, ''));
    }
    line(pending + decoder.decode());
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
