import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL('./apps/web/', import.meta.url)) },
      // `server-only` throws outside a React Server environment; tests import loaders directly.
      { find: /^server-only$/, replacement: fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)) },
    ],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'apps/*/test/**/*.test.tsx'],
    environment: 'node',
    // No test may reach the network; adapters receive an injected fetch.
    restoreMocks: true,
  },
});
