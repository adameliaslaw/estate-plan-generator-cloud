/**
 * functions/src/index.ts
 *
 * Entry point — initializes firebase-admin and re-exports all Cloud Functions.
 */

import * as admin from 'firebase-admin';

// firebase-functions/v1 (used by v1 functions) auto-initializes the admin SDK,
// but we call it explicitly so v2 functions also share the same app instance.
if (!admin.apps.length) {
  admin.initializeApp();
}

// Health check
export { healthCheck } from './health';

// Auth triggers
export { onUserCreate } from './on-user-create';
export { setUserClaims, linkClient } from './custom-claims';
export { acceptInvitation } from './accept-invitation';

// Questionnaire processing
export { processQuestionnaire } from './questionnaire-processor';

// Document generation (Create Documents tab)
export { generateDocuments } from './document-generator';

// Single-document generation (legacy path)
export { generateDocument } from './generate-document';

// Document status cascade (status-updater)
export { onDocumentStatusChange } from './status-updater';

// Timeline triggers (timeline-tracker)
export { onDocumentCreatedTimeline } from './timeline-tracker';

// Document expiry checker (scheduled)
export { checkDocumentExpiry } from './expiry-checker';

// Communications — SendGrid email (scheduled digests, notification triggers)
export {
  sendDailyDigest,
  sendDocumentSignedEmail,
  onMessageCreated,
} from './email-service';

// Communications — Levitate (delayed) sync (scheduled)
export { syncToLevitate } from './levitate-sync';

// Calendar — Google Calendar API v3 (sync functions)
export {
  pushEventToGoogleCalendar,
  pullGoogleCalendarEvents,
  syncGoogleCalendar,
  triggerFirmCalendarSync,
} from './calendar-sync';

// OAuth (Firebase Callable)
export { exchangeGoogleAuthCode, disconnectGoogleCalendar } from './google-auth';

// Team — invite member (callable)
export { inviteTeamMember } from './invite-team-member';

// Wills — Google Drive import pipeline (onCall + onSchedule)
export {
  scanWillsDrive,
  processWillsFolder,
  processAllWillsFolders,
} from './wills-drive-watcher';

// PDF exports
export { exportDocumentPdf } from './export-pdf';
export { exportBatchPdf } from './export-batch';

// E-signature
export { generateEsignPackage } from './esign-service';

// Payments — LawPay / AffiniPay
export { createPaymentRequest, lawpayWebhook, processDirectCharge } from './lawpay-integration';

// Scanned handwritten questionnaire → Firestore (vision-extractor + onCall)
export { processScannedQuestionnaire, onScanUploaded } from './scan-processor';

// Knowledge-base indexer (Firestore triggers + scheduled)
export {
  onKnowledgeFileWritten,
  onPromptTemplateWritten,
  onJurisdictionRuleWritten,
  onTaxRuleWritten,
  indexKnowledgeBase,
} from './knowledge-indexer';

// Client intake processor (Firestore trigger on client creation)
export { onClientCreated } from './intake-processor';

// Vault → Google Drive sync (onCall + Firestore trigger)
export { connectGoogleDrive, disconnectGoogleDrive, onDocumentWrittenSyncToDrive } from './google-drive-sync';

// Firm-level AI provider & API-key settings (callable)
export { updateFirmApiKeys, migrateFirmApiKeysToSecrets } from './firm-settings';
