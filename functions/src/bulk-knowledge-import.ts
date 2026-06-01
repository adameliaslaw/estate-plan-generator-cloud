/**
 * functions/src/bulk-knowledge-import.ts
 *
 * Cloud Function to process bulk PDF/Word file uploads for the Knowledge Base.
 * - Downloads files from Firebase Storage
 * - Extracts text via mammoth (docx) or pdf-parse (pdf)
 * - Detects scanned pages and uses Gemini Vision OCR as fallback
 * - Saves resources to Firestore immediately with raw text
 * - Fire-and-forget: enriches metadata via Anthropic (title, category, tags)
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import mammoth from 'mammoth';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require('pdf-parse');
import { callAI, callAIWithVision, parseAIJson } from './ai-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileInput {
  storagePath: string;
  fileName: string;
  /** Optional OCR page range (1-indexed, inclusive). Max span = 150 pages. */
  ocrPageStart?: number;
  ocrPageEnd?: number;
}

interface ProcessedResult {
  fileName: string;
  resourceId: string;
  status: 'success' | 'failed';
  extractedChars: number;
  ocrPagesCount: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Average chars per page — if a page has fewer, it's likely scanned. */
const MIN_CHARS_PER_PAGE_THRESHOLD = 50;

const OCR_PROMPT = `Extract ALL text from this document page exactly as written.
Preserve the original structure, paragraphs, headings, lists, and formatting.
If there are tables, reproduce them in a readable text format.
Do NOT summarize or paraphrase — give me the verbatim text content.
If the page is blank or has no readable text, respond with an empty string.`;

// ---------------------------------------------------------------------------
// Helper: truncate at word boundary
// ---------------------------------------------------------------------------

function truncateAtWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxLen * 0.8 ? truncated.slice(0, lastSpace) + '…' : truncated + '…';
}

// ---------------------------------------------------------------------------
// Helper: extract text from a single file
// ---------------------------------------------------------------------------

async function extractFileText(
  buffer: Buffer,
  fileName: string,
  firmData: Record<string, unknown>,
): Promise<{ text: string; html: string; ocrPagesCount: number }> {
  const ext = fileName.toLowerCase().split('.').pop();
  let text = '';
  let html = '';
  let ocrPagesCount = 0;

  if (ext === 'docx') {
    const htmlResult = await mammoth.convertToHtml({ buffer });
    html = htmlResult.value;
    const textResult = await mammoth.extractRawText({ buffer });
    text = textResult.value;
  } else if (ext === 'pdf') {
    // pdf-parse v2 API: constructor takes { data: buffer }, getText() returns { text, total }
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    text = result.text || '';
    const pageCount = result.total || 1;

    // Check if this looks like a scanned PDF (very little text)
    const avgCharsPerPage = text.length / pageCount;

    if (avgCharsPerPage < MIN_CHARS_PER_PAGE_THRESHOLD && firmData) {
      // Likely a scanned PDF — use Gemini's native PDF processing
      console.log(`[bulkKnowledgeImport] "${fileName}" appears scanned (${Math.round(avgCharsPerPage)} chars/page avg). Running Gemini PDF OCR...`);

      const ocrTexts: string[] = [];

      try {
        // Gemini inline data limit is ~20MB. Split large PDFs into chunks.
        const MAX_CHUNK_BYTES = 15 * 1024 * 1024; // 15MB per chunk (safe margin)
        const totalChunks = Math.ceil(buffer.length / MAX_CHUNK_BYTES);

        console.log(`[bulkKnowledgeImport] PDF is ${(buffer.length / 1024 / 1024).toFixed(1)}MB, splitting into ${totalChunks} chunk(s) for Gemini OCR`);

        for (let chunk = 0; chunk < totalChunks; chunk++) {
          const start = chunk * MAX_CHUNK_BYTES;
          const end = Math.min(start + MAX_CHUNK_BYTES, buffer.length);
          const chunkBuffer = buffer.subarray(start, end);

          // Only the first chunk is a valid PDF (others are partial data).
          // For multi-chunk PDFs, we only OCR the first chunk to stay reliable.
          if (chunk > 0) {
            console.log(`[bulkKnowledgeImport] Skipping chunk ${chunk + 1}/${totalChunks} (partial PDF not sendable to Gemini). Use page range to target later pages.`);
            break;
          }

          try {
            const base64Chunk = chunkBuffer.toString('base64');
            const chunkOcrText = await callAIWithVision(
              base64Chunk,
              'application/pdf',
              OCR_PROMPT,
              firmData,
              { maxTokens: 32000 },
            );
            ocrTexts.push(chunkOcrText || '');
            console.log(`[bulkKnowledgeImport] Gemini PDF OCR chunk ${chunk + 1}: ${chunkOcrText?.length || 0} chars`);
          } catch (err) {
            console.error(`[bulkKnowledgeImport] Gemini PDF OCR chunk ${chunk + 1} failed:`, err);
          }
        }

        const ocrFullText = ocrTexts.join('\n\n');
        if (ocrFullText.length > text.length) {
          text = ocrFullText;
          ocrPagesCount = pageCount;
          console.log(`[bulkKnowledgeImport] Gemini PDF OCR extracted ${ocrFullText.length} chars from "${fileName}"`);
        }
      } catch (err) {
        console.error(`[bulkKnowledgeImport] Gemini PDF OCR failed for "${fileName}":`, err);
        // Continue with whatever pdf-parse extracted
      }
    }

    await parser.destroy();

    // Convert to basic HTML
    html = text
      .split('\n\n')
      .filter((p: string) => p.trim())
      .map((para: string) => `<p>${para.replace(/\n/g, '<br/>')}</p>`)
      .join('\n');
  }

  return { text, html, ocrPagesCount };
}

