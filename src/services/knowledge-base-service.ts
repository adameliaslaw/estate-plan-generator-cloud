/**
 * src/services/knowledge-base-service.ts
 *
 * Frontend service for Knowledge Base and Template management Cloud Functions.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

// ---------------------------------------------------------------------------
// Knowledge Base Types
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createdAt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updatedAt: any;
}

// ---------------------------------------------------------------------------
// Template Types
// ---------------------------------------------------------------------------

export interface TemplateVariant {
  id: string;
  docType: string;
  name: string;
  description: string;
  variant: string;
  complexity: number;
  version: number;
  isDefault: boolean;
  contentPreview: string;
  variables: string[];
  tags: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updatedAt: any;
}

export interface FullTemplate extends TemplateVariant {
  content: string;
}

export type GenerationMode = 'template' | 'ai' | 'hybrid';

// ---------------------------------------------------------------------------
// Knowledge Base API
// ---------------------------------------------------------------------------

export const knowledgeBaseService = {
  async addResource(data: {
    firmId: string;
    category: KnowledgeCategory;
    title: string;
    citation?: string;
    content: string;
    tags?: string[];
    docTypes?: string[];
    jurisdiction?: string;
    source?: string;
    sourceUrl?: string;
  }): Promise<{ resourceId: string }> {
    const fn = httpsCallable(functions, 'addKnowledgeResource');
    const res = await fn(data);
    return res.data as { resourceId: string };
  },

  async updateResource(data: {
    firmId: string;
    resourceId: string;
    [key: string]: unknown;
  }): Promise<void> {
    const fn = httpsCallable(functions, 'updateKnowledgeResource');
    await fn(data);
  },

  async deleteResource(firmId: string, resourceId: string): Promise<void> {
    const fn = httpsCallable(functions, 'deleteKnowledgeResource');
    await fn({ firmId, resourceId });
  },

  async searchResources(data: {
    firmId: string;
    category?: KnowledgeCategory;
    docType?: string;
    tag?: string;
    activeOnly?: boolean;
  }): Promise<{ resources: KnowledgeResource[]; count: number }> {
    const fn = httpsCallable(functions, 'searchKnowledgeResources');
    const res = await fn(data);
    return res.data as { resources: KnowledgeResource[]; count: number };
  },

  async seedKnowledgeBase(firmId: string): Promise<{ inserted: number; skipped: number; total: number }> {
    const fn = httpsCallable(functions, 'seedKnowledgeBase', { timeout: 120000 });
    const res = await fn({ firmId });
    return res.data as { inserted: number; skipped: number; total: number };
  },

  async bulkImportResources(firmId: string, resources: {
    category: KnowledgeCategory;
    title: string;
    citation?: string;
    content: string;
    tags?: string[];
    docTypes?: string[];
  }[]): Promise<{ imported: number; errors: { index: number; reason: string }[]; total: number }> {
    const fn = httpsCallable(functions, 'bulkImportKnowledgeResources', { timeout: 60000 });
    const res = await fn({ firmId, resources });
    return res.data as { imported: number; errors: { index: number; reason: string }[]; total: number };
  },

  async analyzeContent(text: string): Promise<{
    title: string;
    citation: string;
    category: KnowledgeCategory;
    tags: string[];
    docTypes: string[];
    content: string;
  }> {
    const fn = httpsCallable(functions, 'analyzeKnowledgeContent', { timeout: 30000 });
    const res = await fn({ text });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = res.data as { suggestion: any };
    return data.suggestion;
  },

  /**
   * Bulk upload PDF/Word files to the Knowledge Base.
   * 1. Uploads all files to Firebase Storage in parallel
   * 2. Calls bulkProcessKnowledgeFiles to extract text, OCR, and AI-enrich
   */
  async bulkUploadFiles(
    firmId: string,
    files: File[],
    onProgress?: (fileIndex: number, progress: number) => void,
    ocrRanges?: Record<number, { start: number; end: number }>,
  ): Promise<{
    processed: number;
    failed: number;
    total: number;
    results: {
      fileName: string;
      resourceId: string;
      status: 'success' | 'failed';
      extractedChars: number;
      ocrPagesCount: number;
      error?: string;
    }[];
  }> {
    const { ref: storageRef, uploadBytesResumable } = await import('firebase/storage');
    const { storage } = await import('@/config/firebase');

    // 1. Upload all files to Storage in parallel
    const uploadResults: { storagePath: string; fileName: string; ocrPageStart?: number; ocrPageEnd?: number }[] = [];

    const uploadPromises = files.map((file, index) => {
      return new Promise<void>((resolve, reject) => {
        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const storagePath = `firms/${firmId}/knowledgeBase/uploads/${timestamp}_${index}_${safeName}`;
        const fileRef = storageRef(storage, storagePath);
        const uploadTask = uploadBytesResumable(fileRef, file);

        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            onProgress?.(index, progress);
          },
          (error) => reject(error),
          () => {
            const range = ocrRanges?.[index];
            uploadResults.push({
              storagePath,
              fileName: file.name,
              ...(range ? { ocrPageStart: range.start, ocrPageEnd: range.end } : {}),
            });
            resolve();
          },
        );
      });
    });

    await Promise.all(uploadPromises);

    // 2. Call Cloud Function to process all uploaded files
    const fn = httpsCallable(functions, 'bulkProcessKnowledgeFiles', { timeout: 540000 });
    const res = await fn({ firmId, files: uploadResults });
    return res.data as {
      processed: number;
      failed: number;
      total: number;
      results: {
        fileName: string;
        resourceId: string;
        status: 'success' | 'failed';
        extractedChars: number;
        ocrPagesCount: number;
        error?: string;
      }[];
    };
  },

  /**
   * Trigger batch embedding generation for existing KB resources.
   * Processes up to 50 resources per call; call repeatedly until processed = 0.
   */
  async backfillEmbeddings(firmId: string): Promise<{
    processed: number;
    skipped: number;
    errors: number;
  }> {
    const fn = httpsCallable(functions, 'backfillEmbeddings', { timeout: 300000 });
    const res = await fn({ firmId });
    return res.data as { processed: number; skipped: number; errors: number };
  },
};

