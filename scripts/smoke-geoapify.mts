/**
 * Live smoke test for the Geoapify adapter (1–2 credits). Prints suggestions only – never the key.
 * Usage: npx tsx scripts/smoke-geoapify.ts "Sveavägen 42, Stockholm"
 */
import { loadServerEnv } from '../packages/config/src';
import { geoapifyAdapter } from '../packages/integrations/src/geoapify';

try {
  process.loadEnvFile('.env');
} catch {
  /* optional */
}
const env = loadServerEnv();
const q = process.argv[2] ?? 'Sveavägen 42, Stockholm';
const r = await geoapifyAdapter.suggest(q, {
  env,
  fetch,
  logger: { debug() {}, info() {}, warn: (o, m) => console.warn(m, o), error: (o, m) => console.error(m, o) },
  now: () => new Date(),
});
if (!r.ok) {
  console.log(JSON.stringify({ ok: false, error: r.error, detail: r.detail }));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, fetchedAt: r.fetchedAt, suggestions: r.data.map((s) => ({ label: s.label, lat: s.lat, lon: s.lon, precision: s.precision, resultType: s.resultType, confidence: s.confidence })) }, null, 2));
