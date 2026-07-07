import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { z } from 'zod';

import {
  getFirmData,
  getSendGridKey,
  extractBranding,
  buildEmailHtml,
  ctaButton,
  sendViaSendGrid,
  escapeHtml,
} from './email-notifications';

// The only capabilities firestore.rules / usePermissions honor. Anything else is
// rejected so a caller can't write bogus or future-privileged claims (AP/AQ).
const ALLOWED_CAPABILITIES: readonly string[] = [
  'manage_users',
  'manage_billing',
  'manage_firm_settings',
  'manage_clients',
  'manage_documents',
];

// Length caps + shape validation at the callable boundary (finding T9). The
// role enum rejects anything other than admin/attorney/paralegal (notably the
// legacy 'staff' role firestore.rules doesn't recognize — finding AV); the
// capabilities allowlist is still enforced separately below (zod caps
// length/structure, not membership).
const CreateFirmUserSchema = z.object({
  firmId: z.string().min(1).max(200),
  email: z.string().email().max(320),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: z.enum(['admin', 'attorney', 'paralegal']),
  capabilities: z.array(z.string().max(100)).max(20).optional(),
});

/**
 * Creates a new user in Firebase Auth, assigns custom claims, creates a Firestore profile,
 * and sends an email via SendGrid with a password reset link to complete setup.
 */
export const createFirmUser = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request: CallableRequest) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to create users.');
    }

    const parsed = CreateFirmUserSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Missing or invalid fields: firmId, email, firstName, lastName, role.');
    }
    const { firmId, email, firstName, lastName, role, capabilities } = parsed.data;

    if (capabilities && !capabilities.every((c) => ALLOWED_CAPABILITIES.includes(c))) {
      throw new HttpsError('invalid-argument', 'capabilities contains an unrecognized value.');
    }

    const callerUid = request.auth.uid;
    const db = admin.firestore();
    
    let callerData: admin.firestore.DocumentData | undefined;
    const callerProfileSnap = await db.doc(`firms/${firmId}/users/${callerUid}`).get();

    if (callerProfileSnap.exists) {
      callerData = callerProfileSnap.data();
    } else {
      // Fallback to legacy root users collection
      const legacyProfileSnap = await db.doc(`users/${callerUid}`).get();
      if (legacyProfileSnap.exists) {
        callerData = legacyProfileSnap.data();
      } else {
        // Ultimate fallback: check custom claims on the token
        const tokenRole = request.auth.token.role;
        const tokenFirmId = request.auth.token.firmId;
        
        if (tokenRole && tokenFirmId) {
          callerData = { role: tokenRole, firmId: tokenFirmId };
        } else {
          throw new HttpsError('permission-denied', 'Caller profile not found and token lacks claims.');
        }
      }
    }

    const effectiveCallerFirmId = callerData?.firmId || callerData?.firm_id; // in case of snake_case legacy
    const callerRole = callerData?.role as string | undefined;

    // Authorization: same firm + user-management privilege. Admins and attorneys
    // may create users; paralegals may not (matches #43 / firestore.rules
    // canManageUsers — paralegals are scoped to notes/calendar/documents).
    if (effectiveCallerFirmId !== firmId) {
      throw new HttpsError('permission-denied', `Cannot create users for a different firm. (Caller Firm: ${effectiveCallerFirmId})`);
    }
    if (callerRole !== 'admin' && callerRole !== 'attorney') {
      throw new HttpsError('permission-denied', 'Only an admin or attorney can create users.');
    }
    // Only an admin may mint another admin (finding AP). Previously any staff
    // caller could create role:'admin' for an address they control, and because
    // firestore.rules isAdmin() bypasses belongsToFirm(), that admin could read
    // every firm's client data — a cross-tenant breach.
    if (role === 'admin' && callerRole !== 'admin') {
      throw new HttpsError('permission-denied', 'Only an admin can grant the admin role.');
    }

    const auth = admin.auth();
    let newUserId = '';
    let userCreated = false;

    // ── Critical path: create + claims + profile ───────────────────────────
    // These three must all succeed for a usable account. If any fails after the
    // Auth user is created, roll it back so it isn't orphaned (no claims / no
    // profile) with every retry then failing 'already-exists'. (R5-052)
    try {
      // 1. Create the user in Firebase Auth without a password.
      const userRecord = await auth.createUser({
        email,
        displayName: `${firstName} ${lastName}`.trim(),
      });
      newUserId = userRecord.uid;
      userCreated = true;

      // 2. Set custom claims for RBAC in rules and front-end
      await auth.setCustomUserClaims(newUserId, { firmId, role, capabilities: capabilities || [] });

      // 3. Create user profile in Firestore
      await db.doc(`firms/${firmId}/users/${newUserId}`).set({
        email,
        firstName,
        lastName,
        role,
        customCapabilities: capabilities || [],
        firmId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isActive: true,
      });
    } catch (error: unknown) {
      // Roll back only the user THIS call created (createUser itself failing —
      // e.g. already-exists — leaves userCreated false, so we never delete a
      // pre-existing account).
      if (userCreated && newUserId) {
        try {
          await auth.deleteUser(newUserId);
          logger.warn(`[createFirmUser] Rolled back orphaned auth user ${newUserId} after a post-create failure.`);
        } catch (cleanupErr) {
          logger.error(`[createFirmUser] Rollback failed for ${newUserId} — manual cleanup may be needed.`, cleanupErr);
        }
      }
      if (error instanceof Error) {
        logger.error(`[createFirmUser] Error creating user: ${error.message}`, error);
        if ((error as { code?: string }).code === 'auth/email-already-exists') {
          throw new HttpsError('already-exists', 'The email address is already in use by another account.');
        }
        throw new HttpsError('internal', `Failed to create user: ${error.message}`);
      }
      logger.error(`[createFirmUser] Unknown error creating user`, error);
      throw new HttpsError('internal', `Failed to create user.`);
    }

    // ── Non-critical path: invitation email ────────────────────────────────
    // The user is fully created, claimed, and profiled at this point. An email
    // failure must NOT fail the whole operation — otherwise the caller retries
    // into 'already-exists' against a now-valid user. Return success + a warning.
    try {
      const resetLink = await auth.generatePasswordResetLink(email);

      const firmData = await getFirmData(firmId);
      let apiKey = '';
      try {
        apiKey = getSendGridKey(firmData);
      } catch (_err) {
        logger.warn(`SendGrid API key missing for firm ${firmId}. User created but email not sent.`);
        return { success: true, uid: newUserId, warning: 'User created successfully, but SendGrid API key is not configured so the invitation email was not sent.' };
      }

      const branding = extractBranding(firmData);
      const subject = `Welcome to ${branding.firmName} - Account Setup`;
      const bodyHtml = `
<h2 style="margin:0 0 16px;font-size:22px;color:#1a202c;">Welcome, ${escapeHtml(firstName)}!</h2>
<p style="margin:0 0 12px;">
  An account has been created for you at <strong>${branding.firmName}</strong>.
  To get started, please set your password by clicking the button below:
</p>
${ctaButton('Set Your Password', resetLink, branding.primaryColor)}
<p style="margin:24px 0 0;font-size:13px;color:#718096;">
  If the button does not work, copy and paste this link into your browser:<br />
  <a href="${escapeHtml(resetLink)}" style="color:${branding.primaryColor};word-break:break-all;">${escapeHtml(resetLink)}</a>
</p>
<p style="margin:16px 0 0;font-size:13px;color:#718096;">
  If you have any questions, please contact your firm administrator.
</p>`;

      const html = buildEmailHtml(bodyHtml, branding, 'Set up your account password to get started.');

      await sendViaSendGrid(apiKey, {
        personalizations: [{ to: [{ email, name: `${firstName} ${lastName}` }], subject }],
        from: { email: branding.firmEmail || 'noreply@estateplan.app', name: branding.firmName },
        content: [{ type: 'text/html', value: html }],
      });

      logger.info(`[createFirmUser] Successfully created user ${email} and sent invite.`);

      return { success: true, uid: newUserId };
    } catch (emailErr: unknown) {
      logger.error(`[createFirmUser] User ${newUserId} created but the invitation email failed to send.`, emailErr);
      return { success: true, uid: newUserId, warning: 'User created successfully, but the invitation email could not be sent. Send them a password reset to finish setup.' };
    }
  }
);

