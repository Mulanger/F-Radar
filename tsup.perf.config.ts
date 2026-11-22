import { defineConfig } from 'tsup';

/**
 * Scale-measurement bundle for the f-radar pod (docs/plans/skalning.md, Fas 0):
 *   dist-perf/portfolio-scale.mjs – seeds synthetic organizations in `fastighetsradar_test` and measures
 *   GET /v1/portfolio (time, size, heap). Run with scripts/run-portfolio-scale.mjs.
 */
export default defineConfig({
  entry: { 'portfolio-scale': 'tests/perf/portfolio-scale.ts' },
  outDir: 'dist-perf',
  clean: true,
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  bundle: true,
  splitting: false,
  sourcemap: false,
  noExternal: [/.*/],
  external: ['pg-native'],
  outExtension: () => ({ js: '.mjs' }),
  removeNodeProtocol: false,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
