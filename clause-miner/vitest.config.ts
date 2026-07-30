import { defineConfig } from 'vitest/config';

// Without this file, vitest run from clause-miner/ resolves the repo root's
// vitest.config.ts (jsdom environment + React setup files) — this suite is
// pure Node and must run in the node environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
