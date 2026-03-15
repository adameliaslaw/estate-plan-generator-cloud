/**
 * functions/src/generate-documents.ts
 *
 * Main document generation orchestrator — callable Cloud Function.
 * Called when an attorney clicks "Generate Documents" in the UI.
 *
 * Flow:
 *  1. Verify caller is authenticated attorney or admin
 *  2. Fetch client + firm data from Firestore
 *  3. Determine document list for the package type
 *  4. Generate each document (with per-property deed / affidavit / GIT-REP-3)
 *  5. Save each document as 'draft' to Firestore documents subcollection
 *  6. Update client record with generation metadata
 */

import * as functions from 'firebase-functions';
const { HttpsError } = functions.https;
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
import { generateFromTemplate, GenerationMode } from './template-engine';
import { aggregateClientContext } from './client-context-aggregator';
import { saveDocumentToVault } from './document-save-helper';

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
        'deed',                    // one per property — expanded below
        'affidavitOfConsideration', // one per property
        'gitRep3',                  // one per property
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
// Per-docType generator dispatcher
// ---------------------------------------------------------------------------

async function generateDocument(
  docType: string,
  clientData: admin.firestore.DocumentData,
  firmData: admin.firestore.DocumentData,
  packageType: string,
  trustTypes?: string[],
): Promise<GeneratedDoc[]> {
  // Property-level docs return one GeneratedDoc per property
  const PER_PROPERTY_DOCS = ['deed', 'affidavitOfConsideration', 'gitRep3'];

  if (PER_PROPERTY_DOCS.includes(docType)) {
    const properties: admin.firestore.DocumentData[] =
      (clientData.assets?.realEstate ?? []).filter(
        (p: admin.firestore.DocumentData) => p.transferToTrust === true,
      );

    if (properties.length === 0) {
      // Client has no properties flagged for trust transfer — return placeholder
      return [
        {
          docType,
          title: `${docTypeDisplayName(docType)} — No Qualifying Properties`,
          content: `<p>No real estate properties are flagged for trust transfer for this client.</p>`,
          status: 'draft',
        },
      ];
    }

    const results: GeneratedDoc[] = [];
    for (let i = 0; i < properties.length; i++) {
      const property = properties[i];
      let result: GeneratedDoc;
      try {
        if (docType === 'deed') {
          const doc = await generateDeed(clientData, firmData, packageType, trustTypes, property);
          result = { ...doc, propertyAddress: property.address, propertyIndex: i };
        } else if (docType === 'affidavitOfConsideration') {
          const doc = await generateAffidavitOfConsideration(clientData, firmData, packageType, trustTypes, property);
          result = { ...doc, propertyAddress: property.address, propertyIndex: i };
        } else {
          const doc = await generateGitRep3(clientData, firmData, packageType, trustTypes, property);
          result = { ...doc, propertyAddress: property.address, propertyIndex: i };
        }
      } catch (error) {
        result = {
          docType,
          title: `Error — ${docTypeDisplayName(docType)} (${property.address})`,
          content: `<p>Error generating document: ${error instanceof Error ? error.message : 'Unknown error'}</p>`,
          status: 'error',
          propertyAddress: property.address,
          propertyIndex: i,
        };
      }
      results.push(result);
    }
    return results;
  }

  // Single-document generators
  let doc: GeneratedDoc;
  switch (docType) {
    case 'will':
      doc = await generateWill(clientData, firmData, packageType, trustTypes);
      break;
    case 'pourOverWill':
      doc = await generatePourOverWill(clientData, firmData, packageType, trustTypes);
      break;
    case 'poa':
      doc = await generatePOA(clientData, firmData, packageType, trustTypes);
      break;
    case 'livingWill':
      doc = await generateAdvanceDirective(clientData, firmData, packageType, trustTypes);
      break;
    case 'trust':
      doc = await generateTrust(clientData, firmData, packageType, trustTypes);
      break;
    case 'estatePlanSummary':
      doc = await generateEstatePlanSummary(clientData, firmData, packageType, trustTypes);
      break;
    case 'actionSteps':
      doc = await generateActionSteps(clientData, firmData, packageType, trustTypes);
      break;
    default:
      doc = {
        docType,
        title: `Unsupported document type: ${docType}`,
        content: `<p>Document type "${docType}" is not yet supported.</p>`,
        status: 'error',
      };
  }
  return [doc];
}

// ---------------------------------------------------------------------------
// Firestore save helper — delegates to shared saveDocumentToVault
// ---------------------------------------------------------------------------

async function saveDocument(
  _db: admin.firestore.Firestore,
  firmId: string,
  clientId: string,
  doc: GeneratedDoc,
  createdBy: string,
  propertyIndex?: number,
): Promise<string> {
  // Build a deterministic document ID so re-generating replaces the old draft
  const suffix = propertyIndex !== undefined ? `_${propertyIndex}` : '';
  const docId = `${doc.docType}${suffix}`;

  const result = await saveDocumentToVault({
    firmId,
    clientId,
    docType: doc.docType,
    displayName: doc.title,
    content: doc.content,
    status: doc.status,
    createdBy,
    documentId: docId,
    generationMode: 'batch',
    propertyAddress: doc.propertyAddress,
  });

  return result.docId;
}

// ---------------------------------------------------------------------------
// Metadata helper
// ---------------------------------------------------------------------------

