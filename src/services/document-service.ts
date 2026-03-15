/**
 * document-service.ts
 *
 * Frontend service layer for calling Cloud Functions that handle document
 * generation, AI review, and flex document creation.
 */

import { functions } from '@/config/firebase';
import { httpsCallable } from 'firebase/functions';

// ── Request / response shapes ─────────────────────────────────────────────────

export interface GenerateDocumentsRequest {
  firmId: string;
  clientId: string;
  packageType: 'foundation' | 'guardian' | 'fortress';
  trustTypes?: string[];
  generationMode?: 'template' | 'ai' | 'hybrid';
  softwareSource?: string;
}

export interface GenerateDocumentsResponse {
  success: boolean;
  documentsGenerated: number;
  results: Array<{ docType: string; title: string; status: string }>;
}

export interface RegenerateDocumentRequest {
  firmId: string;
  clientId: string;
  docType: string;
  customInstructions?: string;
}

export interface RegenerateDocumentResponse {
  success: boolean;
  docType: string;
  title: string;
  status: string;
  documentId: string;
}

export interface ReviewDocumentRequest {
  firmId: string;
  clientId: string;
  documentId: string;
}

export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor' | 'info';
  location: string;
  description: string;
  suggestion: string;
}

export interface ReviewDocumentResponse {
  success: boolean;
  overallAssessment: string;
  issues: ReviewIssue[];
  suggestions: string[];
  complianceNotes: string[];
  reviewedAt: string;
}

export interface GenerateFlexDocumentRequest {
  firmId: string;
  clientId: string;
  docType: string;
  customPrompt?: string;
}

export interface GenerateFlexDocumentResponse {
  success: boolean;
  docType: string;
  title: string;
  documentId: string;
  status: string;
}

// ── Export request / response shapes ─────────────────────────────────────────

export interface ExportDocumentRequest {
  firmId: string;
  clientId: string;
  documentId: string;
}

export interface ExportDocumentResponse {
  success: boolean;
  downloadUrl: string;
  fileName: string;
  storagePath: string;
}

export interface ExportBatchRequest {
  firmId: string;
  clientId: string;
  format: 'pdf' | 'docx' | 'both';
}

export interface ExportBatchResponse {
  success: boolean;
  downloadUrl: string;
  fileName: string;
  storagePath: string;
  documentCount: number;
  format: 'pdf' | 'docx' | 'both';
}

export interface SendForSignatureRequest {
  firmId: string;
  clientId: string;
  documentId: string;
  signerName: string;
  signerEmail: string;
}

