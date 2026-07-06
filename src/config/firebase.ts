/**
 * Firebase configuration and service initialization
 *
 * Configuration is read from Vite environment variables (VITE_FIREBASE_*).
 * Copy .env.example to .env and fill in your project values.
 *
 * Emulators are connected when:
 *   - import.meta.env.DEV is true  AND
 *   - VITE_USE_EMULATORS=true
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  type Auth,
} from 'firebase/auth';
import {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore';
import {
  getStorage,
  connectStorageEmulator,
  type FirebaseStorage,
} from 'firebase/storage';
import {
  getFunctions,
  connectFunctionsEmulator,
  type Functions,
} from 'firebase/functions';

// ---------------------------------------------------------------------------
// Firebase config from Vite environment variables
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};

// ---------------------------------------------------------------------------
// Initialize Firebase app — idempotent, safe for Vite HMR
// ---------------------------------------------------------------------------
const app: FirebaseApp = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApp();

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
const auth: Auth = getAuth(app);

// ---------------------------------------------------------------------------
// Firestore — initializeFirestore enables the persistent multi-tab cache
// for offline support. Falls back to memoryLocalCache in environments that
// do not support IndexedDB (e.g. private browsing, some Safari versions).
// ---------------------------------------------------------------------------
let db: Firestore;
try {
  db = initializeFirestore(app, {
    // Firestore rejects any write containing an `undefined` leaf value with a
    // hard `invalid-argument` error. In the questionnaire, clearing an optional
    // field (e.g. a currency input → parseCurrency('') === undefined) would
    // otherwise throw on every subsequent autosave and silently lose all intake
    // from that point on. Omitting undefined is the Firebase-recommended default.
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
} catch (e) {
  console.warn('[Firebase] Persistent cache unavailable, falling back to in-memory cache:', e);
  db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: memoryLocalCache(),
  });
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
const storage: FirebaseStorage = getStorage(app);

// ---------------------------------------------------------------------------
// Cloud Functions — region us-east1 (matches Cloud Functions deployment)
// ---------------------------------------------------------------------------
const functions: Functions = getFunctions(app, 'us-east1');

// ---------------------------------------------------------------------------
// Emulator connections (development only)
// Controlled by both import.meta.env.DEV and VITE_USE_EMULATORS=true
// ---------------------------------------------------------------------------
const useEmulators =
  import.meta.env.DEV &&
  (import.meta.env.VITE_USE_EMULATORS === 'true' ||
    import.meta.env.VITE_USE_EMULATORS === true);

if (useEmulators) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: false });
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectStorageEmulator(storage, 'localhost', 9199);
  connectFunctionsEmulator(functions, 'localhost', 5001);

  console.info(
    '[Firebase] Emulators active — Auth:9099 | Firestore:8080 | Storage:9199 | Functions:5001',
  );
}

export { app, auth, db, storage, functions };

// Expose for admin console scripts (CSP blocks external imports)
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__firebase = { app, auth, db, storage, functions };
}
