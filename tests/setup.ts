/**
 * tests/setup.ts
 *
 * Global test setup for the NJ Estate Plan Generator test suite.
 * Runs before every test file via vitest setupFiles.
 *
 * Provides:
 * - Firebase module mocks (app, auth, firestore, storage, functions)
 * - window.matchMedia mock
 * - ResizeObserver mock
 * - IntersectionObserver mock
 * - @testing-library/jest-dom matchers
 */

import '@testing-library/jest-dom';
import { vi } from 'vitest';

// ============================================================================
// Firebase mocks
// ============================================================================

// firebase/app
vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]', options: {} })),
  getApp: vi.fn(() => ({ name: '[DEFAULT]', options: {} })),
  getApps: vi.fn(() => []),
  deleteApp: vi.fn(),
}));

// firebase/auth
vi.mock('firebase/auth', () => {
  const mockUser = {
    uid: 'mock-uid-001',
    email: 'test@eliascounsel.com',
    displayName: 'Test Attorney',
    emailVerified: true,
    getIdToken: vi.fn().mockResolvedValue('mock-id-token'),
    getIdTokenResult: vi.fn().mockResolvedValue({
      claims: { role: 'attorney', firmId: 'firm-001' },
      token: 'mock-id-token',
    }),
  };

  return {
    getAuth: vi.fn(() => ({
      currentUser: null,
      onAuthStateChanged: vi.fn(),
    })),
    signInWithEmailAndPassword: vi.fn().mockResolvedValue({ user: mockUser }),
    createUserWithEmailAndPassword: vi.fn().mockResolvedValue({ user: mockUser }),
    signOut: vi.fn().mockResolvedValue(undefined),
    onAuthStateChanged: vi.fn((auth, callback) => {
      callback(null);
      return vi.fn(); // unsubscribe
    }),
    sendSignInLinkToEmail: vi.fn().mockResolvedValue(undefined),
    isSignInWithEmailLink: vi.fn().mockReturnValue(false),
    signInWithEmailLink: vi.fn().mockResolvedValue({ user: mockUser }),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    connectAuthEmulator: vi.fn(),
    browserLocalPersistence: { type: 'LOCAL' },
    browserSessionPersistence: { type: 'SESSION' },
    setPersistence: vi.fn().mockResolvedValue(undefined),
  };
});

// firebase/firestore
vi.mock('firebase/firestore', () => {
  const mockDocSnapshot = (id: string, data: Record<string, unknown>) => ({
    id,
    exists: () => true,
    data: () => data,
    get: (field: string) => data[field],
    ref: { id, path: `collection/${id}` },
  });

  const mockQuerySnapshot = (docs: Array<{ id: string; data: Record<string, unknown> }>) => ({
    docs: docs.map((d) => mockDocSnapshot(d.id, d.data)),
    empty: docs.length === 0,
    size: docs.length,
    forEach: (fn: (doc: unknown) => void) =>
      docs.map((d) => mockDocSnapshot(d.id, d.data)).forEach(fn),
  });

  return {
    getFirestore: vi.fn(() => ({})),
    collection: vi.fn((...args) => ({ path: args.join('/') })),
    doc: vi.fn((...args) => ({ path: args.join('/') })),
    getDoc: vi.fn().mockResolvedValue(mockDocSnapshot('doc-001', {})),
    getDocs: vi.fn().mockResolvedValue(mockQuerySnapshot([])),
    setDoc: vi.fn().mockResolvedValue(undefined),
    addDoc: vi.fn().mockResolvedValue({ id: 'new-doc-001' }),
    updateDoc: vi.fn().mockResolvedValue(undefined),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
    onSnapshot: vi.fn((ref, callback) => {
      callback(mockDocSnapshot('doc-001', {}));
      return vi.fn(); // unsubscribe
    }),
    query: vi.fn((...args) => args[0]),
    where: vi.fn((field, op, val) => ({ field, op, val })),
    orderBy: vi.fn((field, dir) => ({ field, dir })),
    limit: vi.fn((n) => ({ n })),
    serverTimestamp: vi.fn(() => new Date().toISOString()),
    Timestamp: {
      now: vi.fn(() => ({ toDate: () => new Date(), seconds: Date.now() / 1000, nanoseconds: 0 })),
      fromDate: vi.fn((d: Date) => ({ toDate: () => d, seconds: d.getTime() / 1000, nanoseconds: 0 })),
    },
    connectFirestoreEmulator: vi.fn(),
    writeBatch: vi.fn(() => ({
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    })),
    runTransaction: vi.fn().mockResolvedValue(undefined),
  };
});

// firebase/storage
vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => ({})),
  ref: vi.fn((...args) => ({ path: args.join('/') })),
  uploadBytes: vi.fn().mockResolvedValue({ ref: { fullPath: 'uploads/mock-file.pdf' } }),
  uploadBytesResumable: vi.fn().mockReturnValue({
    on: vi.fn(),
    snapshot: { bytesTransferred: 0, totalBytes: 100, state: 'running' },
  }),
  getDownloadURL: vi.fn().mockResolvedValue('https://firebasestorage.example.com/mock-file.pdf'),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  connectStorageEmulator: vi.fn(),
}));

// firebase/functions
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: { success: true } })),
  connectFunctionsEmulator: vi.fn(),
}));

// ============================================================================
// @/config/firebase — re-export the mocked instances
// ============================================================================
vi.mock('@/config/firebase', () => ({
  app: {},
  auth: {
    currentUser: null,
    onAuthStateChanged: vi.fn(),
  },
  db: {},
  storage: {},
  functions: {},
}));

// ============================================================================
// window.matchMedia mock (jsdom doesn't include this)
// ============================================================================
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),      // deprecated but still used by some libs
    removeListener: vi.fn(),   // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ============================================================================
// ResizeObserver mock
// ============================================================================
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// ============================================================================
// IntersectionObserver mock
// ============================================================================
global.IntersectionObserver = vi.fn().mockImplementation((callback) => ({
  root: null,
  rootMargin: '',
  thresholds: [],
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
  takeRecords: vi.fn().mockReturnValue([]),
}));

// ============================================================================
// URL.createObjectURL / revokeObjectURL (needed for export tests)
// ============================================================================
if (typeof URL.createObjectURL === 'undefined') {
  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    value: vi.fn(() => 'blob:http://localhost/mock-object-url'),
  });
}
if (typeof URL.revokeObjectURL === 'undefined') {
  Object.defineProperty(URL, 'revokeObjectURL', {
    writable: true,
    value: vi.fn(),
  });
}

// ============================================================================
// localStorage / sessionStorage mocks (jsdom provides these, but add spy)
// ============================================================================
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'sessionStorage', { value: localStorageMock });

// ============================================================================
// console.error suppression for known React / test noise
// ============================================================================
const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : '';
  // Suppress known jsdom / React 19 noise that doesn't affect test validity
  if (
    msg.includes('Warning: ReactDOM.render') ||
    msg.includes('act(') ||
    msg.includes('Not implemented: navigation')
  ) {
    return;
  }
  originalError(...args);
};