// ---------------------------------------------------------------------------
// Helper: enrich a resource with AI-generated metadata (fire-and-forget)
// ---------------------------------------------------------------------------

async function enrichResourceWithAI(
  firmId: string,
  resourceId: string,
  rawText: string,
  firmData: Record<string, unknown>,
): Promise<void> {
  const analysisText = truncateAtWordBoundary(rawText, 6000);

  const systemPrompt = `You are a legal research assistant specializing in New Jersey estate planning law.
Analyze the following text and extract structured metadata. Return a valid JSON object with these fields:
{
  "title": "concise descriptive title",
  "citation": "legal citation if present (e.g., N.J.S.A. 3B:3-2), or empty string",
  "category": one of "statute", "case_law", "cle_material", "checklist", "form_template", "practice_note", "custom",
  "tags": ["array", "of", "relevant", "tags"],
  "docTypes": ["array of applicable document types from: will, pourOverWill, poa, livingWill, trust, deed, affidavitOfConsideration, gitRep3, estatePlanSummary"],
  "summary": "one paragraph summary of the content"
}
Respond with ONLY the JSON object, no markdown fences.`;

  const userPrompt = `Analyze this text and extract metadata:\n\n${analysisText}`;

  try {
    const raw = await callAI(systemPrompt, userPrompt, firmData, {
      model: 'mercury-2',
      temperature: 0.1,
      maxTokens: 1024,
      jsonMode: true,
    });

    const parsed = parseAIJson<{
      title?: string;
      citation?: string;
      category?: string;
      tags?: string[];
      docTypes?: string[];
      summary?: string;
    }>(raw);

    // Update the resource in Firestore with enriched metadata
    const db = admin.firestore();
    const ref = db.doc(`firms/${firmId}/knowledgeBase/${resourceId}`);
    const updates: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      aiEnrichedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (parsed.title) updates.title = parsed.title;
    if (parsed.citation) updates.citation = parsed.citation;
    if (parsed.category) updates.category = parsed.category;
    if (parsed.tags?.length) updates.tags = parsed.tags;
    if (parsed.docTypes?.length) updates.docTypes = parsed.docTypes;
    if (parsed.summary) updates.contentSummary = parsed.summary;

    await ref.update(updates);
    console.log(`[bulkKnowledgeImport] AI-enriched resource ${resourceId}: "${parsed.title}"`);
  } catch (err) {
    console.error(`[bulkKnowledgeImport] AI enrichment failed for ${resourceId}:`, err);
    // Non-blocking — resource already saved with raw data
  }
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const bulkProcessKnowledgeFiles = onCall(
  { region: 'us-east1', memory: '2GiB', timeoutSeconds: 540, secrets: ['MERCURY_API_KEY'] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

    const { firmId, files } = request.data as {
      firmId: string;
      files: FileInput[];
    };

    if (!firmId) throw new HttpsError('invalid-argument', 'firmId is required.');
    if (!Array.isArray(files) || files.length === 0) {
      throw new HttpsError('invalid-argument', 'files must be a non-empty array.');
    }
    if (files.length > 100) {
      throw new HttpsError('invalid-argument', 'Maximum 100 files per batch.');
    }

    // Validate role
    const role = request.auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
      throw new HttpsError('permission-denied', 'Only staff members can import knowledge resources.');
    }

    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot import knowledge resources for a different firm.');
    }

    // Fetch firm data for AI provider keys
    const firmSnap = await admin.firestore().collection('firms').doc(firmId).get();
    const firmData = firmSnap.data() ?? {};

    const bucket = admin.storage().bucket();
    const db = admin.firestore();
    const col = db.collection('firms').doc(firmId).collection('knowledgeBase');
    const now = admin.firestore.FieldValue.serverTimestamp();

    const results: ProcessedResult[] = [];
    const enrichmentPromises: Promise<void>[] = [];

    for (const file of files) {
      try {
        // 1. Download from Storage
        const storageFile = bucket.file(file.storagePath);
        const [exists] = await storageFile.exists();
        if (!exists) {
          results.push({
            fileName: file.fileName,
            resourceId: '',
            status: 'failed',
            extractedChars: 0,
            ocrPagesCount: 0,
            error: 'File not found in storage.',
          });
          continue;
        }

        const [buffer] = await storageFile.download();
        console.log(`[bulkKnowledgeImport] Downloaded "${file.fileName}" (${buffer.length} bytes)`);

        // 2. Extract text
        const { text, html, ocrPagesCount } = await extractFileText(buffer, file.fileName, firmData);

        if (!text.trim() && !html.trim()) {
          results.push({
            fileName: file.fileName,
            resourceId: '',
            status: 'failed',
            extractedChars: 0,
            ocrPagesCount,
            error: 'No text could be extracted from file.',
          });
          continue;
        }

        // 3. Save to Firestore immediately (title from filename, content from extracted text)
        const baseName = file.fileName.replace(/\.(docx|pdf)$/i, '').replace(/[_-]/g, ' ');
        const ref = col.doc();

        await ref.set({
          id: ref.id,
          firmId,
          category: 'cle_material', // Default — will be updated by AI enrichment
          title: baseName,
          citation: '',
          content: truncateAtWordBoundary(text, 50000), // Cap at 50K chars for Firestore
          contentHtml: truncateAtWordBoundary(html, 50000),
          contentSource: ocrPagesCount > 0 ? 'ocr' : 'native', // Auto-tag content source
          tags: [],
          docTypes: [],
          jurisdiction: 'NJ',
          isActive: true,
          source: 'bulk-upload',
          sourceFileName: file.fileName,
          sourceStoragePath: file.storagePath,
          ocrApplied: ocrPagesCount > 0,
          ocrPagesCount,
          createdAt: now,
          updatedAt: now,
          createdBy: request.auth.uid,
          updatedBy: request.auth.uid,
        });

        results.push({
          fileName: file.fileName,
          resourceId: ref.id,
          status: 'success',
          extractedChars: text.length,
          ocrPagesCount,
        });

        // 4. Fire-and-forget: AI enrichment via Anthropic
        if (text.length >= 50) {
          enrichmentPromises.push(
            enrichResourceWithAI(firmId, ref.id, text, firmData),
          );
        }
      } catch (err) {
        console.error(`[bulkKnowledgeImport] Error processing "${file.fileName}":`, err);
        results.push({
          fileName: file.fileName,
          resourceId: '',
          status: 'failed',
          extractedChars: 0,
          ocrPagesCount: 0,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // Wait for all AI enrichment to complete (within the function timeout)
    // Use Promise.allSettled so one failure doesn't block the others
    if (enrichmentPromises.length > 0) {
      console.log(`[bulkKnowledgeImport] Awaiting AI enrichment for ${enrichmentPromises.length} resources...`);
      await Promise.allSettled(enrichmentPromises);
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const failCount = results.filter(r => r.status === 'failed').length;
    console.log(`[bulkKnowledgeImport] Done: ${successCount} success, ${failCount} failed for firm ${firmId}`);

    return {
      success: true,
      processed: successCount,
      failed: failCount,
      total: files.length,
      results,
    };
  },
);