// ---------------------------------------------------------------------------
// Template API
// ---------------------------------------------------------------------------

export const templateService = {
  async uploadTemplate(data: {
    firmId: string;
    docType: string;
    name: string;
    description?: string;
    variant?: string;
    complexity?: number;
    content: string;
    isDefault?: boolean;
    variables?: string[];
    tags?: string[];
    templateId?: string;
    fileUrl?: string;
    originalFileName?: string;
  }): Promise<{ templateId: string; version: number }> {
    const fn = httpsCallable(functions, 'uploadTemplate');
    const res = await fn(data);
    return res.data as { templateId: string; version: number };
  },

  async deleteTemplate(firmId: string, templateId: string): Promise<void> {
    const fn = httpsCallable(functions, 'deleteTemplate');
    await fn({ firmId, templateId });
  },

  async listTemplates(firmId: string, docType?: string): Promise<{ templates: TemplateVariant[]; count: number }> {
    const fn = httpsCallable(functions, 'listTemplates');
    const res = await fn({ firmId, docType });
    return res.data as { templates: TemplateVariant[]; count: number };
  },

  async getTemplateContent(firmId: string, templateId: string): Promise<FullTemplate> {
    const fn = httpsCallable(functions, 'getTemplateContent');
    const res = await fn({ firmId, templateId });
    return (res.data as { template: FullTemplate }).template;
  },

  async processTemplateFile(firmId: string, storagePath: string, fileName: string): Promise<{
    extractedHtml: string;
    extractedText: string;
    detectedVariables: {
      originalText: string;
      suggestedVariable: string;
      fieldLabel: string;
      confidence: string;
      context: string;
    }[];
    suggestedDocType: string;
    documentSummary: string;
    learningStats: {
      totalCorrections: number;
      totalTemplatesLearned: number;
      dictionarySize: number;
    };
  }> {
    const fn = httpsCallable(functions, 'processTemplateFile', { timeout: 120000 });
    const res = await fn({ firmId, storagePath, fileName });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = res.data as any;
    return data as {
      extractedHtml: string;
      extractedText: string;
      detectedVariables: {
        originalText: string;
        suggestedVariable: string;
        fieldLabel: string;
        confidence: string;
        context: string;
      }[];
      suggestedDocType: string;
      documentSummary: string;
      learningStats: {
        totalCorrections: number;
        totalTemplatesLearned: number;
        dictionarySize: number;
      };
    };
  },

  async recordTemplateCorrection(
    firmId: string,
    corrections: {
      originalText: string;
      aiSuggestedVariable: string;
      userCorrectedVariable: string;
    }[],
    templateName: string,
    docType: string,
  ): Promise<{ recorded: number }> {
    const fn = httpsCallable(functions, 'recordTemplateCorrection');
    const res = await fn({ firmId, corrections, templateName, docType });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return res.data as any;
  },

  async confirmTemplateVariables(
    firmId: string,
    templateName: string,
    docType: string,
    variables: {
      originalText: string;
      confirmedVariable: string;
      fieldLabel: string;
    }[],
  ): Promise<{ confirmed: number }> {
    const fn = httpsCallable(functions, 'confirmTemplateVariables');
    const res = await fn({ firmId, templateName, docType, variables });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return res.data as any;
  },
};
