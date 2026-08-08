import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Emulator-backed integration tests need live Firestore/Auth emulators and
    // must NOT run in the mocked unit-test pass. Run them via `npm run test:emulator`.
    exclude: [...configDefaults.exclude, 'tests/emulator/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Backend deps live only in functions/node_modules. Pinning them to one
      // resolved id lets a test file's vi.mock('firebase-admin') intercept the
      // copy functions/src actually imports — without this, the test file and
      // functions/src resolve different ids and the mock silently misses.
      'firebase-admin': path.resolve(__dirname, './functions/node_modules/firebase-admin'),
      'puppeteer-core': path.resolve(__dirname, './functions/node_modules/puppeteer-core'),
      '@sparticuz/chromium': path.resolve(__dirname, './functions/node_modules/@sparticuz/chromium'),
    },
  },
});
