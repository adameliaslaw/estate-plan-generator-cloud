/**
 * functions/src/generate-estate-document.ts
 *
 * Automated estate document generation pipeline.
 * Uses Vertex AI (Gemini) for structured data extraction and docxtemplater
 * for high-fidelity Word document assembly.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

import { callVertexAIStructured } from './vertex-ai-client';
import { ESTATE_EXTRACTION_SCHEMA } from './document-schemas';
import { aggregateClientContext } from './client-context-aggregator';
import { serializeClientData } from './client-data-serializer';
import { getTemplateName, FALLBACK_TEMPLATE } from './template-map';

/**
 * Cloud Function to generate an estate document (Word .docx).
 *
 * 1. Aggregates all client questionnaire data into a canonical text representation.
 * 2. Uses Vertex AI (Gemini) with a JSON schema to extract specific fields.
 * 3. Injects the extracted JSON into a Word template using docxtemplater.
 * 4. Saves the resulting .docx to Cloud Storage and registers it in Firestore.
 */
export const generateEstateDocument = functions
  .runWith({
    timeoutSeconds: 300, // Processing AI + Binary docs can take time
    memory: '1GB',       // docxtemplater/PizZip can be memory-intensive
    secrets: ['VERTEX_AI_KEY'], // Inject the secret from Secret Manager
  })
  .region('us-east1')
  .https.onCall(async (data: unknown, context: functions.https.CallableContext) => {
    // ── 1. Auth check ────────────────────────────────────────────────────────
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }

    const { firmId, clientId, docType = 'will' } = data as {
      firmId?: string;
      clientId?: string;
      docType?: 'will' | 'poa' | 'hc';
    };

    if (!firmId || !clientId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'firmId and clientId are required.',
      );
    }

    // ── 2. Data Retrieval ────────────────────────────────────────────────────
    console.log(`[generateEstateDocument] Fetching context for client ${clientId} for ${docType}...`);
    const contextData = await aggregateClientContext(firmId, clientId, docType);
    const { text: serializedData } = serializeClientData(
      contextData.client,
      contextData.firm,
      docType,
    );

    // ── 3. AI Data Extraction (Vertex AI) ────────────────────────────────────
    console.log('[generateEstateDocument] Extracting data via Vertex AI...');
    const extractionPrompt = `
      You are an expert estate planning assistant.
      Your task is to extract specific legal appointment and identity data from the following client questionnaire summary.
      
      Respond ONLY with valid JSON matching the provided schema.
      
      CLIENT DATA:
      ${serializedData}
    `;

    const extractedData = await callVertexAIStructured<{
      client_name: string;
      executor: string;
      successor_executor: string;
      client_address: string;
      trustee_logic: string;
      is_married: boolean;
      has_trust: boolean;
      testator_pronoun: string;
      executor_relationship: string;
    }>(
      'gemini-1.5-flash',
      extractionPrompt,
      ESTATE_EXTRACTION_SCHEMA.schema as Record<string, unknown>,
    );

    console.log('[generateEstateDocument] Extracted Data:', extractedData);

    // ── 4. Document Assembly (docxtemplater) ─────────────────────────────────
    console.log('[generateEstateDocument] Assembling Word document...');

    // Pre-Render Validation Steps (using legacy names)
    if (!extractedData.client_name || extractedData.client_name.trim() === '') {
      throw new functions.https.HttpsError('failed-precondition', 'Missing Testator Name');
    }
    if (!extractedData.executor || extractedData.executor.trim() === '') {
      throw new functions.https.HttpsError('failed-precondition', 'Missing Primary Executor');
    }
    if (!extractedData.testator_pronoun || extractedData.testator_pronoun.trim() === '') {
      throw new functions.https.HttpsError('failed-precondition', 'Missing Testator Pronoun');
    }

    // Template Routing Logic via template-map.ts
    let templateName = getTemplateName({
      is_married: extractedData.is_married,
      has_trust: extractedData.has_trust,
      doc_type: docType,
    });

    console.log(`[generateEstateDocument] Using template: ${templateName}`);

    // Template path: lib/templates/[templateName] (post-build)
    let templatePath = path.join(__dirname, 'templates', templateName);
    if (!fs.existsSync(templatePath)) {
      console.error('[generateEstateDocument] Template not found at:', templatePath);
      // Fallback to FALLBACK_TEMPLATE (Generic_Will.docx)
      const fallbackPath = path.join(__dirname, 'templates', FALLBACK_TEMPLATE);
      if (fs.existsSync(fallbackPath)) {
        console.warn(`[generateEstateDocument] Falling back to: ${FALLBACK_TEMPLATE}`);
        templateName = FALLBACK_TEMPLATE;
        templatePath = fallbackPath;
      } else {
        throw new functions.https.HttpsError('internal', `Document template missing: ${templateName}`);
      }
    }

    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    // Render the document with the extracted AI data (includes Grammar fields)
    doc.render(extractedData);

    const buffer = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    // ── 5. Storage & Persistence ─────────────────────────────────────────────
    const timestamp = Date.now();
    const docId = `estate_plan_${timestamp}`;
    const storagePath = `firms/${firmId}/clients/${clientId}/documents/${docId}.docx`;
    
    console.log('[generateEstateDocument] Uploading to Storage...');
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    
    await file.save(buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      metadata: {
        firmId,
        clientId,
        docId,
        aiModel: 'vertex-gemini-1.5-flash',
        generatedAt: new Date().toISOString(),
      },
    });

    // ── 6. Firestore Entry ───────────────────────────────────────────────────
    console.log('[generateEstateDocument] Saving document metadata to Firestore...');
    const db = admin.firestore();
    const docRef = db
      .collection('firms').doc(firmId)
      .collection('clients').doc(clientId)
      .collection('documents').doc(docId);

    await docRef.set({
      id: docId,
      firmId,
      clientId,
      docType: docType,
      displayName: `${docType.toUpperCase()} - ${extractedData.client_name}`,
      status: 'review',
      storagePath,
      fileName: `${docId}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      currentVersion: 1,
      generatedByAI: true,
      aiModel: 'vertex-gemini-1.5-flash',
      extractedData, // Store the raw extraction for debugging/review
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'ai-system',
    });

    return {
      success: true,
      docId,
      storagePath,
      displayName: `Estate Plan - ${extractedData.client_name}`,
    };
  });