export interface SendForSignatureResponse {
  success: boolean;
  signatureRequestId: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const documentService = {
  /**
   * Call the generateDocuments Cloud Function to bulk-generate all documents
   * for a client's selected package.
   */
  async generateAll(params: GenerateDocumentsRequest): Promise<GenerateDocumentsResponse> {
    const fn = httpsCallable<GenerateDocumentsRequest, GenerateDocumentsResponse>(
      functions,
      'generateDocuments',
    );
    const result = await fn(params);
    return result.data;
  },

  /**
   * Regenerate a single document, optionally with custom instructions.
   */
  async regenerateDocument(params: RegenerateDocumentRequest): Promise<RegenerateDocumentResponse> {
    const fn = httpsCallable<RegenerateDocumentRequest, RegenerateDocumentResponse>(
      functions,
      'generateSingleDocument',
    );
    const result = await fn(params);
    return result.data;
  },

  /**
   * Run AI review on a specific document.
   * Returns structured issues, suggestions, and compliance notes.
   */
  async reviewDocument(params: ReviewDocumentRequest): Promise<ReviewDocumentResponse> {
    const fn = httpsCallable<ReviewDocumentRequest, ReviewDocumentResponse>(
      functions,
      'reviewDocument',
    );
    const result = await fn(params);
    return result.data;
  },

  /**
   * Generate a flex/ad-hoc document such as an engagement letter, cover letter,
   * invoice, trust amendment, etc.
   */
  async generateFlexDocument(
    params: GenerateFlexDocumentRequest,
  ): Promise<GenerateFlexDocumentResponse> {
    const fn = httpsCallable<GenerateFlexDocumentRequest, GenerateFlexDocumentResponse>(
      functions,
      'generateFlexDocument',
    );
    const result = await fn(params);
    return result.data;
  },

  /**
   * Export a single document as a PDF.
   * The Cloud Function renders the HTML via Puppeteer and returns a
   * signed Cloud Storage URL valid for 1 hour.
   */
  async exportPdf(
    params: ExportDocumentRequest,
  ): Promise<ExportDocumentResponse> {
    const fn = httpsCallable<ExportDocumentRequest, ExportDocumentResponse>(
      functions,
      'exportDocumentPdf',
    );
    const result = await fn(params);
    return result.data;
  },

  /**
   * Export a single document as a DOCX file.
   * The Cloud Function converts the stored HTML to a Word-compatible document
   * and returns a signed Cloud Storage URL valid for 1 hour.
   */
  async exportDocx(
    params: ExportDocumentRequest,
  ): Promise<ExportDocumentResponse> {
    const fn = httpsCallable<ExportDocumentRequest, ExportDocumentResponse>(
      functions,
      'exportDocumentDocx',
    );
    const result = await fn(params);
    return result.data;
  },

  /**
   * Export all documents for a client as a ZIP archive.
   * format: 'pdf' | 'docx' | 'both'
   * Returns a signed Cloud Storage URL valid for 1 hour.
   */
  async exportBatch(
    params: ExportBatchRequest,
  ): Promise<ExportBatchResponse> {
    const fn = httpsCallable<ExportBatchRequest, ExportBatchResponse>(
      functions,
      'exportBatchDocuments',
    );
    const result = await fn(params);
    return result.data;
  },

  // ── Phase 5: E-Signature ──────────────────────────────────────────────────

  /**
   * Send a document out for e-signature via Dropbox Sign (HelloSign) or similar provider.
   */
  async sendForSignature(
    params: SendForSignatureRequest,
  ): Promise<SendForSignatureResponse> {
    const fn = httpsCallable<SendForSignatureRequest, SendForSignatureResponse>(
      functions,
      'sendForSignature',
    );
    const result = await fn(params);
    return result.data;
  },

  // ── Phase 5: Audio Transcription ──────────────────────────────────────────

  /**
   * Transcribe an audio file stored in Cloud Storage using OpenAI Whisper.
   * The note document must already have an `audioUrl` (storage path) set.
   */
  async transcribeAudio(params: {
    firmId: string;
    clientId: string;
    noteId: string;
    storagePath: string;
  }): Promise<{ transcription: string }> {
    const fn = httpsCallable<typeof params, { transcription: string }>(
      functions,
      'transcribeAudio',
    );
    const result = await fn(params);
    return result.data;
  },

  /**
   * Generate an AI summary of a completed transcription.
   */
  async summarizeTranscription(params: {
    firmId: string;
    clientId: string;
    noteId: string;
  }): Promise<{ summary: string }> {
    const fn = httpsCallable<typeof params, { summary: string }>(
      functions,
      'summarizeTranscription',
    );
    const result = await fn(params);
    return result.data;
  },

  // ── Phase 5: LawPay Integration ───────────────────────────────────────────

  /**
   * Create a LawPay payment request and return the payment URL.
   */
  async createPaymentRequest(params: {
    firmId: string;
    clientId: string;
    amount: number;
    description: string;
    accountDesignation: 'operating' | 'trust';
    clientEmail: string;
    clientName: string;
  }): Promise<{ paymentUrl: string; transactionId: string; paymentDocId: string }> {
    const fn = httpsCallable<typeof params, { paymentUrl: string; transactionId: string; paymentDocId: string }>(
      functions,
      'createPaymentRequest',
    );
    const result = await fn(params);
    return result.data;
  },

  // ── Phase 5: Google Calendar Sync ─────────────────────────────────────────

  /**
   * Push a calendar event to Google Calendar.
   */
  async pushEventToGoogleCalendar(params: {
    firmId: string;
    eventId: string;
  }): Promise<{ googleCalendarEventId: string }> {
    const fn = httpsCallable<typeof params, { googleCalendarEventId: string }>(
      functions,
      'pushEventToGoogleCalendar',
    );
    const result = await fn(params);
    return result.data;
  },

  /**
   * Pull events from Google Calendar matching a client name.
   */
  async pullGoogleCalendarEvents(params: {
    firmId: string;
    clientName: string;
    timeMin?: string;
    timeMax?: string;
  }): Promise<{ imported: number; skipped: number }> {
    const fn = httpsCallable<typeof params, { imported: number; skipped: number }>(
      functions,
      'pullGoogleCalendarEvents',
    );
    const result = await fn(params);
    return result.data;
  },

  // ── Phase 6: AI Compliance Check ───────────────────────────────────────────

  /**
   * Run an AI compliance check on a generated document.
   */
  async checkDocumentCompliance(params: {
    firmId: string;
    clientId: string;
    documentId: string;
  }): Promise<{
    findings: Array<{ item: string; status: 'pass' | 'warning' | 'fail'; statute?: string; detail: string }>;
    overallStatus: 'pass' | 'needs_review' | 'fail';
  }> {
    const fn = httpsCallable<typeof params, {
      findings: Array<{ item: string; status: 'pass' | 'warning' | 'fail'; statute?: string; detail: string }>;
      overallStatus: 'pass' | 'needs_review' | 'fail';
    }>(functions, 'checkDocumentCompliance');
    const result = await fn(params);
    return result.data;
  },

  // ── Phase 6: Email Notifications ───────────────────────────────────────────

  async sendQuestionnaireInvitation(params: {
    firmId: string;
    clientId: string;
    clientEmail: string;
    clientName: string;
    questionnaireUrl: string;
  }): Promise<{ success: boolean }> {
    const fn = httpsCallable<typeof params, { success: boolean }>(
      functions,
      'sendQuestionnaireInvitation',
    );
    const result = await fn(params);
    return result.data;
  },

  async sendQuestionnaireCompleteNotification(params: {
    firmId: string;
    clientId: string;
    clientName: string;
    attorneyEmail: string;
  }): Promise<{ success: boolean }> {
    const fn = httpsCallable<typeof params, { success: boolean }>(
      functions,
      'sendQuestionnaireCompleteNotification',
    );
    const result = await fn(params);
    return result.data;
  },

  async sendAppointmentReminder(params: {
    firmId: string;
    clientId: string;
    recipientEmail: string;
    recipientName: string;
    eventTitle: string;
    eventDate: string;
    eventTime: string;
    location: string;
  }): Promise<{ success: boolean }> {
    const fn = httpsCallable<typeof params, { success: boolean }>(
      functions,
      'sendAppointmentReminder',
    );
    const result = await fn(params);
    return result.data;
  },

  // ── Phase 6: Audit Trail ───────────────────────────────────────────────────

  async logAccess(params: {
    firmId: string;
    clientId: string;
    clientName: string;
    action: string;
  }): Promise<{ success: boolean }> {
    const fn = httpsCallable<typeof params, { success: boolean }>(
      functions,
      'logAccess',
    );
    const result = await fn(params);
    return result.data;
  },

  // ── Version Management ──────────────────────────────────────────────────────

  async getDocumentVersions(params: {
    firmId: string;
    clientId: string;
    documentId: string;
  }): Promise<{
    success: boolean;
    documentId: string;
    versions: Array<{
      versionNumber: number;
      displayName: string;
      status: string;
      changeNotes: string;
      createdBy: string;
      createdAt: string | null;
      contentPreview: string;
      hasFullContent: boolean;
    }>;
  }> {
    const fn = httpsCallable<typeof params, ReturnType<typeof this.getDocumentVersions> extends Promise<infer T> ? T : never>(
      functions,
      'getDocumentVersions',
    );
    const result = await fn(params);
    return result.data;
  },

  async getDocumentVersionContent(params: {
    firmId: string;
    clientId: string;
    documentId: string;
    versionNumber: number;
  }): Promise<{
    success: boolean;
    versionNumber: number;
    content: string;
    displayName: string;
    changeNotes: string;
    createdBy: string;
    createdAt: string | null;
  }> {
    const fn = httpsCallable<typeof params, ReturnType<typeof this.getDocumentVersionContent> extends Promise<infer T> ? T : never>(
      functions,
      'getDocumentVersionContent',
    );
    const result = await fn(params);
    return result.data;
  },

  async revertDocumentVersion(params: {
    firmId: string;
    clientId: string;
    documentId: string;
    targetVersion: number;
  }): Promise<{
    success: boolean;
    documentId: string;
    restoredVersion: number;
    newVersion: number;
    message: string;
  }> {
    const fn = httpsCallable<typeof params, ReturnType<typeof this.revertDocumentVersion> extends Promise<infer T> ? T : never>(
      functions,
      'revertDocumentVersion',
    );
    const result = await fn(params);
    return result.data;
  },
};
