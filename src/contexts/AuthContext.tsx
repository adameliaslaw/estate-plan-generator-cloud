/**
 * AuthContext — Firebase Authentication context for the NJ Estate Plan Generator.
 *
 * Provides:
 *   - user: Firebase User | null
 *   - userProfile: Firestore-backed extended profile merged with custom claims
 *   - loading: boolean
 *   - signInWithEmail / signInWithGoogle / signInWithEmailLink
 *   - signUp / signOut / resetPassword / updateUserProfile
 *
 * Session timeout: auto-logout after SESSION_TIMEOUT_MS of inactivity.
 * Activity is tracked via mousemove, keydown, click, and touchstart events.
 * A warning is surfaced 2 minutes before logout via a custom DOM event
 * ("session-warning") so UI layers can display a toast.
 */

import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateEmail,
  updatePassword,
  updateProfile,
  type User,
} from 'firebase/auth';

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

import { auth, db } from '@/config/firebase';
import { AUTH_ERRORS, SESSION_TIMEOUT_MS, SESSION_WARNING_MS, COLLECTIONS } from '@/config/constants';
import type { UserProfile, UserRole } from '@/types';

// ---------------------------------------------------------------------------
// Context value shape
// ---------------------------------------------------------------------------

export interface AuthContextValue {
  /** Firebase Auth user object, or null when signed out. */
  user: User | null;
  /** Extended profile from Firestore + custom claims. */
  userProfile: UserProfile | null;
  /** True while the initial auth state is being resolved. */
  loading: boolean;

  signInWithEmail(email: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  /** Complete a passwordless email-link sign-in. */
  signInWithEmailLink(email: string, link: string): Promise<void>;
  /** Send a passwordless sign-in link to the given email. */
  sendSignInLink(email: string): Promise<void>;
  signUp(email: string, password: string, displayName: string): Promise<void>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  updateUserProfile(data: Partial<UserProfile> & { newPassword?: string; newEmail?: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map Firebase error codes to human-readable messages. */
function mapAuthError(error: unknown): string {
  if (error instanceof Error && 'code' in error) {
    const code = (error as { code: string }).code;
    return AUTH_ERRORS[code] ?? error.message;
  }
  return 'An unexpected error occurred. Please try again.';
}

/**
 * Extract custom claims (role, firmId) from the Firebase ID token.
 * Forces a token refresh so we always have the latest claims.
 */
async function getCustomClaims(
  user: User,
): Promise<{ role: UserRole; firmId: string }> {
  const idTokenResult = await user.getIdTokenResult(/* forceRefresh */ true);
  const claims = idTokenResult.claims as Record<string, unknown>;
  return {
    role: (claims['role'] as UserRole) ?? 'client',
    firmId: (claims['firmId'] as string) ?? '',
  };
}

/**
 * Load the extended user document from Firestore.
 * Path: /firms/{firmId}/users/{uid}
 */
async function loadFirestoreProfile(
  uid: string,
  firmId: string,
): Promise<Partial<UserProfile> | null> {
  if (!firmId) return null;
  const ref = doc(db, COLLECTIONS.USERS(firmId), uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    ...data,
    createdAt: data['createdAt']?.toDate?.() ?? new Date(),
    updatedAt: data['updatedAt']?.toDate?.() ?? new Date(),
  } as Partial<UserProfile>;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Refs for the session timeout timers so we can clear/reset them.
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether a user is currently signed in (for activity callbacks).
  const isAuthenticatedRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Helpers used inside the provider
  // ---------------------------------------------------------------------------

  /** Build a full UserProfile by merging auth data + claims + Firestore doc. */
  const buildProfile = useCallback(
    async (firebaseUser: User): Promise<UserProfile> => {
      const { role, firmId } = await getCustomClaims(firebaseUser);
      const firestoreData = await loadFirestoreProfile(firebaseUser.uid, firmId);

      return {
        uid: firebaseUser.uid,
        email: firebaseUser.email ?? '',
        displayName:
          firestoreData?.displayName ?? firebaseUser.displayName ?? '',
        role,
        firmId,
        photoURL: firestoreData?.photoURL ?? firebaseUser.photoURL ?? undefined,
        phone: firestoreData?.phone,
        onboarded: firestoreData?.onboarded ?? false,
        createdAt: firestoreData?.createdAt ?? new Date(),
        updatedAt: firestoreData?.updatedAt ?? new Date(),
      };
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Session timeout logic
  // ---------------------------------------------------------------------------

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current !== null) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    if (logoutTimerRef.current !== null) {
      clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
  }, []);

  const scheduleTimers = useCallback(() => {
    if (!isAuthenticatedRef.current) return;

    clearTimers();

    // Warning timer: fires 2 minutes before logout
    warningTimerRef.current = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('session-warning'));
    }, SESSION_WARNING_MS);

    // Logout timer: fires after full inactivity window
    logoutTimerRef.current = setTimeout(() => {
      void firebaseSignOut(auth);
    }, SESSION_TIMEOUT_MS);
  }, [clearTimers]);

  // Reset timers whenever the user is active.
  const handleActivity = useCallback(() => {
    if (isAuthenticatedRef.current) {
      scheduleTimers();
    }
  }, [scheduleTimers]);

  // ---------------------------------------------------------------------------
  // Register / unregister activity listeners
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const events: (keyof WindowEventMap)[] = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'scroll',
    ];

