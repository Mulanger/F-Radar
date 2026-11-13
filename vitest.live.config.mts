import { defineConfig } from 'vitest/config';

/** Live provider smoke tests (network). Never part of `npm test`. */
export default defineConfig({
  test: {
    include: ['tests/live/**/*.live.test.ts'],
    environment: 'node',
    testTimeout: 150_000,
  },
});
