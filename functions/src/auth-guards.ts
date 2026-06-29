/**
 * functions/src/auth-guards.ts
 *
 * Shared authorization guards for callable functions.
 *
 * Why this exists (audit theme T6): a `client`-role session carries a real
 * `firmId` claim (set by linkClient alongside role:'client'), so it PASSES any
 * check that only verifies `firmId`. Staff-only callables that relied on
 * firm-scoping alone were therefore reachable by clients (read other clients'
 * documents/AI data, overwrite firm OAuth tokens, burn AI quota, etc.).
 * `assertStaff` adds the missing role gate; `assertFirmStaff` also enforces the
 * tenant boundary against a requested firmId.
 */

import { HttpsError, CallableRequest } from 'firebase-functions/v2/https';

/** Roles permitted to perform staff operations. Excludes `client`. */
export const STAFF_ROLES: readonly string[] = ['admin', 'attorney', 'paralegal'];

export interface CallerContext {
  uid: string;
  role: string;
  firmId: string | undefined;
}

/**
 * Require an authenticated staff caller (admin/attorney/paralegal).
 * Throws `unauthenticated` if not signed in, `permission-denied` if the role
 * claim is missing or is `client` (or anything outside STAFF_ROLES).
 * Returns the caller's uid/role/firmId for downstream use.
 */
export function assertStaff(request: CallableRequest<unknown>): CallerContext {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const role = request.auth.token.role as string | undefined;
  if (!role || !STAFF_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Staff access is required for this operation.');
  }
  return {
    uid: request.auth.uid,
    role,
    firmId: request.auth.token.firmId as string | undefined,
  };
}

/**
 * Require a staff caller whose firm claim matches `firmId`. Combines the role
 * gate (assertStaff) with the tenant boundary (`callerFirmId === firmId`) — use
 * on staff callables that take a `firmId` argument.
 */
export function assertFirmStaff(
  request: CallableRequest<unknown>,
  firmId: string,
): CallerContext {
  const ctx = assertStaff(request);
  if (!ctx.firmId || ctx.firmId !== firmId) {
    throw new HttpsError('permission-denied', 'Cross-firm access is not permitted.');
  }
  return ctx;
}
