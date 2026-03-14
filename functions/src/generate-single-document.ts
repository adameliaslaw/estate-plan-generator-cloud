/**
 * functions/src/generate-single-document.ts
 *
 * Callable Cloud Function to regenerate a single document for a client.
 * Used when an attorney wants to re-run generation for one document type
 * (e.g., after correcting client data, or with custom instructions).
 *
 * Supports all standard document types plus a customInstructions parameter
 * that gets appended to the user prompt.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { generateWill } from './generators/will-generator';
import { generatePourOverWill } from './generators/pour-over-will-generator';
import { generatePOA } from './generators/poa-generator';
import { generateAdvanceDirective } from './generators/advance-directive-generator';
import { generateTrust } from './generators/trust-generator';
import { generateDeed } from './generators/deed-generator';
import { generateAffidavitOfConsideration } from './generators/affidavit-generator';
import { generateGitRep3 } from './generators/git-rep3-generator';
import { generateEstatePlanSummary } from './generators/summary-generator';
import { generateActionSteps } from './generators/action-steps-generator';
import { sanitizeForPrompt } from './ai-client';
import { GeneratedDoc } from './generate-documents';
import { generateFromTemplate, GenerationMode } from './template-engine';
import { aggregateClientContext } from './client-context-aggregator';
import { recordDraftHistory } from './ai-memory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GenerateSingleRequest {
  firmId: string;
  clientId: string;
  docType: string;
  /** Optional: for deed / affidavit / gitRep3, specify which property index (0-based) */
  propertyIndex?: number;
  /** Optional custom instructions appended to the AI prompt */
  customInstructions?: string;
  trustTypes?: string[];
  /** Generation mode: template, ai, or hybrid */
  generationMode?: GenerationMode;
  /** Specific template variant ID to use */
  templateId?: string;
}

// ---------------------------------------------------------------------------
// Helper: dispatch to the right generator
// ---------------------------------------------------------------------------

