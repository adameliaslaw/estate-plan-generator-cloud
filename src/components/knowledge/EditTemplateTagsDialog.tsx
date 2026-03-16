/**
 * EditTemplateTagsDialog.tsx
 *
 * Lightweight dialog for editing tags on an existing template.
 * Uses the same predefined TEMPLATE_TAGS categories as AddTemplateDialog.
 */

import { useState, useEffect } from 'react';
import { Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  templateService,
  type TemplateVariant,
} from '@/services/knowledge-base-service';

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

export function EditTemplateTagsDialog({
  open,
  onClose,
  firmId,
  template,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  firmId: string;
  template: TemplateVariant | null;
  onSaved: () => void;
}) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Sync from template prop when dialog opens
  useEffect(() => {
    if (template) {
      setSelectedTags([...(template.tags ?? [])]);
    }
  }, [template, open]);

  const handleSave = async () => {
    if (!template) return;
    setSaving(true);
    try {
      await templateService.updateTemplateTags(firmId, template, selectedTags);
      toast.success('Template tags updated.');
      onSaved();
    } catch {
      toast.error('Failed to update template tags.');
    } finally {
      setSaving(false);
    }
  };

  const toggleTag = (value: string) => {
    setSelectedTags((prev) =>
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value],
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-[#2b6cb0]" />
            Edit Tags — {template?.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-4">
          {TEMPLATE_TAGS.map((group) => (
            <div key={group.category}>
              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                {group.category}
              </span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {group.tags.map((tag) => (
                  <button
                    key={tag.value}
                    type="button"
                    onClick={() => toggleTag(tag.value)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      selectedTags.includes(tag.value)
                        ? 'bg-[#2b6cb0] text-white ring-1 ring-[#2b6cb0]'
                        : `${tag.color} hover:opacity-80`
                    }`}
                  >
                    {selectedTags.includes(tag.value) ? '✓ ' : ''}{tag.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#2b6cb0] hover:bg-[#1a365d] text-white"
          >
            {saving ? 'Saving...' : 'Save Tags'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