const UpdateUserCapabilitiesSchema = z.object({
  firmId: z.string().min(1).max(200),
  userId: z.string().min(1).max(200),
  capabilities: z.array(z.string().max(100)).max(20),
});

/**
 * Updates an existing user's capabilities.
 * Must be requested by a Firm Administrator.
 */
export const updateUserCapabilities = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request: CallableRequest) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to update users.');
    }

    const parsed = UpdateUserCapabilitiesSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Missing or invalid fields: firmId, userId, capabilities.');
    }
    const { firmId, userId, capabilities } = parsed.data;

    const callerUid = request.auth.uid;
    const db = admin.firestore();

    let callerData: admin.firestore.DocumentData | undefined;
    const callerProfileSnap = await db.doc(`firms/${firmId}/users/${callerUid}`).get();

    if (callerProfileSnap.exists) {
      callerData = callerProfileSnap.data();
    } else {
      const legacyProfileSnap = await db.doc(`users/${callerUid}`).get();
      if (legacyProfileSnap.exists) {
        callerData = legacyProfileSnap.data();
      } else {
        const tokenRole = request.auth.token.role;
        const tokenFirmId = request.auth.token.firmId;
        if (tokenRole && tokenFirmId) {
          callerData = { role: tokenRole, firmId: tokenFirmId };
        } else {
          throw new HttpsError('permission-denied', 'Caller profile not found and token lacks claims.');
        }
      }
    }

    const effectiveCallerFirmId = callerData?.firmId || callerData?.firm_id;

    if (effectiveCallerFirmId !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot update users for a different firm.');
    }
    // Admin-only. Capability writes are a direct escalation vector (finding AQ):
    // previously any staff caller could grant arbitrary capabilities to anyone
    // in the firm — including themselves — e.g. manage_users → then mint an admin.
    if (callerData?.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only an admin can update user capabilities.');
    }
    // Reject capabilities outside the known allowlist.
    if (!capabilities.every((c) => ALLOWED_CAPABILITIES.includes(c))) {
      throw new HttpsError('invalid-argument', 'capabilities contains an unrecognized value.');
    }

    try {
      const auth = admin.auth();
      const userRecord = await auth.getUser(userId);

      // Verify the target user belongs to the same firm as the caller
      const targetClaims = userRecord.customClaims || {};
      if (targetClaims['firmId'] !== firmId) {
        throw new HttpsError('permission-denied', 'Cannot update capabilities for a user in a different firm.');
      }

      // Preserve existing custom claims (like firmId, role) while updating capabilities
      const currentClaims = userRecord.customClaims || {};
      const newClaims = {
        ...currentClaims,
        capabilities,
      };

      await auth.setCustomUserClaims(userId, newClaims);

      // Also update the Firestore profile
      await db.doc(`firms/${firmId}/users/${userId}`).update({
        customCapabilities: capabilities,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`[updateUserCapabilities] Successfully updated capabilities for user ${userId}.`);

      return { success: true };
    } catch (error: unknown) {
      logger.error(`[updateUserCapabilities] Error updating user`, error);
      throw new HttpsError('internal', `Failed to update user capabilities.`);
    }
  }
);
