/**
 * AddResourceDialog.tsx â€” extracted from KnowledgeBasePage.tsx
 */

import { useState, useEffect } from 'react';
import { BookOpen, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  knowledgeBaseService,
  type KnowledgeResource,
  type KnowledgeCategory,
} from '@/services/knowledge-base-service';
import { DOC_TYPES } from '@/config/constants';

const CATEGORIES: { key: KnowledgeCategory; label: string }[] = [
  { key: 'statute', label: 'Statutes' },
  { key: 'case_law', label: 'Case Law' },
  { key: 'cle_material', label: 'CLE Materials' },
  { key: 'checklist', label: 'Checklists' },
  { key: 'practice_note', label: 'Practice Notes' },
  { key: 'form_template', label: 'Form Templates' },
  { key: 'custom', label: 'Custom' },
];

const DOC_TYPE_OPTIONS = Object.entries(DOC_TYPES).map(([, value]) => ({
  value,
  label: value
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s: string) => s.toUpperCase())
    .trim(),
}));

export function AddResourceDialog({
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
    } catch {
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
              title="Category"
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
                    } catch {
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
