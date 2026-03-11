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
  createdAt: any;
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
    templateId?: string; // if updating existing
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
};
