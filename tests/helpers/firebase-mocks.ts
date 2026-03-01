/**
 * tests/helpers/firebase-mocks.ts
 *
 * Reusable, configurable Firebase mock factories for use across all test files.
 * Import these to get correctly-typed mock functions with sensible defaults.
 */

import { vi } from 'vitest';
import type { MockClient, MockDocument, MockNote, MockPayment, MockCalendarEvent } from './mock-data';

// ============================================================================
// Types for mock factories
// ============================================================================

export interface MockFirestoreDoc<T = Record<string, unknown>> {
  id: string;
  exists: () => boolean;
  data: () => T;
  ref: { id: string; path: string };
}

export interface MockFirestoreQuery<T = Record<string, unknown>> {
  docs: MockFirestoreDoc<T>[];
  empty: boolean;
  size: number;
  forEach: (fn: (doc: MockFirestoreDoc<T>) => void) => void;
}

// ============================================================================
// Document snapshot factory
// ============================================================================

export function createMockDocSnapshot<T extends Record<string, unknown>>(
  id: string,
  data: T,
  exists = true,
): MockFirestoreDoc<T> {
  return {
    id,
    exists: () => exists,
    data: () => (exists ? data : ({} as T)),
    ref: { id, path: `collection/${id}` },
  };
}

export function createMissingDocSnapshot(id: string): MockFirestoreDoc<Record<string, unknown>> {
  return {
    id,
    exists: () => false,
    data: () => ({}),
    ref: { id, path: `collection/${id}` },
  };
}

// ============================================================================
// Query snapshot factory
// ============================================================================

export function createMockQuerySnapshot<T extends Record<string, unknown>>(
  items: Array<{ id: string; data: T }>,
): MockFirestoreQuery<T> {
  const docs = items.map((item) => createMockDocSnapshot(item.id, item.data));
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach: (fn) => docs.forEach(fn),
  };
}

// ============================================================================
// Auth mock factory — creates a mock Firebase auth user
// ============================================================================

export interface MockAuthUser {
  uid: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  getIdToken: ReturnType<typeof vi.fn>;
  getIdTokenResult: ReturnType<typeof vi.fn>;
}

export function createMockAuthUser(overrides: Partial<MockAuthUser> & {
  claims?: Record<string, unknown>;
} = {}): MockAuthUser {
  const {
    uid = 'mock-uid-001',
    email = 'test@eliascounsel.com',
    displayName = 'Test User',
    emailVerified = true,
    claims = { role: 'attorney', firmId: 'firm-001' },
    ...rest
  } = overrides;

  return {
    uid,
    email,
    displayName,
    emailVerified,
    getIdToken: vi.fn().mockResolvedValue('mock-id-token'),
    getIdTokenResult: vi.fn().mockResolvedValue({
      claims,
      token: 'mock-id-token',
    }),
    ...rest,
  };
}

// ============================================================================
// Firestore collection mock — returns a mock that behaves like a collection ref
// ============================================================================

export function createMockCollectionRef(path: string) {
  return {
    path,
    id: path.split('/').pop() ?? path,
  };
}

// ============================================================================
// Mock getDoc / getDocs factories
// ============================================================================

/**
 * Create a vi.fn() that mimics getDoc, returning a snapshot for a given document.
 */
export function mockGetDoc<T extends Record<string, unknown>>(
  id: string,
  data: T,
): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(createMockDocSnapshot(id, data));
}

/**
 * Create a vi.fn() that mimics getDocs, returning a query snapshot.
 */
export function mockGetDocs<T extends Record<string, unknown>>(
  items: Array<{ id: string; data: T }>,
): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(createMockQuerySnapshot(items));
}

// ============================================================================
// Mock onSnapshot factory
// ============================================================================

/**
 * Create a vi.fn() that mimics onSnapshot (document listener).
 * Calls the callback immediately with the provided snapshot.
 */
