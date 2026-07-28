/**
 * functions/src/index.ts
 * Main entry point — initialises Firebase Admin and exports all Cloud Functions.
 */

// MUST be first: sets the 512MiB global memory default before any function
// module evaluates (v2 captures options at definition time).
import './global-options';

import * as admin from 'firebase-admin';

// Initialise the Admin SDK once for all functions in this deployment.
admin.initializeApp();

export { generateDocuments } from './generate-documents';
export { generateEstateDocument } from './generate-estate-document';
export { generateSingleDocument } from './generate-single-document';
export { reviewDocument } from './review-document';
export { generateFlexDocument } from './generate-flex-document';
export { exportDocumentPdf } from './export-pdf';
export { exportDocumentDocx } from './export-docx';
export { exportBatchDocuments } from './export-batch';
export { transcribeAudio, summarizeTranscription } from './transcribe-audio';
export { createPaymentRequest, lawpayWebhook, processDirectCharge } from './lawpay-integration';
export { pushEventToGoogleCalendar, pullGoogleCalendarEvents, syncGoogleCalendar, triggerFirmCalendarSync } from './calendar-sync';
export { checkDocumentCompliance } from './ai-compliance-check';
export { computeInheritanceTax } from './inheritance-tax-compute';
export {
  saveInheritanceMatter,
  computeAndStoreInheritanceTax,
  requestInheritanceReview,
  approveInheritanceReview,
  finalizeInheritanceReview,
  getInheritanceForm,
  getInheritanceCompanionForm,
  listInheritanceMatters,
  getInheritanceAuditTrail,
} from './inheritance-tax-review';
export {
  sendQuestionnaireInvitation,
  sendQuestionnaireCompleteNotification,
  sendDocumentReadyNotification,
  sendPaymentReceipt,
  sendPaymentReceivedNotification,
  sendAppointmentReminder,
  sendFollowUpReminder,
  onClientCreatedSendEmail,
  testSendGridConnection,
} from './email-notifications';
export { logAccess, onDocumentStatusChanged, onPaymentCreated } from './audit-trail';
export { chatAi, listAiConversations, saveMessageAsNote } from './chat-ai';
export { syncClientToLevitate } from './levitate-sync';
export { sendForSignature, dropboxSignWebhook } from './esign-service';
export { processQuestionnaireScan } from './process-ocr';
export { getFirmBranding } from './branding';
export { exchangeGoogleAuthCode, disconnectGoogleCalendar } from './google-auth';
export { linkClient } from './link-client';
export { createFirmUser, updateUserCapabilities } from './user-management';
export { updateFirmApiKeys, migrateFirmApiKeysToSecrets } from './firm-settings';

// Phase 7: Knowledge Base & Template Engine
export { addKnowledgeResource, updateKnowledgeResource, deleteKnowledgeResource, searchKnowledgeResources, bulkImportKnowledgeResources, analyzeKnowledgeContent } from './knowledge-base';
export { uploadTemplate, deleteTemplate, listTemplates, getTemplateContent } from './seed-templates';
export { seedKnowledgeBase } from './seed-knowledge-base';
export { processTemplateFile, recordTemplateCorrection, confirmTemplateVariables, consolidateTemplateVariables } from './process-template-file';
export { retemplatizeTemplates } from './retemplatize-templates';
export { bulkProcessKnowledgeFiles } from './bulk-knowledge-import';
// backfillEmbeddings & backfillTemplateEmbeddings are in functions-backfill codebase (lightweight entry point avoids OOM)
export { onKnowledgeResourceWritten, onTemplateWritten } from './kb-embeddings';
export { getDocumentVersions, getDocumentVersionContent, revertDocumentVersion } from './document-versions';
export { enhanceTemplate } from './enhance-template';
export { connectGoogleDrive, disconnectGoogleDrive, onDocumentWrittenSyncToDrive } from './google-drive-sync';
export { lookupPropertyData } from './property-data';
export { groundedReviewDocument } from './grounded-review';
export { estimateGenerationCost } from './cost-estimator';
export { cleanupTemplates } from './cleanup-templates';
export { sendWeeklyDigest } from './weekly-digest';

// Wills ingestion pipeline
export { willsProcessor } from './wills-processor';
export { willsDriveWebhook, willsDriveWatchRenew, willsSetupDriveWatch } from './wills-drive-watcher';
export { willsStartBackfill } from './wills-backfill';
export { willsPilotRun } from './wills-pilot';

export { registerClientFromLink } from './register-client';
export { createClientRegistrationLink } from './create-registration-link';
export { fileTranscriptToMatter } from './file-transcript-to-matter';
export { summarizePendingTranscript } from './summarize-pending-transcript';
