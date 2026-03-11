/**
 * src/pages/admin/KnowledgeBasePage.tsx
 *
 * Admin dashboard for managing the Knowledge Base (legal resources, statutes,
 * CLE materials) and Document Templates. Provides tabbed interface for
 * browsing, adding, editing, and deleting resources and templates.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  BookOpen,
  Plus,
  Search,
  Trash2,
  Edit,
  FileText,
  Scale,
  BookMarked,
  ClipboardList,
  StickyNote,
  Upload,
  Layers,
  Eye,
  Database,
  Sparkles,
  FileJson,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  knowledgeBaseService,
  templateService,
  type KnowledgeResource,
  type KnowledgeCategory,
  type TemplateVariant,
} from '@/services/knowledge-base-service';
import { DOC_TYPES } from '@/config/constants';

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

const DOC_TYPE_OPTIONS = Object.entries(DOC_TYPES).map(([, value]) => ({
  value,
  label: value
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim(),
}));

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

  // Data
  const [resources, setResources] = useState<KnowledgeResource[]>([]);
  const [templates, setTemplates] = useState<TemplateVariant[]>([]);
  const [loading, setLoading] = useState(false);

  // Dialogs
  const [showAddResource, setShowAddResource] = useState(false);
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editingResource, setEditingResource] = useState<KnowledgeResource | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<{ content: string; name: string } | null>(null);

  // Fetch data
  const fetchResources = useCallback(async () => {
    if (!firmId) return;
    setLoading(true);
    try {
      const cat = activeCategory === 'all' ? undefined : activeCategory;
      const result = await knowledgeBaseService.searchResources({ firmId, category: cat });
      setResources(result.resources);
    } catch (err) {
      console.error('Failed to fetch resources:', err);
      toast.error('Failed to load knowledge base resources.');
    } finally {
      setLoading(false);
    }
  }, [firmId, activeCategory]);

  const fetchTemplates = useCallback(async () => {
    if (!firmId) return;
    setLoading(true);
    try {
      const result = await templateService.listTemplates(firmId);
      setTemplates(result.templates);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      toast.error('Failed to load templates.');
    } finally {
      setLoading(false);
    }
  }, [firmId]);

  useEffect(() => {
    if (activeTab === 'resources') fetchResources();
    else fetchTemplates();
  }, [activeTab, fetchResources, fetchTemplates]);

  // Filtered data
  const filteredResources = resources.filter(
    (r) =>
      r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.citation ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.content.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const filteredTemplates = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.docType.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // Handlers
  const handleDeleteResource = async (id: string) => {
    if (!firmId) return;
    if (!window.confirm('Deactivate this resource?')) return;
    try {
      await knowledgeBaseService.deleteResource(firmId, id);
      toast.success('Resource deactivated.');
      fetchResources();
    } catch (err) {
      toast.error('Failed to delete resource.');
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!firmId) return;
    if (!window.confirm('Deactivate this template?')) return;
    try {
      await templateService.deleteTemplate(firmId, id);
      toast.success('Template deactivated.');
      fetchTemplates();
    } catch (err) {
      toast.error('Failed to delete template.');
    }
  };

  const handlePreviewTemplate = async (templateId: string, name: string) => {
    if (!firmId) return;
    try {
      const full = await templateService.getTemplateContent(firmId, templateId);
      setPreviewTemplate({ content: full.content, name });
    } catch (err) {
      toast.error('Failed to load template content.');
    }
  };

  const handleSeedKnowledgeBase = async () => {
    if (!firmId) return;
    setSeeding(true);
    try {
      const result = await knowledgeBaseService.seedKnowledgeBase(firmId);
      toast.success(`Seeded ${result.inserted} resources (${result.skipped} already existed).`);
      fetchResources();
    } catch (err) {
      console.error('Failed to seed knowledge base:', err);
      toast.error('Failed to seed knowledge base.');
    } finally {
      setSeeding(false);
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
            <Button
              onClick={() => setShowAddTemplate(true)}
              className="bg-[#2b6cb0] hover:bg-[#1a365d] text-white"
            >
              <Upload className="mr-2 h-4 w-4" /> Upload Template
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          <button
            onClick={() => setActiveTab('resources')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'resources'
                ? 'border-[#2b6cb0] text-[#2b6cb0]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <BookOpen className="inline mr-1.5 h-4 w-4" />
            Resources ({resources.length})
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'templates'
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
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeCategory === 'all'
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
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  activeCategory === cat.key
                    ? 'bg-[#2b6cb0] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
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
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* Templates List */
        filteredTemplates.length === 0 ? (
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
                <p className="mt-3 text-xs text-gray-500 line-clamp-2">{t.description || t.contentPreview}</p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                    v{t.version}
                  </span>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                    t.complexity === 1 ? 'bg-green-50 text-green-700' :
                    t.complexity === 2 ? 'bg-amber-50 text-amber-700' :
                    'bg-red-50 text-red-700'
                  }`}>
                    {t.complexity === 1 ? 'Simple' : t.complexity === 2 ? 'Standard' : 'Comprehensive'}
                  </span>
                  <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600">
                    {t.variant}
                  </span>
                </div>
                <div className="mt-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handlePreviewTemplate(t.id, t.name)}
                    className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    <Eye className="h-3 w-3" /> Preview
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
        )
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

      {/* Template Preview Dialog */}
      {previewTemplate && (
        <Dialog open={!!previewTemplate} onOpenChange={() => setPreviewTemplate(null)}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-[#2b6cb0]" />
                Template Preview — {previewTemplate.name}
              </DialogTitle>
            </DialogHeader>
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-6">
              <pre className="whitespace-pre-wrap text-xs text-gray-700 font-mono leading-relaxed">
                {previewTemplate.content}
              </pre>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit Resource Dialog
// ---------------------------------------------------------------------------

function AddResourceDialog({
  open,
  onClose,
  firmId,
  existing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  firmId: string;
  existing: KnowledgeResource | null;
  onSaved: () => void;
}) {
  const [category, setCategory] = useState<KnowledgeCategory>(existing?.category ?? 'statute');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [citation, setCitation] = useState(existing?.citation ?? '');
  const [content, setContent] = useState(existing?.content ?? '');
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [docTypes, setDocTypes] = useState<string[]>(existing?.docTypes ?? []);
  const [source, setSource] = useState(existing?.source ?? '');
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (existing) {
      setCategory(existing.category);
      setTitle(existing.title);
      setCitation(existing.citation ?? '');
      setContent(existing.content);
      setTags(existing.tags.join(', '));
      setDocTypes(existing.docTypes);
      setSource(existing.source ?? '');
    } else {
      setCategory('statute');
      setTitle('');
      setCitation('');
      setContent('');
      setTags('');
      setDocTypes([]);
      setSource('');
    }
  }, [existing, open]);

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error('Title and content are required.');
      return;
    }
    setSaving(true);
    try {
      const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (existing) {
        await knowledgeBaseService.updateResource({
          firmId,
          resourceId: existing.id,
          category,
          title: title.trim(),
          citation: citation.trim(),
          content: content.trim(),
          tags: tagList,
          docTypes,
          source: source.trim(),
        });
        toast.success('Resource updated.');
      } else {
        await knowledgeBaseService.addResource({
          firmId,
          category,
          title: title.trim(),
          citation: citation.trim(),
          content: content.trim(),
          tags: tagList,
          docTypes,
          source: source.trim(),
        });
        toast.success('Resource added to knowledge base.');
      }
      onSaved();
    } catch (err) {
      toast.error('Failed to save resource.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-[#2b6cb0]" />
            {existing ? 'Edit Resource' : 'Add Resource'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Category */}
          <div>
            <label className="text-xs font-medium text-gray-700">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as KnowledgeCategory)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Title & Citation */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-700">Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., NJ Wills Act"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Citation</label>
              <input
                type="text"
                value={citation}
                onChange={(e) => setCitation(e.target.value)}
                placeholder="e.g., N.J.S.A. 3B:3-1"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none"
              />
            </div>
          </div>

          {/* Content */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-700">Content *</label>
              {!existing && content.trim().length >= 20 && (
                <button
                  type="button"
                  onClick={async () => {
                    setAnalyzing(true);
                    try {
                      const suggestion = await knowledgeBaseService.analyzeContent(content);
                      setTitle(suggestion.title || title);
                      setCitation(suggestion.citation || citation);
                      setCategory((suggestion.category as KnowledgeCategory) || category);
                      setTags(suggestion.tags?.join(', ') || tags);
                      setDocTypes(suggestion.docTypes || docTypes);
                      toast.success('AI analysis complete — fields auto-filled.');
                    } catch (err) {
                      toast.error('AI analysis failed. Please fill fields manually.');
                    } finally {
                      setAnalyzing(false);
                    }
                  }}
                  disabled={analyzing}
                  className="flex items-center gap-1 rounded-md bg-purple-50 px-2.5 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-100 transition-colors disabled:opacity-50"
                >
                  <Sparkles className="h-3 w-3" />
                  {analyzing ? 'Analyzing...' : 'AI Auto-Fill'}
                </button>
              )}
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              placeholder="Paste the full text, summary, or relevant excerpt..."
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none resize-y"
            />
          </div>

          {/* Tags & Source */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-700">Tags (comma-separated)</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="will, execution, witnesses"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Source</label>
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g., ICLE Workbook 2024"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none"
              />
            </div>
          </div>

          {/* Applicable doc types */}
          <div>
            <label className="text-xs font-medium text-gray-700">Applicable Document Types</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {DOC_TYPE_OPTIONS.map((dt) => (
                <button
                  key={dt.value}
                  onClick={() =>
                    setDocTypes((prev) =>
                      prev.includes(dt.value) ? prev.filter((d) => d !== dt.value) : [...prev, dt.value],
                    )
                  }
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                    docTypes.includes(dt.value)
                      ? 'bg-[#2b6cb0] text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {dt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !title.trim() || !content.trim()}
            className="bg-[#2b6cb0] hover:bg-[#1a365d] text-white"
          >
            {saving ? 'Saving...' : existing ? 'Update Resource' : 'Add Resource'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Upload Template Dialog (with File Upload + AI Variable Detection)
// ---------------------------------------------------------------------------

interface DetectedVariable {
  originalText: string;
  suggestedVariable: string;
  fieldLabel: string;
  confidence: string;
  context: string;
}

function AddTemplateDialog({
  open,
  onClose,
  firmId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  firmId: string;
  onSaved: () => void;
}) {
  // Form state
  const [docType, setDocType] = useState('will');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [variant, setVariant] = useState('standard');
  const [complexity, setComplexity] = useState(2);
  const [content, setContent] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  // File upload state
  const [uploadMode, setUploadMode] = useState<'file' | 'manual'>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [detectedVars, setDetectedVars] = useState<DetectedVariable[]>([]);
  const [originalAiVars, setOriginalAiVars] = useState<DetectedVariable[]>([]); // Track original AI suggestions
  const [fileUrl, setFileUrl] = useState('');
  const [originalFileName, setOriginalFileName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [learningStats, setLearningStats] = useState<{ totalCorrections: number; totalTemplatesLearned: number; dictionarySize: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop();
    if (!ext || !['docx', 'pdf'].includes(ext)) {
      toast.error('Only .docx and .pdf files are supported.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) { // 20MB max
      toast.error('File size must be under 20MB.');
      return;
    }
    setSelectedFile(file);
    setDetectedVars([]);
    // Auto-set name from filename (without extension)
    if (!name.trim()) {
      const baseName = file.name.replace(/\.(docx|pdf)$/i, '').replace(/[_-]/g, ' ');
      setName(baseName);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleUploadAndProcess = async () => {
    if (!selectedFile || !firmId) return;

    setUploading(true);
    setUploadProgress(0);

    try {
      // 1. Upload to Firebase Storage
      const { ref: storageRef, uploadBytesResumable, getDownloadURL } = await import('firebase/storage');
      const { storage } = await import('@/config/firebase');
      const timestamp = Date.now();
      const safeName = selectedFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const storagePath = `firms/${firmId}/templates/${timestamp}_${safeName}`;
      const fileRef = storageRef(storage, storagePath);

      const uploadTask = uploadBytesResumable(fileRef, selectedFile);

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            setUploadProgress(progress);
          },
          (error) => reject(error),
          async () => {
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            setFileUrl(url);
            setOriginalFileName(selectedFile.name);
            resolve();
          },
        );
      });

      setUploading(false);
      setProcessing(true);

      // 2. Process the file (extract text + AI variable detection)
      const result = await templateService.processTemplateFile(firmId, storagePath, selectedFile.name);

      // Apply AI suggestions
      setContent(result.extractedHtml || '');
      if (result.suggestedDocType) setDocType(result.suggestedDocType);
      if (result.documentSummary) setDescription(result.documentSummary);
      if (result.detectedVariables?.length > 0) {
        setDetectedVars(result.detectedVariables);
        setOriginalAiVars(result.detectedVariables.map(v => ({ ...v }))); // Deep copy for diff
      }
      if (result.learningStats) setLearningStats(result.learningStats);

      toast.success(`File processed — ${result.detectedVariables?.length || 0} variables detected.`);
    } catch (err) {
      console.error('File upload/process error:', err);
      toast.error('Failed to process template file.');
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) {
      toast.error('Name and template content are required.');
      return;
    }
    setSaving(true);
    try {
      await templateService.uploadTemplate({
        firmId,
        docType,
        name: name.trim(),
        description: description.trim(),
        variant: variant.trim() || 'standard',
        complexity,
        content: content.trim(),
        isDefault,
        variables: detectedVars.map((v) => v.suggestedVariable),
        ...(fileUrl ? { fileUrl, originalFileName } : {}),
      });

      // Record learning feedback (fire-and-forget)
      if (detectedVars.length > 0) {
        // 1. Find corrections (where user changed the AI suggestion)
        const corrections = detectedVars
          .map((v, i) => {
            const original = originalAiVars[i];
            if (original && original.suggestedVariable !== v.suggestedVariable) {
              return {
                originalText: v.originalText,
                aiSuggestedVariable: original.suggestedVariable,
                userCorrectedVariable: v.suggestedVariable,
              };
            }
            return null;
          })
          .filter((c): c is NonNullable<typeof c> => c !== null);

        if (corrections.length > 0) {
          templateService.recordTemplateCorrection(firmId, corrections, name.trim(), docType).catch(console.error);
        }

        // 2. Confirm all variables to build the learning dictionary
        templateService.confirmTemplateVariables(
          firmId,
          name.trim(),
          docType,
          detectedVars.map((v) => ({
            originalText: v.originalText,
            confirmedVariable: v.suggestedVariable,
            fieldLabel: v.fieldLabel,
          })),
        ).catch(console.error);
      }

      toast.success('Template uploaded successfully.');
      // Reset form
      setName('');
      setDescription('');
      setContent('');
      setVariant('standard');
      setComplexity(2);
      setIsDefault(false);
      setSelectedFile(null);
      setDetectedVars([]);
      setOriginalAiVars([]);
      setFileUrl('');
      setOriginalFileName('');
      setLearningStats(null);
      onSaved();
    } catch {
      toast.error('Failed to upload template.');
    } finally {
      setSaving(false);
    }
  };

  const confidenceBadge = (confidence: string) => {
    const colors = {
      high: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      medium: 'bg-amber-100 text-amber-800 border-amber-200',
      low: 'bg-red-100 text-red-800 border-red-200',
    };
    return colors[confidence as keyof typeof colors] || colors.low;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-[#2b6cb0]" />
            Upload Document Template
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Mode Toggle */}
          <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-lg w-fit">
            <button
              onClick={() => setUploadMode('file')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                uploadMode === 'file'
                  ? 'bg-white text-[#2b6cb0] shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📄 Upload File
            </button>
            <button
              onClick={() => setUploadMode('manual')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                uploadMode === 'manual'
                  ? 'bg-white text-[#2b6cb0] shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              ✏️ Manual Entry
            </button>
          </div>

          {/* File Upload Area */}
          {uploadMode === 'file' && !content && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed py-10 text-center cursor-pointer transition-colors ${
                dragActive
                  ? 'border-[#2b6cb0] bg-blue-50'
                  : selectedFile
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.pdf"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              />
              {selectedFile ? (
                <div>
                  <FileText className="mx-auto h-10 w-10 text-emerald-500" />
                  <p className="mt-2 text-sm font-medium text-emerald-700">{selectedFile.name}</p>
                  <p className="text-xs text-emerald-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                  {!uploading && !processing && (
                    <Button
                      onClick={(e) => { e.stopPropagation(); handleUploadAndProcess(); }}
                      className="mt-3 bg-[#2b6cb0] hover:bg-[#1a365d] text-white"
                    >
                      <Sparkles className="mr-2 h-4 w-4" /> Upload & Detect Variables
                    </Button>
                  )}
                  {(uploading || processing) && (
                    <div className="mt-3 mx-auto max-w-xs">
                      <div className="flex items-center gap-2 text-sm text-[#2b6cb0]">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#2b6cb0] border-t-transparent" />
                        {uploading ? `Uploading... ${uploadProgress}%` : 'AI analyzing document...'}
                      </div>
                      {uploading && (
                        <div className="mt-1 h-1.5 w-full rounded-full bg-gray-200">
                          <div
                            className="h-1.5 rounded-full bg-[#2b6cb0] transition-all"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <Upload className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-2 text-sm font-medium text-gray-600">
                    Drop a .docx or .pdf file here, or click to browse
                  </p>
                  <p className="text-xs text-gray-400">Max 20MB. AI will auto-detect template variables.</p>
                </div>
              )}
            </div>
          )}

          {/* Detected Variables Table */}
          {detectedVars.length > 0 && (
            <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-600" />
                  <span className="text-sm font-semibold text-purple-800">
                    {detectedVars.length} Variable{detectedVars.length === 1 ? '' : 's'} Detected
                  </span>
                </div>
                {learningStats && (learningStats.totalTemplatesLearned > 0 || learningStats.totalCorrections > 0) && (
                  <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                    🧠 Learned from {learningStats.totalTemplatesLearned} template{learningStats.totalTemplatesLearned === 1 ? '' : 's'}, {learningStats.totalCorrections} correction{learningStats.totalCorrections === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-purple-600 mb-2">Click any mapping to edit it. Your changes train the AI for future uploads.</p>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-purple-200 bg-white">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-purple-100 bg-purple-50 text-purple-700">
                      <th className="px-3 py-2 text-left font-medium">Found in Document</th>
                      <th className="px-3 py-2 text-left font-medium">Maps to Field</th>
                      <th className="px-3 py-2 text-left font-medium">Label</th>
                      <th className="px-3 py-2 text-center font-medium">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detectedVars.map((v, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-mono text-gray-600 truncate max-w-[160px]" title={v.originalText}>
                          {v.originalText}
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            value={v.suggestedVariable}
                            onChange={(e) => {
                              const updated = [...detectedVars];
                              updated[i] = { ...updated[i], suggestedVariable: e.target.value };
                              setDetectedVars(updated);
                            }}
                            className={`w-full font-mono text-xs px-1.5 py-0.5 rounded border focus:border-[#2b6cb0] focus:outline-none ${
                              originalAiVars[i] && originalAiVars[i].suggestedVariable !== v.suggestedVariable
                                ? 'border-amber-400 bg-amber-50 text-amber-800'
                                : 'border-gray-200 text-[#2b6cb0]'
                            }`}
                            title="Edit to correct the AI mapping — your change trains the engine"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-gray-700">{v.fieldLabel}</td>
                        <td className="px-3 py-1.5 text-center">
                          <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${confidenceBadge(v.confidence)}`}>
                            {v.confidence}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* DocType & Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-700">Document Type *</label>
              <select
                title="Document Type"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none"
              >
                {DOC_TYPE_OPTIONS.map((dt) => (
                  <option key={dt.value} value={dt.value}>{dt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Template Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Simple POA"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none"
              />
            </div>
          </div>

          {/* Variant, Complexity, Default */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-700">Variant</label>
              <input
                type="text"
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                placeholder="e.g., simple, standard, springing"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Complexity</label>
              <select
                title="Complexity Level"
                value={complexity}
                onChange={(e) => setComplexity(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none"
              >
                <option value={1}>Simple (1)</option>
                <option value={2}>Standard (2)</option>
                <option value={3}>Comprehensive (3)</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="rounded border-gray-300 text-[#2b6cb0] focus:ring-[#2b6cb0]"
                />
                <span className="text-xs font-medium text-gray-700">Set as default</span>
              </label>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-gray-700">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this template variant"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none"
            />
          </div>

          {/* Template Content (manual mode or file-extracted preview) */}
          {(uploadMode === 'manual' || content) && (
            <div>
              <label className="text-xs font-medium text-gray-700">
                {uploadMode === 'file' ? 'Extracted Content (editable)' : 'Template Content (Handlebars HTML) *'}
              </label>
              {uploadMode === 'manual' && (
                <p className="mt-0.5 text-[10px] text-gray-400">
                  Use {'{{clientFullName}}'}, {'{{personalInfo.address}}'}, {'{{#if hasSpouse}}'} etc. for dynamic data.
                </p>
              )}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={uploadMode === 'file' ? 10 : 16}
                placeholder={'<h1>DURABLE POWER OF ATTORNEY</h1>\n<p>I, {{clientFullName}}, residing at {{personalInfo.address}}...'}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-[#2b6cb0] focus:outline-none resize-y"
              />
            </div>
          )}
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name.trim() || !content.trim()}
            className="bg-[#2b6cb0] hover:bg-[#1a365d] text-white"
          >
            {saving ? 'Uploading...' : 'Upload Template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bulk Import Dialog
// ---------------------------------------------------------------------------

function BulkImportDialog({
  open,
  onClose,
  firmId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  firmId: string;
  onSaved: () => void;
}) {
  const [jsonText, setJsonText] = useState('');
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<{ category: string; title: string; content: string; citation?: string; tags?: string[]; docTypes?: string[] }[] | null>(null);
  const [parseError, setParseError] = useState('');

  const handleParse = () => {
    setParseError('');
    setPreview(null);
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) {
        setParseError('Input must be a JSON array of objects.');
        return;
      }
      if (parsed.length === 0) {
        setParseError('Array is empty.');
        return;
      }
      if (parsed.length > 200) {
        setParseError('Maximum 200 resources per import.');
        return;
      }
      const invalid = parsed.filter(
        (r: { title?: string; content?: string; category?: string }) => !r.title || !r.content || !r.category,
      );
      if (invalid.length > 0) {
        setParseError(
          `${invalid.length} item(s) missing required fields (title, content, category).`,
        );
      }
      setPreview(parsed);
    } catch (e: unknown) {
      setParseError(`Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  const handleImport = async () => {
    if (!preview || !firmId) return;
    setImporting(true);
    try {
      const result = await knowledgeBaseService.bulkImportResources(firmId, preview as Parameters<typeof knowledgeBaseService.bulkImportResources>[1]);
      toast.success(`Imported ${result.imported} of ${result.total} resources.`);
      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} item(s) had errors and were skipped.`);
      }
      setJsonText('');
      setPreview(null);
      onSaved();
    } catch {
      toast.error('Bulk import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5 text-[#2b6cb0]" />
            Bulk Import Resources
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div>
            <label className="text-xs font-medium text-gray-700">
              Paste JSON Array
            </label>
            <p className="mt-0.5 text-[10px] text-gray-400">
              Each object needs: category, title, content. Optional: citation, tags[], docTypes[].
            </p>
            <textarea
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                setPreview(null);
                setParseError('');
              }}
              rows={12}
              placeholder={'[\n  {\n    "category": "statute",\n    "title": "Example Statute",\n    "citation": "N.J.S.A. 1:2-3",\n    "content": "Full text of the statute...",\n    "tags": ["tag1", "tag2"],\n    "docTypes": ["will", "trust"]\n  }\n]'}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-[#2b6cb0] focus:outline-none resize-y"
            />
          </div>

          {parseError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
              {parseError}
            </div>
          )}

          {preview && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-sm font-medium text-emerald-800">
                ✓ Parsed {preview.length} resource{preview.length === 1 ? '' : 's'} ready to import
              </p>
              <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                {preview.slice(0, 10).map((r, i) => (
                  <p key={i} className="text-xs text-emerald-700 truncate">
                    {i + 1}. [{r.category}] {r.title}
                  </p>
                ))}
                {preview.length > 10 && (
                  <p className="text-xs text-emerald-600 italic">
                    ...and {preview.length - 10} more
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {!preview ? (
            <Button
              onClick={handleParse}
              disabled={!jsonText.trim()}
              className="bg-[#2b6cb0] hover:bg-[#1a365d] text-white"
            >
              Parse JSON
            </Button>
          ) : (
            <Button
              onClick={handleImport}
              disabled={importing}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {importing ? 'Importing...' : `Import ${preview.length} Resource${preview.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
