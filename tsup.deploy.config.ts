import { defineConfig } from 'tsup';

/**
 * Deployment bundles for the f-radar pod (Linux, Node 22). Everything is bundled into
 * self-contained ESM files so the pod needs no `npm install` for the API side.
 *   dist-deploy/api/main.mjs          – Fastify API (127.0.0.1:4000)
 *   dist-deploy/db/migrate.mjs        – migration CLI (`up` / `status`)
 *   dist-deploy/tests/real-db.test.mjs – real-PostgreSQL integration suite (node --test)
 */
const shared = {
  format: ['esm'] as const,
  platform: 'node' as const,
  target: 'node22',
  bundle: true,
  splitting: false,
  sourcemap: false,
  noExternal: [/.*/],
  external: ['pg-native'],
  outExtension: () => ({ js: '.mjs' }),
  removeNodeProtocol: false,
  // Some bundled CJS deps call require(); provide it in ESM output.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
};

export default defineConfig([
  { ...shared, entry: { main: 'apps/api/src/main.ts' }, outDir: 'dist-deploy/api', clean: true },
  { ...shared, entry: { migrate: 'packages/db/src/cli.ts' }, outDir: 'dist-deploy/db', clean: true },
  { ...shared, entry: { 'real-db.test': 'tests/integration/real-db.test.ts' }, outDir: 'dist-deploy/tests', clean: true },
]);
