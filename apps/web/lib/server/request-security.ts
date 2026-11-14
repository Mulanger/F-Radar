import 'server-only';

export class RequestBodyTooLarge extends Error {}
export class RequestBodyTimeout extends Error {}

/** Compare full origins against operator configuration, never forwarded client headers. */
export function isSameOrigin(req: Request, appUrl = process.env.APP_URL): boolean {
  try {
    if (!appUrl && process.env.NODE_ENV === 'production') return false;
    const expected = new URL(appUrl || 'http://localhost:3000').origin;
    return req.headers.get('origin') === expected && req.headers.get('sec-fetch-site') !== 'cross-site';
  } catch { return false; }
}

/** Bound bytes while reading, including chunked bodies without Content-Length. */
export async function readBoundedText(req: Request, maxBytes: number, timeoutMs = 10_000): Promise<string> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new RequestBodyTooLarge();
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RequestBodyTimeout()), timeoutMs);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new RequestBodyTooLarge();
      chunks.push(value);
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
  } catch (err) {
    void reader.cancel().catch(() => undefined);
    throw err;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