function docTypeDisplayName(docType: string): string {
  const names: Record<string, string> = {
    will: 'Last Will and Testament',
    pourOverWill: 'Pour-Over Will',
    poa: 'Durable Power of Attorney',
    livingWill: 'Advance Directive for Health Care',
    trust: 'Revocable Living Trust',
    deed: 'Deed',
    affidavitOfConsideration: 'Affidavit of Consideration',
    gitRep3: 'GIT/REP-3 Exemption Certificate',
    estatePlanSummary: 'Estate Plan Summary',
    actionSteps: 'Action Steps Checklist',
  };
  return names[docType] ?? docType;
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
    if (!role || !['admin', 'attorney'].includes(role)) {
      throw new HttpsError(
        'permission-denied',
        'Only attorneys and administrators can generate estate plan documents.',
      );
    }

    const { firmId, clientId, packageType, trustTypes, generationMode = 'ai', modelOverride, softwareSource } = data as GenerateRequest;

    if (!firmId || !clientId || !packageType) {
      throw new HttpsError(
        'invalid-argument',
        'firmId, clientId, and packageType are required.',
      );
    }

    const db = admin.firestore();

    // ------------------------------------------------------------------
    // 2. Fetch client data
    // ------------------------------------------------------------------
    const clientRef = db.doc(`firms/${firmId}/clients/${clientId}`);
    const clientSnap = await clientRef.get();
    if (!clientSnap.exists) {
      throw new HttpsError('not-found', `Client ${clientId} not found in firm ${firmId}.`);
    }
    const clientData = clientSnap.data()!;

    // Verify the caller belongs to this firm (unless admin)
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
    // 3. Fetch firm data
    // ------------------------------------------------------------------
    const firmSnap = await db.doc(`firms/${firmId}`).get();
    if (!firmSnap.exists) {
      throw new HttpsError('not-found', `Firm ${firmId} not found.`);
    }
    const firmData = firmSnap.data()!;

    // If a model override was specified, inject it into firmData for the AI client
    if (modelOverride) {
      (firmData as Record<string, unknown>).documentDraftingModel = modelOverride;
    }

    // ------------------------------------------------------------------
    // 4. Determine document list
    // ------------------------------------------------------------------
    const documentsToGenerate = getDocumentsForPackage(packageType);

    console.log(
      `[generateDocuments] Starting generation for client=${clientId} package=${packageType} mode=${generationMode}` +
      (softwareSource ? ` software=${softwareSource}` : ''),
      `documents=[${documentsToGenerate.join(', ')}]`,
    );

    // Aggregate client context for template/hybrid modes
    let clientContext: Awaited<ReturnType<typeof aggregateClientContext>> | null = null;
    if (generationMode !== 'ai') {
      try {
        clientContext = await aggregateClientContext(firmId, clientId);
      } catch (ctxErr) {
        console.warn('[generateDocuments] Context aggregation failed, falling back to AI:', ctxErr);
      }
    }

    // ------------------------------------------------------------------
    // 5. Generate each document
    // ------------------------------------------------------------------
    const allResults: GeneratedDoc[] = [];
    const savedDocIds: string[] = [];

    for (const docType of documentsToGenerate) {
      let docsForType: GeneratedDoc[];
      try {
        // Route based on generationMode
        if (generationMode !== 'ai' && clientContext) {
          // Template or hybrid mode — use template engine
          const PER_PROPERTY_DOCS = ['deed', 'affidavitOfConsideration', 'gitRep3'];
          if (PER_PROPERTY_DOCS.includes(docType)) {
            // Per-property docs still go through AI for now (complex property-specific logic)
            docsForType = await generateDocument(docType, clientData, firmData, packageType, trustTypes);
          } else {
            const aiGenFn = () => generateDocument(docType, clientData, firmData, packageType, trustTypes).then(docs => docs[0]);
            const doc = await generateFromTemplate(
              clientContext,
              docType,
              generationMode,
              undefined, // templateId
              undefined, // variant
              aiGenFn,
              softwareSource,
            );
            docsForType = [doc];
          }
        } else {
          // AI mode — existing behavior
          docsForType = await generateDocument(docType, clientData, firmData, packageType, trustTypes);
        }
      } catch (error) {
        console.error(`[generateDocuments] Fatal error generating ${docType}:`, error);
        docsForType = [
          {
            docType,
            title: `Error — ${docTypeDisplayName(docType)}`,
            content: `<p>An unexpected error occurred while generating this document: ${error instanceof Error ? error.message : 'Unknown error'}</p>`,
            status: 'error',
          },
        ];
      }

      for (const doc of docsForType) {
        allResults.push(doc);
        try {
          const savedId = await saveDocument(
            db,
            firmId,
            clientId,
            doc,
            auth.uid,
            doc.propertyIndex,
          );
          savedDocIds.push(savedId);
        } catch (saveError) {
          console.error(`[generateDocuments] Failed to save document ${doc.docType}:`, saveError);
          // Non-fatal — continue generating remaining documents
        }
      }
    }

    // ------------------------------------------------------------------
    // 6. Update client record
    // ------------------------------------------------------------------
    await clientRef.update({
      documentsGenerated: true,
      'packageDetails.packageType': packageType,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    });

    console.log(
      `[generateDocuments] Completed. Generated ${allResults.length} documents ` +
      `(${allResults.filter((r) => r.status === 'draft').length} draft, ` +
      `${allResults.filter((r) => r.status === 'error').length} errors).`,
    );

    // ------------------------------------------------------------------
    // 7. Return summary (not full content — content is in Firestore)
    // ------------------------------------------------------------------
    return {
      success: true,
      documentsGenerated: allResults.filter((r) => r.status === 'draft').length,
      documentsErrored: allResults.filter((r) => r.status === 'error').length,
      results: allResults.map((r) => ({
        docType: r.docType,
        title: r.title,
        status: r.status,
        propertyAddress: r.propertyAddress,
      })),
    };
  },
  );
