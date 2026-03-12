/**
 * BulkImportDialog.tsx â€” extracted from KnowledgeBasePage.tsx
 * (Knowledge Base resource bulk import â€” NOT the client CSV import)
 */

import { useState, useCallback } from 'react';
import { FileJson, Plus, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  knowledgeBaseService,
  type KnowledgeCategory,
} from '@/services/knowledge-base-service';

export function BulkImportDialog({
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
  const [mode, setMode] = useState<'files' | 'json'>('files');

  // ── File upload state ──
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [fileProgress, setFileProgress] = useState<Record<number, number>>({});
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadResults, setUploadResults] = useState<{
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
  } | null>(null);

  // ── OCR page range state (per-file, keyed by file index) ──
  const [ocrRanges, setOcrRanges] = useState<Record<number, { start: string; end: string }>>({}); 

  // ── JSON state ──
  const [jsonText, setJsonText] = useState('');
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<{ category: string; title: string; content: string; citation?: string; tags?: string[]; docTypes?: string[] }[] | null>(null);
  const [parseError, setParseError] = useState('');

  // ── File handlers ──
  const handleFileSelect = (newFiles: FileList | null) => {
    if (!newFiles) return;
    if (newFiles.length === 0) return;
    const validFiles: File[] = [];
    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      const ext = file.name.toLowerCase().split('.').pop();
      if (!ext || !['docx', 'pdf'].includes(ext)) continue;
      if (file.size > 200 * 1024 * 1024) continue; // 200MB max
      validFiles.push(file);
    }
    if (validFiles.length > 100) {
      toast.error('Maximum 100 files per batch.');
      return;
    }
    setSelectedFiles((prev) => [...prev, ...validFiles].slice(0, 100));
    setUploadResults(null);
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleUploadAndProcess = async () => {
    if (!selectedFiles.length || !firmId) return;

    setUploading(true);
    setFileProgress({});
    setUploadResults(null);

    try {
      // Build validated OCR ranges from user input
      const validRanges: Record<number, { start: number; end: number }> = {};
      for (const [idx, range] of Object.entries(ocrRanges)) {
        const s = parseInt(range.start, 10);
        const e = parseInt(range.end, 10);
        if (s > 0 && e > 0 && e >= s && (e - s + 1) <= 150) {
          validRanges[Number(idx)] = { start: s, end: e };
        }
      }

      const result = await knowledgeBaseService.bulkUploadFiles(
        firmId,
        selectedFiles,
        (fileIndex, progress) => {
          setFileProgress((prev) => ({ ...prev, [fileIndex]: progress }));
        },
        Object.keys(validRanges).length > 0 ? validRanges : undefined,
      );

      setUploading(false);
      setProcessing(false);
      setUploadResults(result);

      if (result.processed > 0) {
        toast.success(`Successfully processed ${result.processed} of ${result.total} files.`);
        onSaved();
      }
      if (result.failed > 0) {
        toast.warning(`${result.failed} file(s) failed to process.`);
      }
    } catch (err) {
      console.error('Bulk upload error:', err);
      toast.error('Bulk upload failed. Please try again.');
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  // When all files finish uploading, show "processing" state
  const allUploaded = uploading && selectedFiles.length > 0 &&
    selectedFiles.every((_, i) => (fileProgress[i] ?? 0) >= 100);

  useEffect(() => {
    if (allUploaded && !processing) {
      setProcessing(true);
    }
  }, [allUploaded, processing]);

  // ── JSON handlers ──
  const handleParse = () => {
    setParseError('');
    setPreview(null);
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) { setParseError('Input must be a JSON array of objects.'); return; }
      if (parsed.length === 0) { setParseError('Array is empty.'); return; }
      if (parsed.length > 200) { setParseError('Maximum 200 resources per import.'); return; }
      const invalid = parsed.filter((r: { title?: string; content?: string; category?: string }) => !r.title || !r.content || !r.category);
      if (invalid.length > 0) {
        setParseError(`${invalid.length} item(s) missing required fields (title, content, category).`);
      }
      setPreview(parsed);
    } catch (e: unknown) {
      setParseError(`Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  const handleJsonImport = async () => {
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
            <Upload className="h-5 w-5 text-[#2b6cb0]" />
            Bulk Import Resources
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Mode Toggle */}
          <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-lg w-fit" role="group" aria-label="Import mode selection">
            <button
              type="button"
              onClick={() => setMode('files')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'files'
                  ? 'bg-white text-[#2b6cb0] shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📄 Upload Files
            </button>
            <button
              type="button"
              onClick={() => setMode('json')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'json'
                  ? 'bg-white text-[#2b6cb0] shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📋 Paste JSON
            </button>
          </div>

          {/* ═══ FILE UPLOAD MODE ═══ */}
          {mode === 'files' && (
            <>
              {/* Drop zone */}
              {!uploadResults && (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  className={`relative rounded-xl border-2 border-dashed py-8 text-center transition-colors ${
                    dragActive
                      ? 'border-[#2b6cb0] bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                  } ${uploading ? 'pointer-events-none opacity-50' : ''}`}
                >
                  {/* Invisible file input covering the entire drop zone */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx"
                    multiple
                    title="Upload knowledge base files"
                    aria-label="Upload knowledge base files"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    onChange={(e) => { handleFileSelect(e.target.files); e.target.value = ''; }}
                  />
                  <Upload className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-2 text-sm font-medium text-gray-600">
                    Drop .pdf or .docx files here, or click to browse
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Up to 100 files • 200MB each • AI auto-enriches metadata
                  </p>
                </div>
              )}

              {/* Selected files list */}
              {selectedFiles.length > 0 && !uploadResults && (
                <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-48 overflow-y-auto">
                {selectedFiles.map((file, i) => {
                    const isPdf = file.name.toLowerCase().endsWith('.pdf');
                    const range = ocrRanges[i];
                    const rangeSpan = range?.start && range?.end
                      ? parseInt(range.end, 10) - parseInt(range.start, 10) + 1
                      : 0;
                    const rangeError = rangeSpan > 150;
                    return (
                    <div key={`${file.name}-${i}`} className="px-3 py-2">
                      <div className="flex items-center gap-3 text-sm">
                        <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
                        <span className="flex-1 truncate text-gray-700">{file.name}</span>
                        <span className="text-xs text-gray-400 flex-shrink-0">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                      {uploading ? (
                        <div className="w-16 flex-shrink-0">
                          <div className="h-1.5 w-full rounded-full bg-gray-200">
                            <div
                              className="h-1.5 rounded-full bg-[#2b6cb0] transition-all duration-300"
                              style={{ width: `${fileProgress[i] ?? 0}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                          title="Remove file"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      </div>
                      {/* OCR page range inputs for PDFs */}
                      {isPdf && !uploading && (
                        <div className="mt-1.5 ml-7 flex items-center gap-2">
                          <span className="text-[10px] text-gray-500 font-medium whitespace-nowrap">OCR pages:</span>
                          <input
                            type="number"
                            min={1}
                            placeholder="Start"
                            value={range?.start ?? ''}
                            onChange={(e) => setOcrRanges((prev) => ({ ...prev, [i]: { ...prev[i], start: e.target.value, end: prev[i]?.end ?? '' }})) }
                            className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 placeholder:text-gray-300 focus:border-blue-400 focus:outline-none"
                          />
                          <span className="text-[10px] text-gray-400">–</span>
                          <input
                            type="number"
                            min={1}
                            placeholder="End"
                            value={range?.end ?? ''}
                            onChange={(e) => setOcrRanges((prev) => ({ ...prev, [i]: { ...prev[i], end: e.target.value, start: prev[i]?.start ?? '' }})) }
                            className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 placeholder:text-gray-300 focus:border-blue-400 focus:outline-none"
                          />
                          {rangeSpan > 0 && (
                            <span className={`text-[10px] font-medium ${rangeError ? 'text-red-500' : 'text-gray-400'}`}>
                              {rangeSpan} pg{rangeSpan !== 1 ? 's' : ''}{rangeError ? ' (max 150)' : ''}
                            </span>
                          )}
                          {!range?.start && !range?.end && (
                            <span className="text-[10px] text-gray-400 italic">Leave blank for auto (first 150)</span>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}

              {/* Processing indicator */}
              {processing && (
                <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 flex items-center gap-3">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#2b6cb0] border-t-transparent flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-[#2b6cb0]">Processing files...</p>
                    <p className="text-xs text-blue-600 mt-0.5">Extracting text, running OCR on scanned pages, and AI-enriching metadata. This may take a minute.</p>
                  </div>
                </div>
              )}

              {/* Results */}
              {uploadResults && (
                <div className="space-y-3">
                  <div className={`rounded-lg px-4 py-3 ${
                    uploadResults.failed === 0
                      ? 'bg-emerald-50 border border-emerald-200'
                      : 'bg-amber-50 border border-amber-200'
                  }`}>
                    <p className={`text-sm font-medium ${uploadResults.failed === 0 ? 'text-emerald-800' : 'text-amber-800'}`}>
                      ✓ Processed {uploadResults.processed} of {uploadResults.total} files
                      {uploadResults.failed > 0 && ` • ${uploadResults.failed} failed`}
                    </p>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {uploadResults.results.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 text-xs">
                        <span className={`flex-shrink-0 ${r.status === 'success' ? 'text-emerald-500' : 'text-red-500'}`}>
                          {r.status === 'success' ? '✓' : '✗'}
                        </span>
                        <span className="flex-1 truncate text-gray-700">{r.fileName}</span>
                        {r.status === 'success' && (
                          <>
                            <span className="text-gray-400">{(r.extractedChars / 1000).toFixed(1)}K chars</span>
                            {r.ocrPagesCount > 0 && (
                              <span className="text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded text-[10px]">
                                OCR {r.ocrPagesCount}pg
                              </span>
                            )}
                          </>
                        )}
                        {r.error && <span className="text-red-500 truncate max-w-[150px]" title={r.error}>{r.error}</span>}
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setSelectedFiles([]); setUploadResults(null); setFileProgress({}); }}
                  >
                    Upload More Files
                  </Button>
                </div>
              )}
            </>
          )}

          {/* ═══ JSON MODE ═══ */}
          {mode === 'json' && (
            <>
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
            </>
          )}
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={onClose}>
            {uploadResults ? 'Done' : 'Cancel'}
          </Button>
          {mode === 'files' && !uploadResults && (
            <Button
              onClick={handleUploadAndProcess}
              disabled={uploading || processing || selectedFiles.length === 0}
              className="bg-[#2b6cb0] hover:bg-[#1a365d] text-white"
            >
              {uploading || processing ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2" />
                  {processing ? 'Processing...' : 'Uploading...'}
                </>
              ) : (
                `Upload & Process ${selectedFiles.length} File${selectedFiles.length === 1 ? '' : 's'}`
              )}
            </Button>
          )}
          {mode === 'json' && !preview && (
            <Button
              onClick={handleParse}
              disabled={!jsonText.trim()}
              className="bg-[#2b6cb0] hover:bg-[#1a365d] text-white"
            >
              Parse JSON
            </Button>
          )}
          {mode === 'json' && preview && (
            <Button
              onClick={handleJsonImport}
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
