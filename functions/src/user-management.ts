import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

import {
  getFirmData,
  getSendGridKey,
  extractBranding,
  buildEmailHtml,
  ctaButton,
  sendViaSendGrid,
} from './email-notifications';

interface CreateFirmUserRequest {
  firmId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'attorney' | 'paralegal' | 'staff';
}

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

    const { firmId, email, firstName, lastName, role } = request.data as CreateFirmUserRequest;

    if (!firmId || !email || !firstName || !lastName || !role) {
      throw new HttpsError('invalid-argument', 'Missing required fields: firmId, email, firstName, lastName, role.');
    }

    const callerUid = request.auth.uid;
    const db = admin.firestore();
    const callerProfileSnap = await db.doc(`users/${callerUid}`).get();

    if (!callerProfileSnap.exists) {
      throw new HttpsError('permission-denied', 'Caller profile not found.');
    }

    const callerData = callerProfileSnap.data()!;
    
    // Authorization: Must belong to the same firm, and must be an admin.
    if (callerData.firmId !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot create users for a different firm.');
    }
    if (callerData.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only firm administrators can create new users.');
    }

    const auth = admin.auth();
    let newUserId = '';

    try {
      // 1. Create the user in Firebase Auth without a password.
      const userRecord = await auth.createUser({
        email,
        displayName: `${firstName} ${lastName}`.trim(),
      });
      newUserId = userRecord.uid;

      // 2. Set custom claims for RBAC in rules and front-end
      await auth.setCustomUserClaims(newUserId, { firmId, role });

      // 3. Create user profile in Firestore
      await db.doc(`users/${newUserId}`).set({
        email,
        firstName,
        lastName,
        role,
        firmId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isActive: true,
      });

      // 4. Generate password reset link to be sent via email
      const resetLink = await auth.generatePasswordResetLink(email);

      // 5. Send Welcome Email via SendGrid
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
<h2 style="margin:0 0 16px;font-size:22px;color:#1a202c;">Welcome, ${firstName}!</h2>
<p style="margin:0 0 12px;">
  An account has been created for you at <strong>${branding.firmName}</strong>. 
  To get started, please set your password by clicking the button below:
</p>
${ctaButton('Set Your Password', resetLink, branding.primaryColor)}
<p style="margin:24px 0 0;font-size:13px;color:#718096;">
  If the button does not work, copy and paste this link into your browser:<br />
  <a href="${resetLink}" style="color:${branding.primaryColor};word-break:break-all;">${resetLink}</a>
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
    } catch (error: unknown) {
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
  }
);
