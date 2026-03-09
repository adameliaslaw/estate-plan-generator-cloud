/**
 * functions/src/index.ts
 * Main entry point — initialises Firebase Admin and exports all Cloud Functions.
 */

import * as admin from 'firebase-admin';

// Initialise the Admin SDK once for all functions in this deployment.
admin.initializeApp();

export { generateDocuments } from './generate-documents';
export { generateSingleDocument } from './generate-single-document';
export { reviewDocument } from './review-document';
export { generateFlexDocument } from './generate-flex-document';
export { exportDocumentPdf } from './export-pdf';
export { exportDocumentDocx } from './export-docx';
export { exportBatchDocuments } from './export-batch';
export { transcribeAudio, summarizeTranscription } from './transcribe-audio';
export { createPaymentRequest, lawpayWebhook } from './lawpay-integration';
export { pushEventToGoogleCalendar, pullGoogleCalendarEvents, syncGoogleCalendar, triggerFirmCalendarSync } from './calendar-sync';
export { checkDocumentCompliance } from './ai-compliance-check';
export {
  sendQuestionnaireInvitation,
  sendQuestionnaireCompleteNotification,
  sendDocumentReadyNotification,
  sendPaymentReceipt,
  sendPaymentReceivedNotification,
  sendAppointmentReminder,
  sendFollowUpReminder,
  onClientCreatedSendEmail,
} from './email-notifications';
export { logAccess, onDocumentStatusChanged, onPaymentCreated } from './audit-trail';
export { chatAi } from './chat-ai';
export { syncClientToLevitate } from './levitate-sync';
export { sendForSignature } from './esign-service';
export { processQuestionnaireScan } from './process-ocr';
export { getFirmBranding } from './branding';
export { exchangeGoogleAuthCode } from './google-auth';
export { linkClient } from './link-client';
