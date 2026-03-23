/**
 * src/pages/admin/KnowledgeBasePage.tsx
 *
 * Admin dashboard for managing the Knowledge Base (legal resources, statutes,
 * CLE materials) and Document Templates. Provides tabbed interface for
 * browsing, adding, editing, and deleting resources and templates.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  BookOpen,
  Plus,
  Search,
  Trash2,
  Edit,
  FileText,
  Scale,
  Tag,
  Eye,
  BookMarked,
  ClipboardList,
  StickyNote,
  Upload,
  Layers,
  Database,
  FileJson,
  RotateCcw,
  Zap,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  knowledgeBaseService,
  templateService,
  type KnowledgeResource,
  type KnowledgeCategory,
  type TemplateVariant,
} from '@/services/knowledge-base-service';
import { AddResourceDialog } from '@/components/knowledge/AddResourceDialog';
import { AddTemplateDialog } from '@/components/knowledge/AddTemplateDialog';
import { BulkTemplateUploadDialog } from '@/components/knowledge/BulkTemplateUploadDialog';
import { BulkImportDialog } from '@/components/knowledge/KBBulkImportDialog';
import { TemplatePreviewDialog } from '@/components/knowledge/TemplatePreviewDialog';
import { EditTemplateTagsDialog } from '@/components/knowledge/EditTemplateTagsDialog';
import { SOFTWARE_SOURCES, getSoftwareSourceLabel } from '@/config/software-sources';

// ---------------------------------------------------------------------------
// Category config
// ---------------------------------------------------------------------------

const CATEGORIES: { key: KnowledgeCategory; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'statute', label: 'Statutes', icon: Scale },
  { key: 'case_law', label: 'Case Law', icon: BookOpen },
  { key: 'cle_material', label: 'CLE Materials', icon: BookMarked },
  { key: 'checklist', label: 'Checklists', icon: ClipboardList },
  { key: 'practice_note', label: 'Practice Notes', icon: StickyNote },
  { key: 'form_template', label: 'Form Templates', icon: FileText },
  { key: 'custom', label: 'Custom', icon: FileText },
];



// ---------------------------------------------------------------------------
// Template Tags — predefined categories for filtering and organizing
// ---------------------------------------------------------------------------
const TEMPLATE_TAGS: { category: string; tags: { value: string; label: string; color: string }[] }[] = [
  {
    category: 'Document Type',
    tags: [
      { value: 'standard-will', label: 'Standard Will', color: 'bg-blue-50 text-blue-700' },
      { value: 'pour-over-will', label: 'Pour-Over Will', color: 'bg-indigo-50 text-indigo-700' },
      { value: 'simple-will', label: 'Simple Will', color: 'bg-sky-50 text-sky-700' },
      { value: 'revocable-trust', label: 'Revocable Trust', color: 'bg-violet-50 text-violet-700' },
      { value: 'irrevocable-trust', label: 'Irrevocable Trust', color: 'bg-purple-50 text-purple-700' },
      { value: 'special-needs-trust', label: 'Special Needs Trust', color: 'bg-fuchsia-50 text-fuchsia-700' },
      { value: 'financial-poa', label: 'Financial POA', color: 'bg-teal-50 text-teal-700' },
      { value: 'healthcare-poa', label: 'Healthcare POA', color: 'bg-cyan-50 text-cyan-700' },
      { value: 'living-will', label: 'Living Will / Advance Directive', color: 'bg-emerald-50 text-emerald-700' },
      { value: 'guardianship', label: 'Guardianship Designation', color: 'bg-lime-50 text-lime-700' },
    ],
  },
  {
    category: 'Client',
    tags: [
      { value: 'male-client', label: 'Male Client', color: 'bg-blue-50 text-blue-600' },
      { value: 'female-client', label: 'Female Client', color: 'bg-pink-50 text-pink-600' },
      { value: 'husband', label: 'Husband', color: 'bg-slate-50 text-slate-700' },
      { value: 'wife', label: 'Wife', color: 'bg-rose-50 text-rose-700' },
      { value: 'married', label: 'Married', color: 'bg-amber-50 text-amber-700' },
      { value: 'single', label: 'Single', color: 'bg-gray-100 text-gray-700' },
      { value: 'has-children', label: 'Has Children', color: 'bg-orange-50 text-orange-700' },
      { value: 'has-minor-children', label: 'Has Minor Children', color: 'bg-red-50 text-red-700' },
    ],
  },
  {
    category: 'Roles',
    tags: [
      { value: 'male-executor', label: 'Male Executor', color: 'bg-blue-50 text-blue-600' },
      { value: 'female-executor', label: 'Female Executor', color: 'bg-pink-50 text-pink-600' },
      { value: 'male-trustee', label: 'Male Trustee', color: 'bg-indigo-50 text-indigo-600' },
      { value: 'female-trustee', label: 'Female Trustee', color: 'bg-fuchsia-50 text-fuchsia-600' },
      { value: 'corporate-trustee', label: 'Corporate Trustee', color: 'bg-gray-100 text-gray-700' },
    ],
  },
  {
    category: 'Jurisdiction',
    tags: [
      { value: 'nj', label: 'New Jersey', color: 'bg-emerald-50 text-emerald-700' },
      { value: 'ny', label: 'New York', color: 'bg-amber-50 text-amber-700' },
      { value: 'pa', label: 'Pennsylvania', color: 'bg-sky-50 text-sky-700' },
    ],
  },
];

const ALL_TAGS = TEMPLATE_TAGS.flatMap((g) => g.tags);


// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function KnowledgeBasePage() {
  const { userProfile } = useAuth();
  const firmId = userProfile?.firmId;

  // Tabs: 'resources' or 'templates'
  const [activeTab, setActiveTab] = useState<'resources' | 'templates'>('resources');
  const [activeCategory, setActiveCategory] = useState<KnowledgeCategory | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [activeTemplateTag, setActiveTemplateTag] = useState<string | null>(null);
  const [activeSoftwareSource, setActiveSoftwareSource] = useState<string | null>(null);

  // Data
  const [resources, setResources] = useState<KnowledgeResource[]>([]);
  const [templates, setTemplates] = useState<TemplateVariant[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Dialogs
  const [showAddResource, setShowAddResource] = useState(false);
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showBulkTemplateImport, setShowBulkTemplateImport] = useState(false);
  const [editingResource, setEditingResource] = useState<KnowledgeResource | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<{ id: string; name: string } | null>(null);
  const [editingTemplateTags, setEditingTemplateTags] = useState<TemplateVariant | null>(null);
  const [embeddingState, setEmbeddingState] = useState<'idle' | 'running' | 'done'>('idle');
  const [templateEmbeddingState, setTemplateEmbeddingState] = useState<'idle' | 'running' | 'done'>('idle');

  // Fetch data
  const fetchResources = useCallback(async () => {
    if (!firmId) return;
    setLoadingResources(true);
    try {
      const cat = activeCategory === 'all' ? undefined : activeCategory;
      const result = await knowledgeBaseService.searchResources({ firmId, category: cat, activeOnly: !showDeleted });
      setResources(result.resources);
    } catch {
      console.error('Failed to fetch resources');
      toast.error('Failed to load knowledge base resources.');
    } finally {
      setLoadingResources(false);
    }
  }, [firmId, activeCategory, showDeleted]);

  const fetchTemplates = useCallback(async () => {
    if (!firmId) return;
    setLoadingTemplates(true);
    try {
      const result = await templateService.listTemplates(firmId);
      setTemplates(result.templates);
    } catch {
      console.error('Failed to fetch templates');
      toast.error('Failed to load templates.');
    } finally {
      setLoadingTemplates(false);
    }
  }, [firmId]);

  // Fetch both on mount, re-fetch active tab on switch/filter change
  useEffect(() => {
    fetchResources();
    fetchTemplates();
  }, [fetchResources, fetchTemplates]);

  // Filtered data
  const filteredResources = resources.filter(
    (r) =>
      r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.citation ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.content.toLowerCase().includes(searchTerm.toLowerCase()),
  ).sort((a, b) => a.title.localeCompare(b.title));

  const filteredTemplates = templates.filter(
    (t) =>
      (t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.docType.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (!activeTemplateTag || (t.tags ?? []).includes(activeTemplateTag)) &&
      (!activeSoftwareSource || t.softwareSource === activeSoftwareSource),
  ).sort((a, b) => a.name.localeCompare(b.name));

  // Handlers
  const handleDeleteResource = async (id: string) => {
    if (!firmId) return;
    if (!window.confirm('Deactivate this resource?')) return;
    try {
      await knowledgeBaseService.deleteResource(firmId, id);
      toast.success('Resource deactivated.');
      fetchResources();
    } catch {
      toast.error('Failed to delete resource.');
    }
  };

  const handleRestoreResource = async (id: string) => {
    if (!firmId) return;
    try {
      await knowledgeBaseService.updateResource({ firmId, resourceId: id, isActive: true });
      toast.success('Resource restored.');
      fetchResources();
    } catch {
      toast.error('Failed to restore resource.');
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!firmId) return;
    if (!window.confirm('Deactivate this template?')) return;
    try {
      await templateService.deleteTemplate(firmId, id);
      toast.success('Template deactivated.');
      fetchTemplates();
    } catch {
      toast.error('Failed to delete template.');
    }
  };

  const handlePreviewTemplate = (templateId: string, name: string) => {
    setPreviewTemplate({ id: templateId, name });
  };

  const [convertingId, setConvertingId] = useState<string | null>(null);

  const handleConvertToTemplate = async (resource: KnowledgeResource) => {
    if (!firmId) return;
    setConvertingId(resource.id);
    try {
      const docType = resource.docTypes?.[0] || 'will';
      const htmlContent = resource.content
        .split('\n\n')
        .filter((p) => p.trim())
        .map((para) => `<p>${para.replace(/\n/g, '<br/>')}</p>`)
        .join('\n');

      await templateService.uploadTemplate({
        firmId,
        docType,
        name: resource.title,
        description: `Converted from Knowledge Base resource: ${resource.title}`,
        variant: 'standard',
        complexity: 2,
        content: htmlContent,
        isDefault: false,
        variables: [],
      });

      toast.success(`"${resource.title}" added to Templates as ${docType}.`);
      fetchTemplates();
    } catch (err) {
      console.error('Convert to template failed:', err);
      toast.error('Failed to convert resource to template.');
    } finally {
      setConvertingId(null);
    }
  };

  const handleSeedKnowledgeBase = async () => {
    if (!firmId) return;
    setSeeding(true);
    try {
      const result = await knowledgeBaseService.seedKnowledgeBase(firmId);
      toast.success(`Seeded ${result.inserted} resources (${result.skipped} already existed).`);
      fetchResources();
    } catch {
      console.error('Failed to seed knowledge base');
      toast.error('Failed to seed knowledge base.');
    } finally {
      setSeeding(false);
    }
  };

  const handleBackfillEmbeddings = async () => {
    if (!firmId) return;
    setEmbeddingState('running');
    let totalProcessed = 0;
    let totalErrors = 0;
    let totalResources = 0;
    let batchNum = 0;

    try {
      // Process in batches until all resources are embedded
      while (batchNum < 500) { // Safety cap
        batchNum++;
        toast.info(`Processing batch ${batchNum}...`, { id: 'embed-progress' });
        const result = await knowledgeBaseService.backfillEmbeddings(firmId, true);
        totalProcessed += result.processed;
        totalErrors += result.errors;
        if (result.total) totalResources = result.total;

        // Stop when nothing was processed OR we've handled all items
        if (result.processed === 0 || (totalResources > 0 && totalProcessed + totalErrors >= totalResources)) break;
      }

      setEmbeddingState('done');
      toast.success(
        `Embeddings complete! ${totalProcessed} of ${totalResources || totalProcessed} resources processed${totalErrors ? `, ${totalErrors} errors` : ''}.`,
        { id: 'embed-progress', duration: 8000 },
      );
    } catch (err) {
      console.error('Embedding backfill failed:', err);
      toast.error(`Embedding backfill failed after ${totalProcessed} resources. Check console for details.`, { id: 'embed-progress' });
      setEmbeddingState('idle');
    }
  };

  const handleBackfillTemplateEmbeddings = async () => {
    if (!firmId) return;
    setTemplateEmbeddingState('running');
    let totalProcessed = 0;
    let totalErrors = 0;
    let totalTemplates = 0;
    let batchNum = 0;

    try {
      while (batchNum < 500) { // Safety cap
        batchNum++;
        toast.info(`Processing template batch ${batchNum}...`, { id: 'template-embed-progress' });
        const result = await knowledgeBaseService.backfillTemplateEmbeddings(firmId, true);
        totalProcessed += result.processed;
        totalErrors += result.errors;
        if (result.total) totalTemplates = result.total;

        // Stop when nothing was processed OR we've handled all items
        if (result.processed === 0 || (totalTemplates > 0 && totalProcessed + totalErrors >= totalTemplates)) break;
      }

      setTemplateEmbeddingState('done');
      toast.success(
        `Template embeddings complete! ${totalProcessed} of ${totalTemplates || totalProcessed} templates processed${totalErrors ? `, ${totalErrors} errors` : ''}.`,
        { id: 'template-embed-progress', duration: 8000 },
      );
    } catch (err) {
      console.error('Template embedding backfill failed:', err);
      toast.error(`Template embedding failed after ${totalProcessed} templates. Check console for details.`, { id: 'template-embed-progress' });
      setTemplateEmbeddingState('idle');
    }
  };

  return (
    <div className="space-y-6 p-6 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="h-7 w-7 text-[#2b6cb0]" />
            Knowledge Base
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage legal resources, templates, and practice materials that power document generation.
          </p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'resources' ? (
            <>
              <Button
                variant="outline"
                onClick={handleBackfillEmbeddings}
                disabled={embeddingState === 'running'}
                className="border-emerald-600 text-emerald-600 hover:bg-emerald-50"
              >
                <Zap className="mr-2 h-4 w-4" />
                {embeddingState === 'running' ? 'Generating...' : embeddingState === 'done' ? 'Embeddings ✓' : 'Generate Embeddings'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowBulkImport(true)}
                className="border-[#2b6cb0] text-[#2b6cb0] hover:bg-blue-50"
              >
                <FileJson className="mr-2 h-4 w-4" /> Bulk Import
              </Button>
              <Button
                onClick={() => setShowAddResource(true)}
                className="bg-[#2b6cb0] hover:bg-[#1a365d] text-white"
              >
                <Plus className="mr-2 h-4 w-4" /> Add Resource
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleBackfillTemplateEmbeddings}
                disabled={templateEmbeddingState === 'running'}
                className="border-emerald-600 text-emerald-600 hover:bg-emerald-50"
              >
                <Zap className="mr-2 h-4 w-4" />
                {templateEmbeddingState === 'running' ? 'Generating...' : templateEmbeddingState === 'done' ? 'Embeddings ✓' : 'Generate Template Embeddings'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowBulkTemplateImport(true)}
                className="border-[#2b6cb0] text-[#2b6cb0] hover:bg-blue-50"
              >
                <FileJson className="mr-2 h-4 w-4" /> Bulk Upload
              </Button>
              <Button
                onClick={() => setShowAddTemplate(true)}
                className="bg-[#2b6cb0] hover:bg-[#1a365d] text-white"
              >
                <Upload className="mr-2 h-4 w-4" /> Upload Template
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          <button
            onClick={() => setActiveTab('resources')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'resources'
                ? 'border-[#2b6cb0] text-[#2b6cb0]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
          >
            <BookOpen className="inline mr-1.5 h-4 w-4" />
            Resources ({resources.length})
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'templates'
                ? 'border-[#2b6cb0] text-[#2b6cb0]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
          >
            <Layers className="inline mr-1.5 h-4 w-4" />
            Document Templates ({templates.length})
          </button>
        </nav>
      </div>

      {/* Search + Category Filter (resources only) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder={activeTab === 'resources' ? 'Search resources...' : 'Search templates...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white pl-10 pr-4 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none focus:ring-1 focus:ring-[#2b6cb0]"
          />
        </div>
        {activeTab === 'resources' && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveCategory('all')}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${activeCategory === 'all'
                  ? 'bg-[#2b6cb0] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
            >
              All
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${activeCategory === cat.key
                    ? 'bg-[#2b6cb0] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
              >
                {cat.label}
              </button>
            ))}
            <button
              onClick={() => setShowDeleted(!showDeleted)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${showDeleted
                  ? 'bg-red-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
            >
              <Trash2 className="inline mr-1 h-3 w-3" />
              Deleted
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {(activeTab === 'resources' ? loadingResources : loadingTemplates) ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#2b6cb0] border-t-transparent" />
        </div>
      ) : activeTab === 'resources' ? (
        /* Resources List */
        filteredResources.length === 0 ? (
          resources.length === 0 ? (
            /* KB is truly empty — show seed option */
            <div className="rounded-xl border-2 border-dashed border-gray-300 py-16 text-center">
              <BookOpen className="mx-auto h-12 w-12 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-gray-600">No resources found</p>
              <p className="mt-1 text-xs text-gray-400">Add statutes, case law, CLE materials, and more.</p>
              <div className="mt-4 flex justify-center gap-3">
                <Button
                  onClick={handleSeedKnowledgeBase}
                  disabled={seeding}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Database className="mr-2 h-4 w-4" />
                  {seeding ? 'Seeding...' : 'Seed with NJ Statutes'}
                </Button>
                <Button onClick={() => setShowAddResource(true)} className="bg-[#2b6cb0] hover:bg-[#1a365d] text-white">
                  <Plus className="mr-2 h-4 w-4" /> Add Resource
                </Button>
              </div>
            </div>
          ) : (
            /* KB has resources but no matches for the current filter */
            <div className="rounded-xl border-2 border-dashed border-gray-300 py-16 text-center">
              <Search className="mx-auto h-12 w-12 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-gray-600">No matching resources</p>
              <p className="mt-1 text-xs text-gray-400">
                {searchTerm ? 'Try a different search term.' : 'No resources in this category yet.'}
              </p>
              <Button onClick={() => setShowAddResource(true)} className="mt-4 bg-[#2b6cb0] hover:bg-[#1a365d] text-white">
                <Plus className="mr-2 h-4 w-4" /> Add Resource
              </Button>
            </div>
          )
        ) : (
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {filteredResources.map((r) => {
              const catConfig = CATEGORIES.find((c) => c.key === r.category);
              const CatIcon = catConfig?.icon ?? FileText;
              return (
                <div key={r.id} className="flex items-start gap-4 px-5 py-4 hover:bg-gray-50/50 transition-colors">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                    <CatIcon className="h-4 w-4 text-[#2b6cb0]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900 truncate">{r.title}</h3>
                      {r.citation && (
                        <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                          {r.citation}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{r.content.slice(0, 200)}</p>
                    <div className="mt-1.5 flex items-center gap-2 text-[10px] text-gray-400">
                      {r.createdAt && (() => {
                        const ts = r.createdAt;
                        const date = ts?.toDate ? ts.toDate() : ts?._seconds ? new Date(ts._seconds * 1000) : null;
                        return date ? <span>Added {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })} at {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} EST</span> : null;
                      })()}
                      {r.source === 'bulk-upload' && (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-600 font-medium">Bulk Upload</span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                        {catConfig?.label ?? r.category}
                      </span>
                      {r.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="rounded bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
                          {tag}
                        </span>
                      ))}
                      {r.docTypes.slice(0, 2).map((dt) => (
                        <span key={dt} className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-600">
                          {dt}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {showDeleted ? (
                      <>
                        <button
                          onClick={() => handleRestoreResource(r.id)}
                          className="rounded p-1.5 text-gray-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                          title="Restore"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleConvertToTemplate(r)}
                          className="rounded p-1.5 text-gray-400 hover:bg-blue-50 hover:text-[#2b6cb0] transition-colors"
                          title="Use as Template"
                          disabled={convertingId === r.id}
                        >
                          {convertingId === r.id
                            ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#2b6cb0] border-t-transparent" />
                            : <Layers className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => setEditingResource(r)}
                          className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteResource(r.id)}
                          className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                          title="Remove"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* Templates List */
        <>
          {/* Tag Filter Pills */}
          <div className="mb-4 flex flex-wrap gap-2 items-center">
            <button
              onClick={() => setActiveTemplateTag(null)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${!activeTemplateTag
                  ? 'bg-[#2b6cb0] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
            >
              All
            </button>
            {TEMPLATE_TAGS.map((group) => (
              group.tags.map((tag) => (
                <button
                  key={tag.value}
                  onClick={() => setActiveTemplateTag(activeTemplateTag === tag.value ? null : tag.value)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${activeTemplateTag === tag.value
                      ? 'bg-[#2b6cb0] text-white'
                      : `${tag.color} hover:opacity-80`
                    }`}
                >
                  {tag.label}
                </button>
              ))
            ))}
          </div>

          {/* Software Source Filter Pills */}
          <div className="mb-4 flex flex-wrap gap-2 items-center">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mr-1">Software:</span>
            <button
              onClick={() => setActiveSoftwareSource(null)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${!activeSoftwareSource
                  ? 'bg-[#2b6cb0] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
            >
              All
            </button>
            {SOFTWARE_SOURCES.filter((s) => s.value !== '').map((s) => (
              <button
                key={s.value}
                onClick={() => setActiveSoftwareSource(activeSoftwareSource === s.value ? null : s.value)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${activeSoftwareSource === s.value
                    ? 'bg-[#2b6cb0] text-white'
                    : 'bg-purple-50 text-purple-700 hover:opacity-80'
                  }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {filteredTemplates.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-gray-300 py-16 text-center">
              <Layers className="mx-auto h-12 w-12 text-gray-300" />
              <p className="mt-3 text-sm font-medium text-gray-600">No templates uploaded</p>
              <p className="mt-1 text-xs text-gray-400">Upload Handlebars HTML templates for each document type.</p>
              <Button onClick={() => setShowAddTemplate(true)} className="mt-4 bg-[#2b6cb0] hover:bg-[#1a365d] text-white">
                <Upload className="mr-2 h-4 w-4" /> Upload Template
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredTemplates.map((t) => (
                <div
                  key={t.id}
                  className="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
                        <FileText className="h-4 w-4 text-[#2b6cb0]" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">{t.name}</h3>
                        <p className="text-xs text-gray-500">{t.docType}</p>
                      </div>
                    </div>
                    {t.isDefault && (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        DEFAULT
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-xs text-gray-500 line-clamp-2">{t.description || t.contentPreview?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}</p>
                  {/* Tags */}
                  {(t.tags ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(t.tags ?? []).map((tag) => {
                        const tagDef = ALL_TAGS.find((td) => td.value === tag);
                        return (
                          <span key={tag} className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${tagDef?.color || 'bg-gray-100 text-gray-600'}`}>
                            {tagDef?.label || tag}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                      v{t.version}
                    </span>
                    <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${t.complexity === 1 ? 'bg-green-50 text-green-700' :
                        t.complexity === 2 ? 'bg-amber-50 text-amber-700' :
                          'bg-red-50 text-red-700'
                      }`}>
                      {t.complexity === 1 ? 'Simple' : t.complexity === 2 ? 'Standard' : 'Comprehensive'}
                    </span>
                    <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600">
                      {t.variant}
                    </span>
                    {t.softwareSource && (
                      <span className="rounded bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-700">
                        {getSoftwareSourceLabel(t.softwareSource)}
                      </span>
                    )}
                    {t.folder && (
                      <span className="rounded bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                        📂 {t.folder}
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handlePreviewTemplate(t.id, t.name)}
                      className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                    >
                      <Eye className="h-3 w-3" /> Preview
                    </button>
                    <button
                      onClick={() => setEditingTemplateTags(t)}
                      className="flex items-center gap-1 rounded-md border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
                    >
                      <Tag className="h-3 w-3" /> Edit Tags
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(t.id)}
                      className="flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" /> Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Add Resource Dialog */}
      <AddResourceDialog
        open={showAddResource || !!editingResource}
        onClose={() => { setShowAddResource(false); setEditingResource(null); }}
        firmId={firmId ?? ''}
        existing={editingResource}
        onSaved={() => { setShowAddResource(false); setEditingResource(null); fetchResources(); }}
      />

      {/* Add Template Dialog */}
      <AddTemplateDialog
        open={showAddTemplate}
        onClose={() => setShowAddTemplate(false)}
        firmId={firmId ?? ''}
        onSaved={() => { setShowAddTemplate(false); fetchTemplates(); }}
      />

      {/* Bulk Import Dialog */}
      <BulkImportDialog
        open={showBulkImport}
        onClose={() => setShowBulkImport(false)}
        firmId={firmId ?? ''}
        onSaved={() => { setShowBulkImport(false); fetchResources(); }}
      />

      {/* Bulk Template Upload Dialog */}
      <BulkTemplateUploadDialog
        open={showBulkTemplateImport}
        onClose={() => setShowBulkTemplateImport(false)}
        firmId={firmId ?? ''}
        onSaved={() => { setShowBulkTemplateImport(false); fetchTemplates(); }}
      />

      {/* Template Preview Dialog */}
      <TemplatePreviewDialog
        open={!!previewTemplate}
        onClose={() => setPreviewTemplate(null)}
        firmId={firmId ?? ''}
        templateId={previewTemplate?.id ?? ''}
        templateName={previewTemplate?.name ?? ''}
        onSaved={() => fetchTemplates()}
      />

      {/* Edit Template Tags Dialog */}
      <EditTemplateTagsDialog
        open={!!editingTemplateTags}
        onClose={() => setEditingTemplateTags(null)}
        firmId={firmId ?? ''}
        template={editingTemplateTags}
        onSaved={() => { setEditingTemplateTags(null); fetchTemplates(); }}
      />
    </div>
  );
}
