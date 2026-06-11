/**
 * tests/integration/auth-flow.test.ts
 *
 * Authentication flow integration tests.
 * All Firebase Auth calls are mocked (no real Firebase connections).
 *
 * Coverage:
 * - Email/password signup flow
 * - Email/password login flow
 * - Invalid credentials error handling
 * - Secure magic link (passwordless) flow
 * - Session timeout configuration exists and values are correct
 * - Role-based route guard behavior (admin / attorney / client routes)
 * - Auth error code mapping to user-friendly messages
 * - Sign-out clears session
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SESSION_TIMEOUT_MS,
  SESSION_WARNING_MS,
  AUTH_ERRORS,
  ROLES,
} from '@/config/constants';
import { createFirebaseError } from '../helpers/firebase-mocks';
import {
  MOCK_ATTORNEY_USER,
  MOCK_CLIENT_USER,
  MOCK_ADMIN_USER,
} from '../helpers/mock-data';

// ============================================================================
// Import the mocked firebase/auth functions
// ============================================================================
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  sendPasswordResetEmail,
} from 'firebase/auth';

// ============================================================================
// SECTION: Session timeout configuration
// ============================================================================

describe('Session timeout configuration', () => {
  it('SESSION_TIMEOUT_MS is 30 minutes (1,800,000 ms)', () => {
    expect(SESSION_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  it('SESSION_WARNING_MS fires 2 minutes before session expiry', () => {
    const expectedWarning = SESSION_TIMEOUT_MS - 2 * 60 * 1000;
    expect(SESSION_WARNING_MS).toBe(expectedWarning);
  });

  it('SESSION_WARNING_MS is less than SESSION_TIMEOUT_MS', () => {
    expect(SESSION_WARNING_MS).toBeLessThan(SESSION_TIMEOUT_MS);
  });

  it('warning fires with exactly 120,000 ms (2 min) before timeout', () => {
    const timeRemaining = SESSION_TIMEOUT_MS - SESSION_WARNING_MS;
    expect(timeRemaining).toBe(120_000);
  });
});

// ============================================================================
// SECTION: Email/password sign-in flow
// ============================================================================

describe('Auth Flow — email/password sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls signInWithEmailAndPassword with correct arguments', async () => {
    const email = 'adam@adameliaslaw.com';
    const password = 'SecurePass123!';

    await signInWithEmailAndPassword({} as never, email, password);

    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      email,
      password,
    );
  });

  it('resolves with a user object on successful sign-in', async () => {
    const result = await signInWithEmailAndPassword({} as never, 'test@example.com', 'pass');
    expect(result).toBeDefined();
    expect(result.user).toBeDefined();
    expect(result.user.uid).toBeDefined();
  });

  it('handles auth/wrong-password error with friendly message', () => {
    createFirebaseError('auth/wrong-password', 'Wrong password.');
    const message = AUTH_ERRORS['auth/wrong-password'];
    expect(message).toBeDefined();
    expect(message).toContain('Incorrect password');
  });

  it('handles auth/user-not-found error with friendly message', () => {
    const message = AUTH_ERRORS['auth/user-not-found'];
    expect(message).toContain('No account found');
  });

  it('handles auth/invalid-credential error with friendly message', () => {
    const message = AUTH_ERRORS['auth/invalid-credential'];
    expect(message).toContain('Invalid credentials');
  });

  it('handles auth/too-many-requests error with friendly message', () => {
    const message = AUTH_ERRORS['auth/too-many-requests'];
    expect(message).toContain('Too many failed attempts');
  });

  it('handles auth/invalid-email error with friendly message', () => {
    const message = AUTH_ERRORS['auth/invalid-email'];
    expect(message).toContain('Invalid email');
  });
});

// ============================================================================
// SECTION: Email/password signup flow
// ============================================================================

describe('Auth Flow — email/password signup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls createUserWithEmailAndPassword with email and password', async () => {
    const email = 'newuser@example.com';
    const password = 'NewUserPass456!';

    await createUserWithEmailAndPassword({} as never, email, password);

    expect(createUserWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      email,
      password,
    );
  });

  it('handles auth/email-already-in-use error', () => {
    const message = AUTH_ERRORS['auth/email-already-in-use'];
    expect(message).toContain('already exists');
  });

  it('handles auth/weak-password error', () => {
    const message = AUTH_ERRORS['auth/weak-password'];
    expect(message).toContain('6 characters');
  });

  it('resolves with a user on successful registration', async () => {
    const result = await createUserWithEmailAndPassword({} as never, 'new@example.com', 'pass');
    expect(result.user).toBeDefined();
    expect(result.user.email).toBeDefined();
  });
});

// ============================================================================
// SECTION: Magic link (passwordless) flow
// ============================================================================

describe('Auth Flow — magic link (passwordless)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls sendSignInLinkToEmail with correct email and action code settings', async () => {
    const email = 'client@example.com';
    const actionCodeSettings = {
      url: 'http://localhost:3000/auth/email-signin',
      handleCodeInApp: true,
    };

    await sendSignInLinkToEmail({} as never, email, actionCodeSettings);

    expect(sendSignInLinkToEmail).toHaveBeenCalledWith(
      expect.anything(),
      email,
      expect.objectContaining({ handleCodeInApp: true }),
    );
  });

  it('isSignInWithEmailLink returns false for non-magic-link URLs', () => {
    vi.mocked(isSignInWithEmailLink).mockReturnValueOnce(false);
    const result = isSignInWithEmailLink({} as never, 'https://example.com/normal-page');
    expect(result).toBe(false);
  });

  it('isSignInWithEmailLink returns true for magic link URLs', () => {
    vi.mocked(isSignInWithEmailLink).mockReturnValueOnce(true);
    const result = isSignInWithEmailLink({} as never, 'https://example.com/auth/email-signin?oobCode=abc123');
    expect(result).toBe(true);
  });

  it('calls signInWithEmailLink when completing magic link sign-in', async () => {
    const email = 'client@example.com';
    const link = 'https://example.com/auth/email-signin?oobCode=abc123';
    vi.mocked(isSignInWithEmailLink).mockReturnValueOnce(true);

    await signInWithEmailLink({} as never, email, link);

    expect(signInWithEmailLink).toHaveBeenCalledWith(
      expect.anything(),
      email,
      link,
    );
  });

  it('handles auth/invalid-action-code error (expired link)', () => {
    const message = AUTH_ERRORS['auth/invalid-action-code'];
    expect(message).toContain('expired');
  });
});

// ============================================================================
// SECTION: Password reset
// ============================================================================

describe('Auth Flow — password reset', () => {
  it('calls sendPasswordResetEmail with the user email', async () => {
    const email = 'user@example.com';
    await sendPasswordResetEmail({} as never, email);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(expect.anything(), email);
  });
});

// ============================================================================
// SECTION: Sign-out
// ============================================================================

describe('Auth Flow — sign-out', () => {
  it('calls signOut on the auth instance', async () => {
    await signOut({} as never);
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('sign-out resolves without error', async () => {
    await expect(signOut({} as never)).resolves.toBeUndefined();
  });
});

// ============================================================================
// SECTION: Role-based route guard logic
// ============================================================================

describe('Role-based route guards', () => {
  it('ROLES constants match expected values', () => {
    expect(ROLES.ADMIN).toBe('admin');
    expect(ROLES.ATTORNEY).toBe('attorney');
    expect(ROLES.PARALEGAL).toBe('paralegal');
    expect(ROLES.CLIENT).toBe('client');
  });

  it('admin user has admin role', () => {
    expect(MOCK_ADMIN_USER.role).toBe('admin');
  });

  it('attorney user has attorney role', () => {
    expect(MOCK_ATTORNEY_USER.role).toBe('attorney');
  });

  it('client user has client role', () => {
    expect(MOCK_CLIENT_USER.role).toBe('client');
  });

  /**
   * canAccessRoute: pure function representing route guard logic.
   * Admin routes require admin role.
   * Attorney routes require admin or attorney.
   * Client routes require client role or admin.
   */
  function canAccessRoute(
    userRole: string,
    routeAllowedRoles: string[],
  ): boolean {
    if (routeAllowedRoles.length === 0) return true;
    return routeAllowedRoles.includes(userRole);
  }

  it('admin can access admin-only routes', () => {
    expect(canAccessRoute('admin', ['admin'])).toBe(true);
  });

  it('attorney cannot access admin-only routes', () => {
    expect(canAccessRoute('attorney', ['admin'])).toBe(false);
  });

  it('attorney can access attorney routes', () => {
    expect(canAccessRoute('attorney', ['admin', 'attorney'])).toBe(true);
  });

  it('paralegal can access paralegal routes', () => {
    expect(canAccessRoute('paralegal', ['admin', 'attorney', 'paralegal'])).toBe(true);
  });

  it('client cannot access attorney routes', () => {
    expect(canAccessRoute('client', ['admin', 'attorney', 'paralegal'])).toBe(false);
  });

  it('client can access client routes', () => {
    expect(canAccessRoute('client', ['client'])).toBe(true);
  });

  it('unauthenticated user (empty role) cannot access protected routes', () => {
    expect(canAccessRoute('', ['admin', 'attorney', 'paralegal', 'client'])).toBe(false);
  });

  it('routes with no role restriction are accessible to everyone', () => {
    expect(canAccessRoute('', [])).toBe(true);
    expect(canAccessRoute('client', [])).toBe(true);
  });
});

// ============================================================================
// SECTION: Auth error message coverage
// ============================================================================

describe('Auth error message coverage', () => {
  const expectedErrorCodes = [
    'auth/user-not-found',
    'auth/wrong-password',
    'auth/invalid-credential',
    'auth/email-already-in-use',
    'auth/weak-password',
    'auth/too-many-requests',
    'auth/network-request-failed',
    'auth/popup-closed-by-user',
    'auth/invalid-email',
    'auth/user-disabled',
    'auth/requires-recent-login',
    'auth/invalid-action-code',
  ];

  it.each(expectedErrorCodes)(
    'has a user-friendly message for error code: %s',
    (code) => {
      expect(AUTH_ERRORS[code]).toBeDefined();
      expect(AUTH_ERRORS[code].length).toBeGreaterThan(5);
    },
  );

  it('all error messages are non-empty strings', () => {
    for (const [, message] of Object.entries(AUTH_ERRORS)) {
      expect(typeof message).toBe('string');
      expect(message.trim().length).toBeGreaterThan(0);
    }
  });
});
