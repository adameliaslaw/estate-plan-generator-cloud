/**
 * functions/src/knowledge-base.ts
 *
 * CRUD Cloud Functions for managing the Knowledge Base — a curated collection
 * of statutes, case law, CLE materials, checklists, and practice notes that
 * feed into template-based document generation.
 *
 * Firestore path: firms/{firmId}/knowledgeBase/{resourceId}
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { callAI, parseAIJson } from './ai-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KnowledgeCategory =
  | 'statute'
  | 'case_law'
  | 'cle_material'
  | 'checklist'
  | 'form_template'
  | 'practice_note'
  | 'custom';

export interface KnowledgeResource {
  id: string;
  firmId: string;
  category: KnowledgeCategory;
  title: string;
  citation?: string;
  content: string;
  tags: string[];
  docTypes: string[];
  jurisdiction: string;
  isActive: boolean;
  source?: string;
  sourceUrl?: string;
  lastVerifiedAt?: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  createdBy: string;
  updatedBy: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertFirmAccess(auth: NonNullable<CallableRequest['auth']>, firmId: string): void {
  const role = auth.token.role as string | undefined;
  if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
    throw new HttpsError('permission-denied', 'Only staff members can manage the knowledge base.');
  }
  const callerFirmId = auth.token.firmId as string | undefined;
  if (!callerFirmId || callerFirmId !== firmId) {
    throw new HttpsError('permission-denied', 'Cross-firm access is not permitted.');
  }
}

function kbCollection(firmId: string) {
  return admin.firestore().collection('firms').doc(firmId).collection('knowledgeBase');
}

// ---------------------------------------------------------------------------
// addKnowledgeResource
// ---------------------------------------------------------------------------

export const addKnowledgeResource = onCall(
  { region: 'us-east1', memory: '256MiB' },
  async (request: CallableRequest<unknown>) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const { firmId, category, title, citation, content, tags, docTypes, jurisdiction, source, sourceUrl } = request.data as {
      firmId: string; category: KnowledgeCategory; title: string; citation?: string; content: string;
      tags?: string[]; docTypes?: string[]; jurisdiction?: string; source?: string; sourceUrl?: string;
    };

    if (!firmId || !title || !content || !category) {
      throw new HttpsError('invalid-argument', 'firmId, category, title, and content are required.');
    }
    assertFirmAccess(request.auth, firmId);

    const now = admin.firestore.FieldValue.serverTimestamp();
    const ref = kbCollection(firmId).doc();

    const resource: KnowledgeResource = {
      id: ref.id,
      firmId,
      category,
      title,
      citation: citation ?? '',
      content,
      tags: tags ?? [],
      docTypes: docTypes ?? [],
      jurisdiction: jurisdiction ?? 'NJ',
      isActive: true,
      source: source ?? '',
      sourceUrl: sourceUrl ?? '',
      createdAt: now,
      updatedAt: now,
      createdBy: request.auth.uid,
      updatedBy: request.auth.uid,
    };

    await ref.set(resource);
    console.log(`[addKnowledgeResource] Created ${ref.id} in firm ${firmId}`);

    return { success: true, resourceId: ref.id };
  },
);

// ---------------------------------------------------------------------------
// updateKnowledgeResource
// ---------------------------------------------------------------------------

export const updateKnowledgeResource = onCall(
  { region: 'us-east1', memory: '256MiB' },
  async (request: CallableRequest<unknown>) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const { firmId, resourceId, ...updates } = request.data as { firmId: string; resourceId: string; [key: string]: unknown };

    if (!firmId || !resourceId) {
      throw new HttpsError('invalid-argument', 'firmId and resourceId are required.');
    }
    assertFirmAccess(request.auth, firmId);

    const ref = kbCollection(firmId).doc(resourceId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', `Resource ${resourceId} not found.`);
    }

    // Only allow whitelisted fields
    const allowed = ['category', 'title', 'citation', 'content', 'tags', 'docTypes', 'jurisdiction', 'isActive', 'source', 'sourceUrl'];
    const safeUpdates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in updates) safeUpdates[key] = updates[key];
    }
    safeUpdates['updatedAt'] = admin.firestore.FieldValue.serverTimestamp();
    safeUpdates['updatedBy'] = request.auth.uid;

    await ref.update(safeUpdates);
    console.log(`[updateKnowledgeResource] Updated ${resourceId}`);

    return { success: true };
  },
);

// ---------------------------------------------------------------------------
// deleteKnowledgeResource (soft delete)
// ---------------------------------------------------------------------------

export const deleteKnowledgeResource = onCall(
  { region: 'us-east1', memory: '256MiB' },
  async (request: CallableRequest<unknown>) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const { firmId, resourceId } = request.data as { firmId: string; resourceId: string };

    if (!firmId || !resourceId) {
      throw new HttpsError('invalid-argument', 'firmId and resourceId are required.');
    }
    assertFirmAccess(request.auth, firmId);

    const ref = kbCollection(firmId).doc(resourceId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', `Resource ${resourceId} not found.`);
    }

    await ref.update({
      isActive: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: request.auth.uid,
    });

    console.log(`[deleteKnowledgeResource] Soft-deleted ${resourceId}`);
    return { success: true };
  },
);

// ---------------------------------------------------------------------------
// searchKnowledgeResources
// ---------------------------------------------------------------------------

export const searchKnowledgeResources = onCall(
  // 512MiB (was 256MiB): loads up to 200 resources with full `content` (Firecrawl
  // docs can be ~50KB each), which pushed the 256MiB cap into a startup OOM once
  // the KB grew. Matches the sibling heavy KB functions (bulkImport/analyzeContent).
  { region: 'us-east1', memory: '512MiB' },
  async (request: CallableRequest<unknown>) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const { firmId, category, docType, tag, activeOnly = true } = request.data as {
      firmId: string; category?: string; docType?: string; tag?: string; activeOnly?: boolean;
    };

    if (!firmId) {
      throw new HttpsError('invalid-argument', 'firmId is required.');
    }

    // Read access for all firm members
    const callerFirmId = request.auth.token.firmId as string | undefined;
    if (callerFirmId && callerFirmId !== firmId && request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Cross-firm access is not permitted.');
    }

    let query: admin.firestore.Query = kbCollection(firmId);

    if (activeOnly) {
      query = query.where('isActive', '==', true);
    }
    if (category) {
      query = query.where('category', '==', category);
    }
    if (docType) {
      query = query.where('docTypes', 'array-contains', docType);
    }

    const snap = await query.orderBy('title').limit(200).get();
    let results = snap.docs.map((d) => d.data());

    // Client-side filter for tag (Firestore can't do array-contains on two fields)
    if (tag) {
      results = results.filter((r: Record<string, unknown>) => (r.tags as string[] ?? []).includes(tag));
    }

    return { success: true, resources: results, count: results.length };
  },
);

// ---------------------------------------------------------------------------
// bulkImportKnowledgeResources
// ---------------------------------------------------------------------------

export const bulkImportKnowledgeResources = onCall(
  { region: 'us-east1', memory: '512MiB', timeoutSeconds: 60 },
  async (request: CallableRequest<unknown>) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const { firmId, resources } = request.data as {
      firmId: string;
      resources: { title?: string; content?: string; category?: string; citation?: string; tags?: string[]; docTypes?: string[]; jurisdiction?: string; source?: string; sourceUrl?: string }[];
    };

    if (!firmId) throw new HttpsError('invalid-argument', 'firmId is required.');
    if (!Array.isArray(resources) || resources.length === 0) {
      throw new HttpsError('invalid-argument', 'resources must be a non-empty array.');
    }
    if (resources.length > 200) {
      throw new HttpsError('invalid-argument', 'Maximum 200 resources per import.');
    }
    assertFirmAccess(request.auth, firmId);

    const db = admin.firestore();
    const col = kbCollection(firmId);
    const now = admin.firestore.FieldValue.serverTimestamp();

    let batch = db.batch();
    let batchCount = 0;
    let imported = 0;
    const errors: { index: number; reason: string }[] = [];

    for (let i = 0; i < resources.length; i++) {
      const r = resources[i];

      // Validate required fields
      if (!r.title || !r.content || !r.category) {
        errors.push({ index: i, reason: 'title, content, and category are required.' });
        continue;
      }

      const ref = col.doc();
      batch.set(ref, {
        id: ref.id,
        firmId,
        category: r.category,
        title: r.title,
        citation: r.citation ?? '',
        content: r.content,
        tags: r.tags ?? [],
        docTypes: r.docTypes ?? [],
        jurisdiction: r.jurisdiction ?? 'NJ',
        isActive: true,
        source: r.source ?? 'bulk-import',
        sourceUrl: r.sourceUrl ?? '',
        createdAt: now,
        updatedAt: now,
        createdBy: request.auth.uid,
        updatedBy: request.auth.uid,
      });

      imported++;
      batchCount++;

      if (batchCount >= 400) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(`[bulkImportKnowledgeResources] Imported ${imported} resources for firm ${firmId}`);

    return { success: true, imported, errors, total: resources.length };
  },
);

// ---------------------------------------------------------------------------
// analyzeKnowledgeContent — AI-assisted resource metadata extraction
// ---------------------------------------------------------------------------


export const analyzeKnowledgeContent = onCall(
  { region: 'us-east1', memory: '512MiB', timeoutSeconds: 30 },
  async (request: CallableRequest<unknown>) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const { text } = request.data as { text: string };

    if (!text || typeof text !== 'string' || text.trim().length < 20) {
      throw new HttpsError('invalid-argument', 'Please provide at least 20 characters of text to analyze.');
    }

    // Load the firm's AI provider keys so callAI can reach the configured provider.
    const firmId = request.auth.token.firmId as string | undefined;
    if (!firmId) throw new HttpsError('permission-denied', 'No firm associated with this account.');
    const firmSnap = await admin.firestore().collection('firms').doc(firmId).get();
    const firmData = firmSnap.data() ?? {};

    const systemPrompt = `You are a legal research assistant specializing in New Jersey estate planning law.
Analyze the following text and extract structured metadata. Return a valid JSON object with these fields:
{
  "title": "concise descriptive title",
  "citation": "legal citation if present (e.g., N.J.S.A. 3B:3-2), or empty string",
  "category": one of "statute", "case_law", "cle_material", "checklist", "form_template", "practice_note", "custom",
  "tags": ["array", "of", "relevant", "tags"],
  "docTypes": ["array of applicable document types from: will, pourOverWill, poa, livingWill, trust, deed, affidavitOfConsideration, gitRep3, estatePlanSummary"],
  "summary": "one paragraph summary of the content for the content field"
}
Respond with ONLY the JSON object, no markdown fences.`;

    const userPrompt = `Analyze this text and extract metadata:\n\n${text.slice(0, 5000)}`;

    const raw = await callAI(systemPrompt, userPrompt, firmData, {
      model: 'gpt-4o-mini',
      temperature: 0.1,
      maxTokens: 1024,
      jsonMode: true,
    });

    const parsed = parseAIJson<{
      title: string;
      citation: string;
      category: string;
      tags: string[];
      docTypes: string[];
      summary: string;
    }>(raw);

    return {
      success: true,
      suggestion: {
        title: parsed.title ?? '',
        citation: parsed.citation ?? '',
        category: parsed.category ?? 'custom',
        tags: parsed.tags ?? [],
        docTypes: parsed.docTypes ?? [],
        content: parsed.summary ?? text.slice(0, 2000),
      },
    };
  },
);