    events.forEach((e) => window.addEventListener(e, handleActivity, { passive: true }));

    return () => {
      events.forEach((e) => window.removeEventListener(e, handleActivity));
    };
  }, [handleActivity]);

  // ---------------------------------------------------------------------------
  // Firebase auth state listener
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        isAuthenticatedRef.current = true;
        try {
          const profile = await buildProfile(firebaseUser);
          setUser(firebaseUser);
          setUserProfile(profile);
          scheduleTimers();
        } catch (err) {
          console.error('[AuthContext] Failed to build user profile:', err);
          setUser(firebaseUser);
          setUserProfile(null);
        }
      } else {
        isAuthenticatedRef.current = false;
        clearTimers();
        setUser(null);
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => {
      unsubscribe();
      clearTimers();
    };
  }, [buildProfile, clearTimers, scheduleTimers]);

  // ---------------------------------------------------------------------------
  // Auth actions
  // ---------------------------------------------------------------------------

  const signInWithEmail = useCallback(
    async (email: string, password: string): Promise<void> => {
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err) {
        throw new Error(mapAuthError(err));
      }
    },
    [],
  );

  const signInWithGoogle = useCallback(async (): Promise<void> => {
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('email');
      provider.addScope('profile');
      await signInWithPopup(auth, provider);
    } catch (err) {
      throw new Error(mapAuthError(err));
    }
  }, []);

  const signInWithEmailLinkAction = useCallback(
    async (email: string, link: string): Promise<void> => {
      try {
        if (!isSignInWithEmailLink(auth, link)) {
          throw new Error('The provided link is not a valid sign-in link.');
        }
        await signInWithEmailLink(auth, email, link);
        // Clean stored email after successful sign-in.
        window.localStorage.removeItem('emailForSignIn');
      } catch (err) {
        throw new Error(mapAuthError(err));
      }
    },
    [],
  );

  const sendSignInLink = useCallback(async (email: string): Promise<void> => {
    try {
      const actionCodeSettings = {
        url: `${window.location.origin}/auth/email-signin`,
        handleCodeInApp: true,
      };
      await sendSignInLinkToEmail(auth, email, actionCodeSettings);
      // Persist email so we can pre-fill the confirmation page.
      window.localStorage.setItem('emailForSignIn', email);
    } catch (err) {
      throw new Error(mapAuthError(err));
    }
  }, []);

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      displayName: string,
    ): Promise<void> => {
      try {
        const credential = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );
        // Update the Firebase Auth display name.
        await updateProfile(credential.user, { displayName });
        // Create the Firestore profile stub; custom claims (role, firmId) are
        // set server-side by a Cloud Function after the user is verified.
        await setDoc(
          doc(db, `users_pending/${credential.user.uid}`),
          {
            email,
            displayName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            onboarded: false,
          },
          { merge: true },
        );
      } catch (err) {
        throw new Error(mapAuthError(err));
      }
    },
    [],
  );

  const signOutAction = useCallback(async (): Promise<void> => {
    try {
      clearTimers();
      await firebaseSignOut(auth);
    } catch (err) {
      throw new Error(mapAuthError(err));
    }
  }, [clearTimers]);

  const resetPassword = useCallback(async (email: string): Promise<void> => {
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (err) {
      throw new Error(mapAuthError(err));
    }
  }, []);

  const updateUserProfileAction = useCallback(
    async (
      data: Partial<UserProfile> & {
        newPassword?: string;
        newEmail?: string;
      },
    ): Promise<void> => {
      if (!user) throw new Error('No authenticated user.');

      const { newPassword, newEmail, ...profileData } = data;

      try {
        // Update Firebase Auth display name / photo if provided.
        const authUpdates: { displayName?: string; photoURL?: string } = {};
        if (profileData.displayName !== undefined)
          authUpdates.displayName = profileData.displayName;
        if (profileData.photoURL !== undefined)
          authUpdates.photoURL = profileData.photoURL;
        if (Object.keys(authUpdates).length > 0) {
          await updateProfile(user, authUpdates);
        }

        // Update email if requested.
        if (newEmail && newEmail !== user.email) {
          await updateEmail(user, newEmail);
        }

        // Update password if requested.
        if (newPassword) {
          await updatePassword(user, newPassword);
        }

        // Refresh claims and profile after auth updates.
        const { firmId } = await getCustomClaims(user);
        if (firmId) {
          const ref = doc(db, COLLECTIONS.USERS(firmId), user.uid);
          await updateDoc(ref, {
            ...profileData,
            updatedAt: serverTimestamp(),
          });
        }

        // Rebuild profile in state.
        const updatedProfile = await buildProfile(user);
        setUserProfile(updatedProfile);
      } catch (err) {
        throw new Error(mapAuthError(err));
      }
    },
    [user, buildProfile],
  );

  // ---------------------------------------------------------------------------
  // Context value
  // ---------------------------------------------------------------------------

  const value: AuthContextValue = {
    user,
    userProfile,
    loading,
    signInWithEmail,
    signInWithGoogle,
    signInWithEmailLink: signInWithEmailLinkAction,
    sendSignInLink,
    signUp,
    signOut: signOutAction,
    resetPassword,
    updateUserProfile: updateUserProfileAction,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Raw context export (for useAuth hook)
// ---------------------------------------------------------------------------

export { AuthContext };
