/**
 * EditTemplateContentDialog.tsx
 *
 * Split-pane editor for an existing template's Handlebars HTML content with
 * a live preview rendered against a real firm client (defaults to Karen Elias).
 *
 * Use this to correct bad variable mappings in uploaded templates — e.g.
 * changing {{spouseTitle}}/{{spouseFullName}} (the templatizer's default guess
 * when it saw "my husband, SEAN BYRNES") into the correct
 * {{fiduciaries.healthcareProxy.primary.relationship}} / `.name` paths.
 *
 * Content is saved via the existing `uploadTemplate` Cloud Function with a
 * templateId; the Cloud Function auto-extracts the variables list so the
 * template record stays in sync.
 */

import { useEffect, useState } from 'react';
import { Loader2, Save, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { templateService, type TemplateVariant } from '@/services/knowledge-base-service';
import TemplatePreviewPanel from './TemplatePreviewPanel';

interface Props {
  open: boolean;
  onClose: () => void;
  firmId: string;
  template: TemplateVariant | null;
  onSaved: () => void;
}

export default function EditTemplateContentDialog({
  open,
  onClose,
  firmId,
  template,
  onSaved,
}: Props) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch full content when dialog opens
  useEffect(() => {
    if (!open || !template || !firmId) return;
    let cancelled = false;
    setLoading(true);
    templateService
      .getTemplateContent(firmId, template.id)
      .then((full) => {
        if (cancelled) return;
        const fetched = full.content ?? '';
        setContent(fetched);
        setOriginalContent(fetched);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(
          err instanceof Error ? err.message : 'Failed to load template content.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, firmId, template]);

  const handleSave = async () => {
    if (!template) return;
    if (content.trim().length === 0) {
      toast.error('Template content cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      await templateService.updateTemplateContent(firmId, template, content);
      toast.success('Template content saved.');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const dirty = content !== originalContent;

  const handleCloseGuarded = () => {
    if (saving) return;
    if (dirty) {
      const ok = window.confirm('Discard unsaved changes?');
      if (!ok) return;
    }
    setContent('');
    setOriginalContent('');
    onClose();
  };

  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleCloseGuarded()}>
      <DialogContent className="max-w-7xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
            <FileText className="h-5 w-5 text-[#2b6cb0]" />
            Edit Template Content — {template.name}
          </DialogTitle>
          <DialogDescription>
            Correct Handlebars variable mappings. Preview renders against a real
            firm client — use it to verify each change before saving.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-1 items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-[#2b6cb0]" />
            <span className="ml-2 text-sm text-gray-500">Loading template…</span>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-2 gap-3 overflow-hidden" style={{ minHeight: '28rem' }}>
            <div className="flex flex-col overflow-hidden">
              <label className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Handlebars HTML
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono focus:border-[#2b6cb0] focus:outline-none"
                spellCheck={false}
              />
              <p className="mt-1 text-[10px] text-gray-400">
                {content.length.toLocaleString()} chars
                {dirty && <span className="ml-2 font-semibold text-amber-600">· unsaved</span>}
              </p>
            </div>
            <TemplatePreviewPanel firmId={firmId} template={content} />
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCloseGuarded} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || loading || !dirty}
            className="gap-1.5 bg-[#1a365d] hover:bg-[#1e407a] text-white"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Content
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
