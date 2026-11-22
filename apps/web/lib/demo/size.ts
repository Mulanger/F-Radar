/**
 * Size of the demo test portfolio (docs/plans/skalning.md, Fas 0). `/demo/…?n=500` stores the size in
 * a cookie (see proxy.ts) so it follows the user between demo pages; `?n=0` returns to the
 * original eight properties. Only the gated `/demo` dashboard reads it – never live data – and only
 * outside production builds (see `requestedDemoSize`).
 */
export const DEMO_SIZE_PARAM = 'n';
export const DEMO_SIZE_COOKIE = 'fr_demo_size';

/** Digits only and above zero; the loader clamps it to the supported range. */
export function demoSizeParam(raw: string | null): string | null {
  return raw !== null && /^\d{1,5}$/.test(raw) && Number(raw) > 0 ? String(Number(raw)) : null;
}