async function dispatchGenerator(
  docType: string,
  clientData: admin.firestore.DocumentData,
  firmData: admin.firestore.DocumentData,
  packageType: string,
  trustTypes: string[],
  propertyIndex: number | undefined,
): Promise<GeneratedDoc> {
  // Per-property document types
  const PER_PROPERTY = ['deed', 'affidavitOfConsideration', 'gitRep3'];

  if (PER_PROPERTY.includes(docType)) {
    const properties: admin.firestore.DocumentData[] =
      (clientData.assets?.realEstate ?? []).filter(
        (p: admin.firestore.DocumentData) => p.transferToTrust === true,
      );

    if (properties.length === 0) {
      return {
        docType,
        title: `${docType} — No Qualifying Properties`,
        content: `<p>No real estate properties are flagged for trust transfer.</p>`,
        status: 'draft',
      };
    }

    const idx = propertyIndex ?? 0;
    const property = properties[idx] ?? properties[0];

    switch (docType) {
      case 'deed':
        return generateDeed(clientData, firmData, packageType, trustTypes, property);
      case 'affidavitOfConsideration':
        return generateAffidavitOfConsideration(clientData, firmData, packageType, trustTypes, property);
      case 'gitRep3':
        return generateGitRep3(clientData, firmData, packageType, trustTypes, property);
    }
  }

  switch (docType) {
    case 'will':
      return generateWill(clientData, firmData, packageType, trustTypes);
    case 'pourOverWill':
      return generatePourOverWill(clientData, firmData, packageType, trustTypes);
    case 'poa':
      return generatePOA(clientData, firmData, packageType, trustTypes);
    case 'livingWill':
      return generateAdvanceDirective(clientData, firmData, packageType, trustTypes);
    case 'trust':
      return generateTrust(clientData, firmData, packageType, trustTypes);
    case 'estatePlanSummary':
      return generateEstatePlanSummary(clientData, firmData, packageType, trustTypes);
    case 'actionSteps':
      return generateActionSteps(clientData, firmData, packageType, trustTypes);
    default:
      throw new Error(`Unsupported document type: ${docType}`);
  }
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const generateSingleDocument = onCall(
  {
    timeoutSeconds: 300, // 5 minutes for a single document
    memory: '512MiB',
    region: 'us-east1',
  },
  async (request: any /* CallableRequest */) => {
    // ------------------------------------------------------------------
    // 1. Auth check
    // ------------------------------------------------------------------
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to generate documents.');
    }

    const role = auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
      throw new HttpsError(
        'permission-denied',
        'Only attorneys, paralegals, and administrators can generate documents.',
      );
    }

    const { firmId, clientId, docType, propertyIndex, customInstructions, trustTypes, generationMode = 'ai', templateId } =
      request.data as GenerateSingleRequest;

    if (!firmId || !clientId || !docType) {
      throw new HttpsError('invalid-argument', 'firmId, clientId, and docType are required.');
    }

    const db = admin.firestore();

    // ------------------------------------------------------------------
    // 2. Fetch client and firm data
    // ------------------------------------------------------------------
    const clientSnap = await db.doc(`firms/${firmId}/clients/${clientId}`).get();
    if (!clientSnap.exists) {
      throw new HttpsError('not-found', `Client ${clientId} not found.`);
    }
    let clientData = clientSnap.data()!;

    // Inject custom instructions into client data for the generator to use
    if (customInstructions) {
      const safe = sanitizeForPrompt(customInstructions);
      clientData = {
        ...clientData,
        _customInstructions: safe,
      };
    }

    const firmSnap = await db.doc(`firms/${firmId}`).get();
    if (!firmSnap.exists) {
      throw new HttpsError('not-found', `Firm ${firmId} not found.`);
    }
    const firmData = firmSnap.data()!;

    // Verify caller is in the same firm
    if (role !== 'admin') {
      const callerFirmId = auth.token.firmId as string | undefined;
      if (callerFirmId && callerFirmId !== firmId) {
        throw new HttpsError('permission-denied', 'Cross-firm document generation is not permitted.');
      }
    }

    const packageType = clientData.packageDetails?.packageType ?? 'foundation';

    // ------------------------------------------------------------------
    // 3. Generate
    // ------------------------------------------------------------------
    console.log(
      `[generateSingleDocument] docType=${docType} client=${clientId} firmId=${firmId} propertyIndex=${propertyIndex}`,
    );

    let generatedDoc: GeneratedDoc;
    try {
      // Route based on generationMode
      if (generationMode !== 'ai') {
        // Template or hybrid mode — use template engine with full context
        const clientContext = await aggregateClientContext(firmId, clientId, docType);
        const aiGenFn = () => dispatchGenerator(docType, clientData, firmData, packageType, trustTypes ?? [], propertyIndex);
        generatedDoc = await generateFromTemplate(
          clientContext,
          docType,
          generationMode,
          templateId,
          undefined,
          aiGenFn,
        );
      } else {
        // AI mode — existing behavior
        generatedDoc = await dispatchGenerator(
          docType,
          clientData,
          firmData,
          packageType,
          trustTypes ?? [],
          propertyIndex,
        );
      }
    } catch (error) {
      console.error(`[generateSingleDocument] Generation error for ${docType}:`, error);
      throw new HttpsError(
        'internal',
        `Failed to generate ${docType}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    // ------------------------------------------------------------------
    // 4. Save to Firestore (upsert)
    // ------------------------------------------------------------------
    const now = admin.firestore.FieldValue.serverTimestamp();
    const suffix = propertyIndex !== undefined ? `_${propertyIndex}` : '';
    const docId = `${docType}${suffix}`;

    const docRef = db
      .collection('firms')
      .doc(firmId)
      .collection('clients')
      .doc(clientId)
      .collection('documents')
      .doc(docId);

    const existing = await docRef.get();
    const currentVersion = existing.exists
      ? ((existing.data()?.currentVersion as number) ?? 0) + 1
      : 1;

    const docData: Record<string, unknown> = {
      id: docId,
      firmId,
      clientId,
      docType,
      displayName: generatedDoc.title,
      status: 'draft',
      content: generatedDoc.content,
      storagePath: '',
      fileName: `${docId}.html`,
      mimeType: 'text/html',
      currentVersion,
      generatedByAI: true,
      aiModel: 'gpt-5.4',
      requiresSignature: ['will', 'pourOverWill', 'poa', 'livingWill', 'trust', 'deed'].includes(docType),
      notarized: ['poa', 'deed', 'affidavitOfConsideration'].includes(docType),
      tags: [],
      isConfidential: true,
      updatedAt: now,
      updatedBy: auth.uid,
      versions: existing.exists
        ? admin.firestore.FieldValue.arrayUnion({
          versionNumber: currentVersion,
          storagePath: '',
          createdAt: admin.firestore.Timestamp.now(),
          createdBy: auth.uid,
          changeNotes: customInstructions
            ? `Regenerated with custom instructions: ${sanitizeForPrompt(customInstructions).slice(0, 200)}`
            : 'Regenerated',
        })
        : [{
          versionNumber: 1,
          storagePath: '',
          createdAt: admin.firestore.Timestamp.now(),
          createdBy: auth.uid,
          changeNotes: 'Initial AI generation',
        }],
    };

    if (!existing.exists) {
      docData['createdAt'] = now;
      docData['createdBy'] = auth.uid;
      await docRef.set(docData);
    } else {
      await docRef.update(docData);
    }

    // Update client's updatedAt
    await db.doc(`firms/${firmId}/clients/${clientId}`).update({
      updatedAt: now,
      updatedBy: auth.uid,
    });

    console.log(`[generateSingleDocument] Saved ${docId} (version ${currentVersion})`);

    // Record in client's persistent draft history (fire-and-forget)
    recordDraftHistory(firmId, clientId, {
      docType,
      title: generatedDoc.title,
      generatedAt: new Date().toISOString(),
      customInstructions: customInstructions?.slice(0, 200),
      templateUsed: templateId,
      generationMode: generationMode ?? 'ai',
    }).catch(console.error);

    return {
      success: true,
      docId,
      docType,
      title: generatedDoc.title,
      status: 'draft',
      version: currentVersion,
    };
  },
);
