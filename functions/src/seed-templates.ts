/**
 * functions/src/seed-templates.ts
 *
 * Cloud Functions for managing document templates (CRUD).
 * Templates are uploaded by attorneys/admins through the Knowledge Base UI.
 * Each template is a Handlebars HTML document stored in Firestore.
 *
 * Firestore path: firms/{firmId}/documentTemplates/{templateId}
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { DocumentTemplate, extractTemplateVariables } from './template-engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertFirmAccess(auth: { token: Record<string, string | undefined>; uid: string }, firmId: string): void {
  const role = auth.token.role as string | undefined;
  if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
    throw new HttpsError('permission-denied', 'Only staff members can manage templates.');
  }
  if (role !== 'admin') {
    const callerFirmId = auth.token.firmId as string | undefined;
    if (callerFirmId && callerFirmId !== firmId) {
      throw new HttpsError('permission-denied', 'Cross-firm access is not permitted.');
    }
  }
}

function templateCollection(firmId: string) {
  return admin.firestore().collection('firms').doc(firmId).collection('documentTemplates');
}

// ---------------------------------------------------------------------------
// uploadTemplate — Create or replace a document template
// ---------------------------------------------------------------------------

export const uploadTemplate = onCall(
  { region: 'us-east1', memory: '256MiB' },
  async (request: CallableRequest) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

    const {
      firmId,
      docType,
      name,
      description,
      variant,
      complexity,
      content,
      isDefault,
      variables,
      tags,
      softwareSource,
      folder,
      templateId, // If provided, update existing
      fileUrl,
      originalFileName,
    } = request.data;

    if (!firmId || !docType || !name) {
      throw new HttpsError('invalid-argument', 'firmId, docType, and name are required.');
    }
    // content is required for new templates, optional for updates
    if (!templateId && !content) {
      throw new HttpsError('invalid-argument', 'content is required for new templates.');
    }
    assertFirmAccess(request.auth, firmId);

    const now = admin.firestore.FieldValue.serverTimestamp();
    const col = templateCollection(firmId);

    // Auto-extract variables from template content (if content provided)
    const autoExtracted = content ? extractTemplateVariables(content) : [];
    // Merge auto-extracted with any manually provided; auto-extracted take precedence
    const manualVars: string[] = variables ?? [];
    const mergedVariables = Array.from(new Set([...autoExtracted, ...manualVars])).sort();

    // If setting as default, unset other defaults for this docType
    if (isDefault) {
      const existingDefaults = await col
        .where('docType', '==', docType)
        .where('isDefault', '==', true)
        .get();

      const batch = admin.firestore().batch();
      existingDefaults.docs.forEach((doc) => {
        batch.update(doc.ref, { isDefault: false, updatedAt: now });
      });
      await batch.commit();
    }

    if (templateId) {
      // Update existing template
      const ref = col.doc(templateId);
      const existing = await ref.get();
      if (!existing.exists) {
        throw new HttpsError('not-found', `Template ${templateId} not found.`);
      }

      const currentVersion = (existing.data()?.version ?? 0) + 1;
      const updateData: Record<string, unknown> = {
        name,
        description: description ?? '',
        variant: variant ?? 'standard',
        complexity: complexity ?? 2,
        version: currentVersion,
        isDefault: isDefault ?? false,
        variables: mergedVariables,
        tags: tags ?? [],
        softwareSource: softwareSource ?? '',
        ...(folder !== undefined ? { folder } : {}),
        updatedAt: now,
        updatedBy: request.auth.uid,
      };
      // Only update content if provided (allows variable-only updates)
      if (content) {
        updateData.content = content;
      }
      await ref.update(updateData);

      console.log(`[uploadTemplate] Updated template ${templateId} (v${currentVersion})`);
      return { success: true, templateId, version: currentVersion };
    } else {
      // Create new template
      const ref = col.doc();
      const template: DocumentTemplate = {
        id: ref.id,
        firmId,
        docType,
        name,
        description: description ?? '',
        variant: variant ?? 'standard',
        complexity: complexity ?? 2,
        version: 1,
        content,
        isDefault: isDefault ?? false,
        isActive: true,
        variables: mergedVariables,
        tags: tags ?? [],
        createdAt: now,
        updatedAt: now,
        createdBy: request.auth.uid,
        updatedBy: request.auth.uid,
        ...(fileUrl ? { fileUrl, originalFileName: originalFileName ?? '' } : {}),
      };

      await ref.set({
        ...template,
        softwareSource: softwareSource ?? '',
        folder: folder ?? '',
      });
      console.log(`[uploadTemplate] Created template ${ref.id} for ${docType} (${variant ?? 'standard'})`);
      return { success: true, templateId: ref.id, version: 1 };
    }
  },
);

// ---------------------------------------------------------------------------
// deleteTemplate — Soft-delete a template
// ---------------------------------------------------------------------------

export const deleteTemplate = onCall(
  { region: 'us-east1', memory: '256MiB' },
  async (request: CallableRequest) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const { firmId, templateId } = request.data;

    if (!firmId || !templateId) {
      throw new HttpsError('invalid-argument', 'firmId and templateId are required.');
    }
    assertFirmAccess(request.auth, firmId);

    const ref = templateCollection(firmId).doc(templateId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', `Template ${templateId} not found.`);
    }

    await ref.update({
      isActive: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: request.auth.uid,
    });

    console.log(`[deleteTemplate] Soft-deleted template ${templateId}`);
    return { success: true };
  },
);

// ---------------------------------------------------------------------------
// listTemplates — List available templates for a firm
// ---------------------------------------------------------------------------

export const listTemplates = onCall(
  { region: 'us-east1', memory: '256MiB' },
  async (request: CallableRequest) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const { firmId, docType, softwareSource, folder } = request.data;

    if (!firmId) {
      throw new HttpsError('invalid-argument', 'firmId is required.');
    }

    // Read access for all firm members
    const callerFirmId = request.auth.token.firmId as string | undefined;
    if (callerFirmId && callerFirmId !== firmId && request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Cross-firm access is not permitted.');
    }

    let query: admin.firestore.Query = templateCollection(firmId).where('isActive', '==', true);

    if (docType) {
      query = query.where('docType', '==', docType);
    }
    if (softwareSource) {
      query = query.where('softwareSource', '==', softwareSource);
    }
    if (folder) {
      query = query.where('folder', '==', folder);
    }

    const snap = await query.orderBy('docType').orderBy('complexity').get();

    const templates = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        docType: data.docType,
        name: data.name,
        description: data.description,
        variant: data.variant,
        complexity: data.complexity,
        version: data.version,
        isDefault: data.isDefault,
        // Don't return full content in list view
        contentPreview: (data.content ?? '').slice(0, 200),
        variables: data.variables,
        tags: data.tags ?? [],
        softwareSource: data.softwareSource ?? '',
        folder: data.folder ?? '',
        updatedAt: data.updatedAt,
      };
    });

    return { success: true, templates, count: templates.length };
  },
);

// ---------------------------------------------------------------------------
// getTemplateContent — Get full template content for editing
// ---------------------------------------------------------------------------

export const getTemplateContent = onCall(
  { region: 'us-east1', memory: '256MiB' },
  async (request: CallableRequest) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const { firmId, templateId } = request.data;

    if (!firmId || !templateId) {
      throw new HttpsError('invalid-argument', 'firmId and templateId are required.');
    }

    const callerFirmId = request.auth.token.firmId as string | undefined;
    if (callerFirmId && callerFirmId !== firmId && request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Cross-firm access is not permitted.');
    }

    const ref = templateCollection(firmId).doc(templateId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', `Template ${templateId} not found.`);
    }

    return { success: true, template: snap.data() };
  },
);
