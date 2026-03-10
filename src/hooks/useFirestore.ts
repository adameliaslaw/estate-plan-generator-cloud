/**
 * useFirestore — generic real-time and one-shot Firestore hooks + CRUD helpers.
 *
 * Hooks:
 *   useDocument<T>(path)              — real-time listener for a single document
 *   useCollection<T>(path, ...constraints) — real-time listener for a collection
 *   useDocumentOnce<T>(path)          — one-shot fetch of a single document
 *
 * Helpers (not hooks, safe to call inside event handlers):
 *   createDoc<T>(path, data)          — add a document (auto-ID or custom ID)
 *   updateDoc<T>(path, data)          — merge-update an existing document
 *   deleteDoc(path)                   — delete a document
 *   getDocOnce<T>(path)               — one-shot fetch outside a component
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc as firestoreDeleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc as firestoreUpdateDoc,
  type DocumentData,
  type QueryConstraint,
  type QuerySnapshot,
  query,
} from 'firebase/firestore';

import { db } from '@/config/firebase';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface DocumentState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

interface CollectionState<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// useDocument<T>
// ---------------------------------------------------------------------------

/**
 * Real-time listener for a single Firestore document.
 *
 * @param path - Firestore document path (e.g. "firms/abc/clients/xyz").
 *               Pass an empty string / null to skip the subscription.
 */
export function useDocument<T extends DocumentData>(
  path: string | null | undefined,
): DocumentState<T & { id: string }> {
  const [state, setState] = useState<DocumentState<T & { id: string }>>({
    data: null,
    loading: !!path,
    error: null,
  });

  // Keep path in a ref so the cleanup can always access the latest value.
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));

    const ref = doc(db, path);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setState({
            data: { ...(snap.data() as T), id: snap.id },
            loading: false,
            error: null,
          });
        } else {
          setState({ data: null, loading: false, error: null });
        }
      },
      (err) => {
        console.error(`[useDocument] Error listening to ${path}:`, err);
        setState({ data: null, loading: false, error: err });
      },
    );

    return () => unsubscribe();
  }, [path]);

  return state;
}

// ---------------------------------------------------------------------------
// useCollection<T>
// ---------------------------------------------------------------------------

/**
 * Real-time listener for a Firestore collection (with optional query constraints).
 *
 * @param path              - Collection path (e.g. "firms/abc/clients").
 * @param queryConstraints  - Optional Firestore query constraints (where, orderBy, limit…).
 *
 * Each returned item is typed as `T & { id: string }` where `id` is the
 * document ID injected automatically.
 */
export function useCollection<T extends DocumentData>(
  path: string | null | undefined,
  queryConstraints: QueryConstraint[] = [],
): CollectionState<T & { id: string }> {
  const [state, setState] = useState<CollectionState<T & { id: string }>>({
    data: [],
    loading: !!path,
    error: null,
  });

  // Serialise constraints into a stable key so the effect re-runs only when
  // the actual constraint values change (not on every render).
  const constraintKey = JSON.stringify(
    queryConstraints.map((c) => c.toString()),
  );

  useEffect(() => {
    if (!path) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));

    const collRef = collection(db, path);
    const q =
      queryConstraints.length > 0 ? query(collRef, ...queryConstraints) : collRef;

    const mapSnapshot = (snap: QuerySnapshot<DocumentData>) =>
      snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setState({ data: mapSnapshot(snap), loading: false, error: null });
      },
      (err) => {
        console.error(`[useCollection] Error listening to ${path}:`, err);
        setState({ data: [], loading: false, error: err });
      },
    );

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, constraintKey]);

  return state;
}

// ---------------------------------------------------------------------------
// useCollectionGroup<T>
// ---------------------------------------------------------------------------

/**
 * Real-time listener for a Firestore collection group (with optional query constraints).
 *
 * @param collectionId      - Collection ID (e.g. "notes").
 * @param queryConstraints  - Optional Firestore query constraints (where, orderBy, limit…).
 */
