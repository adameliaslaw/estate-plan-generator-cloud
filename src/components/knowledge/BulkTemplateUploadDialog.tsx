/**
 * BulkTemplateUploadDialog.tsx â€” extracted from KnowledgeBasePage.tsx
 */

import { useState, useRef } from 'react';
import { Upload, FileText, Layers, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { templateService } from '@/services/knowledge-base-service';
import { type DetectedVariable } from '@/components/knowledge/AddTemplateDialog';



export interface BulkTemplateResult {
  fileName: string;
  status: 'pending' | 'uploading' | 'processing' | 'saving' | 'success' | 'failed';
  docType?: string;
  variableCount?: number;
  error?: string;
}

export function BulkTemplateUploadDialog({
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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<BulkTemplateResult[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (newFiles: FileList | null) => {
    if (!newFiles) return;
    const validFiles: File[] = [];
    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      const ext = file.name.toLowerCase().split('.').pop();
      if (!ext || !['docx', 'pdf'].includes(ext)) continue;
      if (file.size > 50 * 1024 * 1024) continue; // 50MB max per template
      validFiles.push(file);
    }
    if (validFiles.length > 50) {
      toast.error('Maximum 50 templates per batch.');
      return;
    }
    setSelectedFiles((prev) => [...prev, ...validFiles].slice(0, 50));
    setResults([]);
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleProcessAll = async () => {
    if (!selectedFiles.length || !firmId) return;

    setProcessing(true);
    const initialResults: BulkTemplateResult[] = selectedFiles.map((f) => ({
      fileName: f.name,
      status: 'pending',
    }));
    setResults(initialResults);

    const { ref: storageRef, uploadBytesResumable, getDownloadURL } = await import('firebase/storage');
    const { storage } = await import('@/config/firebase');

    let successCount = 0;

    // Track per-file results for cross-template consistency check
    const processedData: {
      index: number;
      baseName: string;
      docType: string;
      variables: string[];
      templateId?: string;
    }[] = [];

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];

      try {
        // 1. Upload to Storage
        setResults((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'uploading' } : r));

        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const storagePath = `firms/${firmId}/templates/${timestamp}_${i}_${safeName}`;
        const fileRef = storageRef(storage, storagePath);
        const uploadTask = uploadBytesResumable(fileRef, file);

        const fileUrl = await new Promise<string>((resolve, reject) => {
          uploadTask.on('state_changed', null, reject, async () => {
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(url);
          });
        });

        // 2. Process (extract text + AI variable detection)
        setResults((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'processing' } : r));

        const processed = await templateService.processTemplateFile(firmId, storagePath, file.name);
        const detectedDocType = processed.suggestedDocType || 'will';
        const baseName = file.name.replace(/\.(docx|pdf)$/i, '').replace(/[_-]/g, ' ');

        // 3. Auto-save template
        setResults((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'saving', docType: detectedDocType, variableCount: processed.detectedVariables?.length || 0 } : r));

        const saveResult = await templateService.uploadTemplate({
          firmId,
          docType: detectedDocType,
          name: baseName,
          description: processed.documentSummary || '',
          variant: 'standard',
          complexity: 2,
          content: processed.extractedHtml || processed.extractedText || '',
          isDefault: false,
          variables: processed.detectedVariables?.map((v: DetectedVariable) => v.suggestedVariable) || [],
          tags: processed.suggestedTags || [],
          fileUrl,
          originalFileName: file.name,
        });

        processedData.push({
          index: i,
          baseName,
          docType: detectedDocType,
          variables: processed.detectedVariables?.map((v: DetectedVariable) => v.suggestedVariable) || [],
          templateId: saveResult.templateId,
        });

        // 4. Confirm variables for learning (fire-and-forget)
        if (processed.detectedVariables?.length > 0) {
          templateService.confirmTemplateVariables(
            firmId,
            baseName,
            detectedDocType,
            processed.detectedVariables.map((v: DetectedVariable) => ({
              originalText: v.originalText,
              confirmedVariable: v.suggestedVariable,
              fieldLabel: v.fieldLabel,
            })),
          ).catch(console.error);
        }

        setResults((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'success' } : r));
        successCount++;
      } catch (err) {
        console.error(`Bulk template upload failed for ${file.name}:`, err);
        setResults((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'failed', error: (err as Error).message || 'Processing failed' } : r));
      }
    }

    // -----------------------------------------------------------------------
    // Fix 3: Cross-template consistency check
    // Group by docType, take the union of variable sets, re-save any template
    // that was missing variables detected in its sibling(s).
    // -----------------------------------------------------------------------
    if (processedData.length > 1) {
      const byDocType = new Map<string, typeof processedData>();
      for (const pd of processedData) {
        const group = byDocType.get(pd.docType) || [];
        group.push(pd);
        byDocType.set(pd.docType, group);
      }

      let reconciledCount = 0;
      for (const [docType, group] of byDocType) {
        if (group.length < 2) continue;

        // Build union of all variable sets in this docType group
        const unionVars = new Set<string>();
        for (const pd of group) {
          for (const v of pd.variables) unionVars.add(v);
        }

        // Re-save any template that has fewer variables than the union
        for (const pd of group) {
          if (pd.variables.length < unionVars.size && pd.templateId) {
            const missing = [...unionVars].filter((v) => !pd.variables.includes(v));
            console.log(
              `[BulkUpload] Consistency: "${pd.baseName}" (${docType}) had ${pd.variables.length} vars, ` +
              `union has ${unionVars.size}. Adding ${missing.length} from siblings: ${missing.join(', ')}`,
            );

            // Re-save with the full union variable set
            templateService.uploadTemplate({
              firmId,
              templateId: pd.templateId,
              docType,
              name: pd.baseName,
              content: '', // empty = keep existing content (update only variables)
              variables: [...unionVars],
            }).catch(console.error);

            // Update result display to reflect reconciled count
            setResults((prev) => prev.map((r, idx) =>
              idx === pd.index ? { ...r, variableCount: unionVars.size } : r,
            ));
            reconciledCount++;
          }
        }
      }

      if (reconciledCount > 0) {
        toast.info(`Cross-template consistency: reconciled variables for ${reconciledCount} template(s).`);
      }
    }

    setProcessing(false);
    if (successCount > 0) {
      toast.success(`Successfully processed ${successCount} of ${selectedFiles.length} template(s).`);
      onSaved();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg" aria-describedby="bulk-template-desc">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-[#2b6cb0]" />
            Bulk Upload Templates
          </DialogTitle>
          <p id="bulk-template-desc" className="text-xs text-gray-500 mt-1">
            Upload multiple .pdf or .docx files. Each will be auto-processed with AI to detect document type and variables.
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Drop zone */}
          {!results.length && (
            <div
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 transition-colors cursor-pointer ${
                dragActive ? 'border-[#2b6cb0] bg-blue-50' : 'border-gray-300 hover:border-gray-400'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 text-gray-400 mb-2" />
              <p className="text-sm text-gray-600 font-medium">Drop template files here</p>
              <p className="text-xs text-gray-400 mt-1">.pdf and .docx • up to 50 files • 50MB each</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx"
                multiple
                className="hidden"
                title="Select template files"
                aria-label="Select template files"
                onChange={(e) => { handleFileSelect(e.target.files); e.target.value = ''; }}
              />
            </div>
          )}

          {/* Selected files / results list */}
          {selectedFiles.length > 0 && (
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {selectedFiles.map((file, i) => {
                const result = results[i];
                const statusIcon = !result || result.status === 'pending'
                  ? <FileText className="h-4 w-4 text-gray-400" />
                  : result.status === 'success'
                    ? <span className="text-emerald-500 text-sm">✓</span>
                    : result.status === 'failed'
                      ? <span className="text-red-500 text-sm">✗</span>
                      : <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#2b6cb0] border-t-transparent" />;

                return (
                  <div key={`${file.name}-${i}`} className="px-3 py-2">
                    <div className="flex items-center gap-3 text-sm">
                      {statusIcon}
                      <span className="flex-1 truncate text-gray-700">{file.name}</span>
                      {result?.docType && (
                        <span className="text-[10px] rounded bg-blue-50 px-1.5 py-0.5 text-[#2b6cb0] font-medium">{result.docType}</span>
                      )}
                      {result?.variableCount != null && result.variableCount > 0 && (
                        <span className="text-[10px] text-gray-400">{result.variableCount} vars</span>
                      )}
                      {!processing && !results.length && (
                        <button
                          onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                          title="Remove file"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {result?.status === 'failed' && result.error && (
                      <p className="text-[10px] text-red-500 ml-7 mt-0.5">{result.error}</p>
                    )}
                    {result && ['uploading', 'processing', 'saving'].includes(result.status) && (
                      <p className="text-[10px] text-[#2b6cb0] ml-7 mt-0.5">
                        {result.status === 'uploading' ? 'Uploading...' : result.status === 'processing' ? 'AI extracting text & variables...' : 'Saving template...'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Summary */}
          {results.length > 0 && !processing && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
              <p className="text-sm font-medium text-gray-700">
                ✓ Processed {results.filter((r) => r.status === 'success').length} of {results.length} templates
                {results.some((r) => r.status === 'failed') && ` • ${results.filter((r) => r.status === 'failed').length} failed`}
              </p>
              <p className="text-xs text-gray-500 mt-1">Templates are saved with AI-detected settings. Edit individual templates to refine variables and doc type.</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={processing}>
            {results.length > 0 && !processing ? 'Close' : 'Cancel'}
          </Button>
          {selectedFiles.length > 0 && !results.length && (
            <Button
              onClick={handleProcessAll}
              disabled={processing}
              className="bg-[#2b6cb0] hover:bg-[#1a365d] text-white"
            >
              Process {selectedFiles.length} Template{selectedFiles.length === 1 ? '' : 's'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
