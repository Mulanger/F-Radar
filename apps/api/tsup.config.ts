import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle internal workspace packages (they ship TypeScript source); keep npm deps external.
  noExternal: [/^@fastighetsradar\//],
});
