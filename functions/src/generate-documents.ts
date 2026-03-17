/**
 * functions/src/generate-documents.ts
 *
 * Batch document generation — callable Cloud Function.
 * Called when an attorney clicks "Generate Documents" in the UI.
 *
 * This is a THIN WRAPPER around the unified generator. All actual
 * generation, save, and context logic lives in unified-generator.ts.
 */

import * as functions from 'firebase-functions';
const { HttpsError } = functions.https;
import * as admin from 'firebase-admin';

import { GenerationMode } from './template-engine';
import {
  generateDocumentWithPropertyExpansion,
  getDocTypeDisplayName,
  UnifiedGenerateResult,
} from './unified-generator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GenerateRequest {
  firmId: string;
  clientId: string;
  packageType: 'foundation' | 'guardian' | 'fortress';
  trustTypes?: string[];
  generationMode?: GenerationMode;
  /** Optional model override (e.g. 'gpt-5.4', 'claude-sonnet-4-6') */
  modelOverride?: string;
  /** Optional software source filter for template selection */
  softwareSource?: string;
}

export interface GeneratedDoc {
  docType: string;
  title: string;
  content: string;
  status: 'draft' | 'error';
  propertyAddress?: string; // set for per-property docs
  propertyIndex?: number;
}

// ---------------------------------------------------------------------------
// Document list per package
// ---------------------------------------------------------------------------

function getDocumentsForPackage(packageType: string): string[] {
  switch (packageType) {
    case 'foundation':
      return ['poa', 'livingWill', 'will', 'estatePlanSummary', 'actionSteps'];
    case 'guardian':
      return [
        'trust',
        'poa',
        'livingWill',
        'pourOverWill',
        'deed',
        'affidavitOfConsideration',
        'gitRep3',
        'estatePlanSummary',
        'actionSteps',
      ];
    case 'fortress':
      return [
        'trust',
        'poa',
        'livingWill',
        'pourOverWill',
        'deed',
        'affidavitOfConsideration',
        'gitRep3',
        'estatePlanSummary',
        'actionSteps',
      ];
    default:
      return ['poa', 'livingWill', 'will', 'estatePlanSummary', 'actionSteps'];
  }
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const generateDocuments = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region('us-east1')
  .https.onCall(async (data: unknown, context: functions.https.CallableContext) => {
    // ------------------------------------------------------------------
    // 1. Authentication & authorization
    // ------------------------------------------------------------------
    const auth = context.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to generate documents.');
    }

    const role = auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
      throw new HttpsError(
        'permission-denied',
        'Only staff members can generate estate plan documents.',
      );
    }

    const { firmId, clientId, packageType, trustTypes, generationMode = 'hybrid', modelOverride, softwareSource } = data as GenerateRequest;

    if (!firmId || !clientId || !packageType) {
      throw new HttpsError(
        'invalid-argument',
        'firmId, clientId, and packageType are required.',
      );
    }

    // Verify caller belongs to this firm (unless admin)
    if (role !== 'admin') {
      const callerFirmId = auth.token.firmId as string | undefined;
      if (callerFirmId && callerFirmId !== firmId) {
        throw new HttpsError(
          'permission-denied',
          'You can only generate documents for clients in your own firm.',
        );
      }
    }

    // ------------------------------------------------------------------
    // 2. Determine document list
    // ------------------------------------------------------------------
    const documentsToGenerate = getDocumentsForPackage(packageType);

    console.log(
      `[generateDocuments] Starting generation for client=${clientId} package=${packageType} mode=${generationMode}` +
      (softwareSource ? ` software=${softwareSource}` : ''),
      `documents=[${documentsToGenerate.join(', ')}]`,
    );

    // ------------------------------------------------------------------
    // 3. Generate all documents concurrently via unified generator
    // ------------------------------------------------------------------
    const allResults: UnifiedGenerateResult[] = [];

    const settled = await Promise.allSettled(
      documentsToGenerate.map((docType) =>
        generateDocumentWithPropertyExpansion({
          firmId,
          clientId,
          docType,
          generationMode,
          softwareSource,
          trustTypes,
          createdBy: auth.uid,
          triggerSource: 'batch',
          modelOverride,
        }),
      ),
    );

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      const docType = documentsToGenerate[i];
      if (result.status === 'fulfilled') {
        allResults.push(...result.value);
      } else {
        console.error(`[generateDocuments] Fatal error generating ${docType}:`, result.reason);
        allResults.push({
          docType,
          title: `Error — ${getDocTypeDisplayName(docType)}`,
          content: `<p>An unexpected error occurred while generating this document: ${result.reason instanceof Error ? result.reason.message : 'Unknown error'}</p>`,
          status: 'error',
          docId: docType,
          isNew: false,
          currentVersion: 0,
        });
      }
    }

    // ------------------------------------------------------------------
    // 4. Update client record
    // ------------------------------------------------------------------
    const db = admin.firestore();
    await db.doc(`firms/${firmId}/clients/${clientId}`).update({
      documentsGenerated: true,
      'packageDetails.packageType': packageType,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    });

    const draftCount = allResults.filter((r) => r.status === 'draft').length;
    const errorCount = allResults.filter((r) => r.status === 'error').length;

    console.log(
      `[generateDocuments] Completed. Generated ${allResults.length} documents ` +
      `(${draftCount} draft, ${errorCount} errors).`,
    );

    // ------------------------------------------------------------------
    // 5. Return summary
    // ------------------------------------------------------------------
    return {
      success: true,
      documentsGenerated: draftCount,
      documentsErrored: errorCount,
      results: allResults.map((r) => ({
        docType: r.docType,
        title: r.title,
        status: r.status,
        propertyAddress: r.propertyAddress,
      })),
    };
  },
  );
