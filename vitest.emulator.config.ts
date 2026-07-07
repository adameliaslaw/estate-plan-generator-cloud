import { defineConfig } from 'vitest/config';

/**
 * Emulator-backed integration tests (T4 in docs/REGRESSION-TESTS.md).
 *
 * These exercise REAL functions/src code (admin SDK) against live Firebase
 * emulators — no firebase-admin mocks. Run them via `npm run test:emulator`,
 * which uses `firebase emulators:exec` to start Firestore + Auth, set the
 * *_EMULATOR_HOST env vars, run this config, then tear the emulators down.
 *
 * Prereq: a Java runtime (the Firestore emulator requires a JRE). The Auth
 * emulator is Node-only, but both tests here touch Firestore.
 *
 * Kept OUT of the default `npm run test` pass (see vitest.config.ts `exclude`)
 * so the unit suite stays hermetic and emulator-free.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/emulator/**/*.test.ts'],
    // Emulator tests share a live datastore; run files serially to keep
    // seeded state and cleanup predictable.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