export function useCollectionGroup<T extends DocumentData>(
  collectionId: string | null | undefined,
  queryConstraints: QueryConstraint[] = [],
): CollectionState<T & { id: string }> {
  const [state, setState] = useState<CollectionState<T & { id: string }>>({
    data: [],
    loading: !!collectionId,
    error: null,
  });

  const constraintKey = JSON.stringify(
    queryConstraints.map((c) => c.toString()),
  );

  useEffect(() => {
    if (!collectionId) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));

    const collGroupRef = collectionGroup(db, collectionId);
    const q =
      queryConstraints.length > 0 ? query(collGroupRef, ...queryConstraints) : collGroupRef;

    const mapSnapshot = (snap: QuerySnapshot<DocumentData>) =>
      snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setState({ data: mapSnapshot(snap), loading: false, error: null });
      },
      (err) => {
        console.error(`[useCollectionGroup] Error listening to ${collectionId}:`, err);
        setState({ data: [], loading: false, error: err });
      },
    );

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId, constraintKey]);

  return state;
}

// ---------------------------------------------------------------------------
// useDocumentOnce<T>
// ---------------------------------------------------------------------------

/**
 * Fetch a single Firestore document once (no real-time listener).
 * Re-fetches if `path` changes or `refetch()` is called.
 */
export function useDocumentOnce<T extends DocumentData>(
  path: string | null | undefined,
): DocumentState<T & { id: string }> & { refetch: () => void } {
  const [state, setState] = useState<DocumentState<T & { id: string }>>({
    data: null,
    loading: !!path,
    error: null,
  });
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));

    getDoc(doc(db, path))
      .then((snap) => {
        if (cancelled) return;
        if (snap.exists()) {
          setState({
            data: { ...(snap.data() as T), id: snap.id },
            loading: false,
            error: null,
          });
        } else {
          setState({ data: null, loading: false, error: null });
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        console.error(`[useDocumentOnce] Error fetching ${path}:`, err);
        setState({ data: null, loading: false, error: err });
      });

    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  return { ...state, refetch };
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

/**
 * Create a new document. If `id` is provided, uses `setDoc` with that ID;
 * otherwise uses `addDoc` for an auto-generated ID.
 * Returns the document ID.
 */
export async function createDoc<T extends DocumentData>(
  collectionPath: string,
  data: T,
  id?: string,
): Promise<string> {
  const payload = {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (id) {
    const ref = doc(db, collectionPath, id);
    await setDoc(ref, payload);
    return id;
  } else {
    const ref = await addDoc(collection(db, collectionPath), payload);
    return ref.id;
  }
}

/**
 * Merge-update an existing Firestore document.
 * Automatically sets `updatedAt` to the server timestamp.
 */
export async function updateDoc<T extends DocumentData>(
  docPath: string,
  data: Partial<T>,
): Promise<void> {
  const ref = doc(db, docPath);
  await firestoreUpdateDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Delete a Firestore document by path.
 */
export async function deleteDoc(docPath: string): Promise<void> {
  const ref = doc(db, docPath);
  await firestoreDeleteDoc(ref);
}

/**
 * One-shot document fetch outside of a component (no hook overhead).
 * Returns null if the document does not exist.
 */
export async function getDocOnce<T extends DocumentData>(
  docPath: string,
): Promise<(T & { id: string }) | null> {
  const snap = await getDoc(doc(db, docPath));
  if (!snap.exists()) return null;
  return { ...(snap.data() as T), id: snap.id };
}

/**
 * One-shot collection fetch outside of a component.
 */
export async function getCollectionOnce<T extends DocumentData>(
  collectionPath: string,
  queryConstraints: QueryConstraint[] = [],
): Promise<(T & { id: string })[]> {
  const collRef = collection(db, collectionPath);
  const q =
    queryConstraints.length > 0
      ? query(collRef, ...queryConstraints)
      : collRef;
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
}
