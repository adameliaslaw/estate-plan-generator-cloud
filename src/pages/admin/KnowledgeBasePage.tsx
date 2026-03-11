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
  BookMarked,
  ClipboardList,
  StickyNote,
  Upload,
  Layers,
  Eye,
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
  const [editingResource, setEditingResource] = useState<KnowledgeResource | null>(null);
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
            <Button
              onClick={() => setShowAddResource(true)}
              className="bg-[#2b6cb0] hover:bg-[#1a365d] text-white"
            >
              <Plus className="mr-2 h-4 w-4" /> Add Resource
            </Button>
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
          <div className="rounded-xl border-2 border-dashed border-gray-300 py-16 text-center">
            <BookOpen className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-600">No resources found</p>
            <p className="mt-1 text-xs text-gray-400">Add statutes, case law, CLE materials, and more.</p>
            <Button onClick={() => setShowAddResource(true)} className="mt-4 bg-[#2b6cb0] hover:bg-[#1a365d] text-white">
              <Plus className="mr-2 h-4 w-4" /> Add Resource
            </Button>
          </div>
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
            <label className="text-xs font-medium text-gray-700">Content *</label>
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
// Upload Template Dialog
// ---------------------------------------------------------------------------

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
  const [docType, setDocType] = useState('will');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [variant, setVariant] = useState('standard');
  const [complexity, setComplexity] = useState(2);
  const [content, setContent] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

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
      });
      toast.success('Template uploaded successfully.');
      // Reset form
      setName('');
      setDescription('');
      setContent('');
      setVariant('standard');
      setComplexity(2);
      setIsDefault(false);
      onSaved();
    } catch (err) {
      toast.error('Failed to upload template.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-[#2b6cb0]" />
            Upload Document Template
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* DocType & Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-700">Document Type *</label>
              <select
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

          {/* Template Content */}
          <div>
            <label className="text-xs font-medium text-gray-700">
              Template Content (Handlebars HTML) *
            </label>
            <p className="mt-0.5 text-[10px] text-gray-400">
              Use {'{{clientFullName}}'}, {'{{personalInfo.address}}'}, {'{{#if hasSpouse}}'} etc. for dynamic data.
            </p>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={16}
              placeholder={'<h1>DURABLE POWER OF ATTORNEY</h1>\n<p>I, {{clientFullName}}, residing at {{personalInfo.address}}...'}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-[#2b6cb0] focus:outline-none resize-y"
            />
          </div>
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
