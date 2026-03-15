/**
 * VersionHistoryDialog.tsx
 *
 * Shows all prior versions of a document. Attorneys can preview content
 * and revert to any prior version (the current version is snapshotted
 * first, so reverts are themselves reversible).
 */

import { useState, useEffect } from 'react';
import { History, RotateCcw, Eye, Loader2, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { documentService } from '@/services/document-service';
import { cn } from '@/lib/utils';

interface VersionSummary {
  versionNumber: number;
  displayName: string;
  status: string;
  changeNotes: string;
  createdBy: string;
  createdAt: string | null;
  contentPreview: string;
  hasFullContent: boolean;
}

interface Props {
  firmId: string;
  clientId: string;
  documentId: string;
  documentName: string;
  currentVersion: number;
  open: boolean;
  onClose: () => void;
}

export default function VersionHistoryDialog({
  firmId,
  clientId,
  documentId,
  documentName,
  currentVersion,
  open,
  onClose,
}: Props) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const [previewContent, setPreviewContent] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const [reverting, setReverting] = useState(false);
  const [revertSuccess, setRevertSuccess] = useState('');

  // Fetch versions when dialog opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    setVersions([]);
    setPreviewVersion(null);
    setPreviewContent('');
    setRevertSuccess('');

    documentService
      .getDocumentVersions({ firmId, clientId, documentId })
      .then((res) => setVersions(res.versions))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load versions.'))
      .finally(() => setLoading(false));
  }, [open, firmId, clientId, documentId]);

  const handlePreview = async (versionNumber: number) => {
    setPreviewVersion(versionNumber);
    setPreviewLoading(true);
    try {
      const res = await documentService.getDocumentVersionContent({
        firmId,
        clientId,
        documentId,
        versionNumber,
      });
      setPreviewContent(res.content);
    } catch (err) {
      setPreviewContent(`Error loading content: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRevert = async (targetVersion: number) => {
    setReverting(true);
    setError('');
    try {
      const res = await documentService.revertDocumentVersion({
        firmId,
        clientId,
        documentId,
        targetVersion,
      });
      setRevertSuccess(res.message);
      // Refresh version list
      const updated = await documentService.getDocumentVersions({ firmId, clientId, documentId });
      setVersions(updated.versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revert failed.');
    } finally {
      setReverting(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
            <History className="h-5 w-5 text-[#2b6cb0]" />
            Version History
          </DialogTitle>
          <DialogDescription>
            {documentName} — Current version: {currentVersion}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-[#2b6cb0]" />
            <span className="ml-2 text-sm text-gray-500">Loading versions…</span>
          </div>
        )}

        {error && (
          <Alert className="border-red-200 bg-red-50">
            <AlertDescription className="text-sm text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {revertSuccess && (
          <Alert className="border-emerald-200 bg-emerald-50">
            <AlertDescription className="text-sm text-emerald-800">✅ {revertSuccess}</AlertDescription>
          </Alert>
        )}

        {!loading && versions.length === 0 && !error && (
          <div className="py-8 text-center text-sm text-gray-500">
            No prior versions found. Version history begins after the first regeneration.
          </div>
        )}

        {versions.length > 0 && (
          <div className="space-y-2">
            {versions.map((v) => (
              <div
                key={v.versionNumber}
                className={cn(
                  'rounded-lg border p-3 transition-all',
                  previewVersion === v.versionNumber
                    ? 'border-[#2b6cb0] bg-[#ebf4ff]/50'
                    : 'border-gray-200 hover:border-gray-300',
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">
                      {v.versionNumber}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-[#1a365d]">
                        Version {v.versionNumber}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatDate(v.createdAt)} · {v.changeNotes}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-xs text-[#2b6cb0]"
                      onClick={() => handlePreview(v.versionNumber)}
                      disabled={previewLoading && previewVersion === v.versionNumber}
                    >
                      {previewLoading && previewVersion === v.versionNumber ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Eye className="h-3 w-3" />
                      )}
                      Preview
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-xs text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                      onClick={() => handleRevert(v.versionNumber)}
                      disabled={reverting}
                    >
                      {reverting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      Revert
                    </Button>
                  </div>
                </div>

                {/* Preview panel */}
                {previewVersion === v.versionNumber && previewContent && (
                  <div className="mt-3 rounded-md border border-gray-200 bg-white p-3">
                    <div className="flex items-center gap-1 text-xs text-gray-400 mb-2">
                      <ChevronRight className="h-3 w-3" />
                      Content preview for version {v.versionNumber}
                    </div>
                    <div
                      className="prose prose-sm max-h-64 overflow-y-auto text-sm"
                      dangerouslySetInnerHTML={{ __html: previewContent }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