export function mockOnSnapshot<T extends Record<string, unknown>>(
  id: string,
  data: T,
): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((ref, callback) => {
    callback(createMockDocSnapshot(id, data));
    return vi.fn(); // unsubscribe function
  });
}

/**
 * Create a vi.fn() that mimics onSnapshot for a collection query.
 * Calls the callback immediately with the provided query snapshot.
 */
export function mockOnSnapshotQuery<T extends Record<string, unknown>>(
  items: Array<{ id: string; data: T }>,
): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((ref, callback) => {
    callback(createMockQuerySnapshot(items));
    return vi.fn(); // unsubscribe function
  });
}

// ============================================================================
// Mock httpsCallable factory
// ============================================================================

/**
 * Create a mock for httpsCallable that returns a successful response.
 */
export function mockHttpsCallable<TReq, TRes>(
  responseData: TRes,
): ReturnType<typeof vi.fn> {
  return vi.fn().mockReturnValue(vi.fn().mockResolvedValue({ data: responseData }));
}

/**
 * Create a mock for httpsCallable that throws an error.
 */
export function mockHttpsCallableError(
  code: string,
  message: string,
): ReturnType<typeof vi.fn> {
  const error = new Error(message);
  (error as Error & { code: string }).code = code;
  return vi.fn().mockReturnValue(vi.fn().mockRejectedValue(error));
}

// ============================================================================
// Client-specific mock helpers
// ============================================================================

export function createClientDoc(client: MockClient): MockFirestoreDoc<typeof client> {
  return createMockDocSnapshot(client.id, client);
}

export function createDocumentDoc(doc: MockDocument): MockFirestoreDoc<typeof doc> {
  return createMockDocSnapshot(doc.id, doc);
}

export function createNoteDoc(note: MockNote): MockFirestoreDoc<typeof note> {
  return createMockDocSnapshot(note.id, note);
}

export function createPaymentDoc(payment: MockPayment): MockFirestoreDoc<typeof payment> {
  return createMockDocSnapshot(payment.id, payment);
}

export function createEventDoc(event: MockCalendarEvent): MockFirestoreDoc<typeof event> {
  return createMockDocSnapshot(event.id, event);
}

// ============================================================================
// Auth context mock value factory
// ============================================================================

export interface MockAuthContextValue {
  user: MockAuthUser | null;
  loading: boolean;
  role: string | null;
  firmId: string | null;
  signIn: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  sendMagicLink: ReturnType<typeof vi.fn>;
}

export function createMockAuthContext(overrides: Partial<MockAuthContextValue> = {}): MockAuthContextValue {
  const defaultUser = createMockAuthUser();
  return {
    user: defaultUser,
    loading: false,
    role: 'attorney',
    firmId: 'firm-001',
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    sendMagicLink: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ============================================================================
// Firebase error factory
// ============================================================================

export function createFirebaseError(code: string, message: string): Error {
  const error = new Error(message);
  Object.defineProperty(error, 'code', { value: code });
  Object.defineProperty(error, 'name', { value: 'FirebaseError' });
  return error;
}

// ============================================================================
// Batch write mock
// ============================================================================

export function createMockBatch() {
  return {
    set: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    commit: vi.fn().mockResolvedValue(undefined),
  };
}

// ============================================================================
// Storage mock
// ============================================================================

export function createMockStorageRef(path: string) {
  return { fullPath: path, name: path.split('/').pop() ?? '', bucket: 'mock-bucket' };
}

export function createMockUploadTask(progress = 100) {
  let callback: ((snapshot: unknown) => void) | null = null;
  return {
    on: vi.fn((event, progressCb, errorCb, completeCb) => {
      callback = progressCb;
      // Simulate completion
      setTimeout(() => completeCb?.(), 0);
    }),
    snapshot: {
      bytesTransferred: progress,
      totalBytes: 100,
      state: progress === 100 ? 'success' : 'running',
    },
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  };
}
