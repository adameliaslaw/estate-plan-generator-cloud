/**
 * UploadDraftDialog.tsx
 *
 * Dialog for uploading existing document drafts (.docx / .pdf) into a client's vault.
 * Mirrors the template upload experience:
 *   1. File selection (drag-drop or browse)
 *   2. Upload to Firebase Storage
 *   3. AI analysis via processTemplateFile (content extraction + variable detection + doc type suggestion)
 *   4. User reviews / confirms doc type, name, and detected variable mappings
 *   5. Saves as a Firestore document record in the client vault
 */

import { useState, useRef } from 'react';
import { Upload, FileText, Sparkles, CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { templateService } from '@/services/knowledge-base-service';
import { DOC_TYPES } from '@/config/constants';
import { useAuth } from '@/hooks/useAuth';

// ── Firestore helpers ─────────────────────────────────────────────────────────

async function saveUploadedDraftToVault(params: {
  firmId: string;
  clientId: string;
  docType: string;
  displayName: string;
  content: string;
  storagePath: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  createdBy: string;
}): Promise<string> {
  const { collection, addDoc, serverTimestamp, Timestamp } = await import('firebase/firestore');
  const { db } = await import('@/config/firebase');

  const SIGNATURE_REQUIRED = new Set(['will', 'pourOverWill', 'poa', 'livingWill', 'trust', 'deed']);

  // serverTimestamp() is only valid at the top level of a document — NOT inside arrays.
  // Use Timestamp.now() for the version entry (embedded in the versions array).
  const versionEntry = {
    versionNumber: 1,
    createdAt: Timestamp.now(),
    createdBy: params.createdBy,
    changeNotes: 'Uploaded existing draft',
  };

  const ref = collection(
    db,
    'firms', params.firmId,
    'clients', params.clientId,
    'documents',
  );

  const snap = await addDoc(ref, {
    firmId: params.firmId,
    clientId: params.clientId,
    docType: params.docType,
    displayName: params.displayName,
    status: 'draft',
    // editorContent is what DocumentEditor reads on open (TipTap loads this field)
    editorContent: params.content,
    // content kept for reference / template engine
    content: params.content,
    storagePath: params.storagePath,
    fileName: params.fileName,
    fileSizeBytes: params.fileSizeBytes,
    mimeType: params.mimeType,
    currentVersion: 1,
    versions: [versionEntry],
    generatedByAI: false,
    uploadedDraft: true,
    requiresSignature: SIGNATURE_REQUIRED.has(params.docType),
    // `notarized` = "has been notarized" (a completion state, next to
    // notarizedAt/notaryName). An uploaded draft has not been notarized — the
    // doc-type notarization *requirement* must not be written here (R5-031).
    notarized: false,
    tags: ['uploaded-draft'],
    isConfidential: true,
    changeNotes: 'Uploaded existing draft',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: params.createdBy,
    updatedBy: params.createdBy,
  });

  return snap.id;
}


// ── Doc type options ──────────────────────────────────────────────────────────

const DOC_TYPE_OPTIONS = Object.entries(DOC_TYPES).map(([, value]) => ({
  value,
  label: value
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s: string) => s.toUpperCase())
    .trim(),
}));

// ── Detected variable type ────────────────────────────────────────────────────

interface DetectedVariable {
  originalText: string;
  suggestedVariable: string;
  fieldLabel: string;
  confidence: string;
  context: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  firmId: string;
  clientId: string;
}

export default function UploadDraftDialog({ open, onClose, firmId, clientId }: Props) {
  const { user } = useAuth();

  // File
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload / processing state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processing, setProcessing] = useState(false);

  // AI results
  const [extractedContent, setExtractedContent] = useState('');
  const [storagePath, setStoragePath] = useState('');
  const [detectedVars, setDetectedVars] = useState<DetectedVariable[]>([]);

  // Form
  const [docType, setDocType] = useState('will');
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);

  const processed = !!extractedContent;

  // ── File handling ──────────────────────────────────────────────────────────

  const handleFileSelect = (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop();
    if (!ext || !['docx', 'pdf'].includes(ext)) {
      toast.error('Only .docx and .pdf files are supported.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('File size must be under 20MB.');
      return;
    }
    setSelectedFile(file);
    setExtractedContent('');
    setDetectedVars([]);
    setStoragePath('');
    // Auto-fill display name from file name
    if (!displayName.trim()) {
      const baseName = file.name.replace(/\.(docx|pdf)$/i, '').replace(/[_-]/g, ' ');
      setDisplayName(baseName);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]);
  };

  // ── Upload + AI process ────────────────────────────────────────────────────

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
      const path = `firms/${firmId}/clients/${clientId}/uploads/${timestamp}_${safeName}`;
      const fileRef = storageRef(storage, path);
      const uploadTask = uploadBytesResumable(fileRef, selectedFile);

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            setUploadProgress(pct);
          },
          (err) => reject(err),
          async () => {
            await getDownloadURL(uploadTask.snapshot.ref);
            setStoragePath(path);
            resolve();
          },
        );
      });

      setUploading(false);
      setProcessing(true);

      // 2. AI extraction + variable detection via processTemplateFile
      const result = await templateService.processTemplateFile(firmId, path, selectedFile.name);

      setExtractedContent(result.extractedHtml || '');
      if (result.suggestedDocType) setDocType(result.suggestedDocType);
      if (result.documentSummary && !displayName.trim()) setDisplayName(result.documentSummary.slice(0, 80));
      if (result.detectedVariables?.length > 0) setDetectedVars(result.detectedVariables);

      toast.success(
        `Document analyzed — ${result.detectedVariables?.length ?? 0} variable${result.detectedVariables?.length === 1 ? '' : 's'} detected.`,
      );
    } catch (err) {
      console.error('[UploadDraftDialog] Upload/process error:', err);
      toast.error('Failed to process the file. Please try again.');
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  // ── Save to vault ──────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!displayName.trim() || !extractedContent || !selectedFile) {
      toast.error('Please upload and process a file first.');
      return;
    }
    setSaving(true);
    try {
      await saveUploadedDraftToVault({
        firmId,
        clientId,
        docType,
        displayName: displayName.trim(),
        content: extractedContent,
        storagePath,
        fileName: selectedFile.name,
        fileSizeBytes: selectedFile.size,
        mimeType: selectedFile.type || (selectedFile.name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        createdBy: user?.uid ?? 'unknown',
      });
      toast.success('Draft uploaded and saved to vault.');
      handleClose();
    } catch (err) {
      console.error('[UploadDraftDialog] Save error:', err);
      toast.error('Failed to save draft to vault.');
    } finally {
      setSaving(false);
    }
  };

  // ── Reset + close ──────────────────────────────────────────────────────────

  const handleClose = () => {
    setSelectedFile(null);
    setExtractedContent('');
    setStoragePath('');
    setDetectedVars([]);
    setDocType('will');
    setDisplayName('');
    setUploading(false);
    setProcessing(false);
    setUploadProgress(0);
    onClose();
  };

  // ── Confidence badge ───────────────────────────────────────────────────────

  const confidenceBadge = (confidence: string) => {
    const colors: Record<string, string> = {
      high: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      medium: 'bg-amber-100 text-amber-800 border-amber-200',
      low: 'bg-red-100 text-red-800 border-red-200',
    };
    return colors[confidence] ?? colors.low;
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
            <Upload className="h-5 w-5 text-[#2b6cb0]" />
            Upload Existing Draft
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* ── Step 1: File selection ──────────────────────────────────── */}
          {!processed && (
            <div>
              <p className="text-xs text-gray-500 mb-3">
                Upload an existing draft (.docx or .pdf). The AI will extract its content,
                identify the document type, and detect variable fields so it integrates
                seamlessly with the generation system.
              </p>

              {selectedFile ? (
                <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 py-6 text-center relative">
                  <button
                    type="button"
                    onClick={() => { setSelectedFile(null); setDisplayName(''); }}
                    className="absolute top-2 right-2 rounded-full p-1 text-emerald-400 hover:text-emerald-700 hover:bg-emerald-100"
                    aria-label="Remove file"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <FileText className="mx-auto h-10 w-10 text-emerald-500" />
                  <p className="mt-2 text-sm font-medium text-emerald-700">{selectedFile.name}</p>
                  <p className="text-xs text-emerald-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>

                  {!uploading && !processing && (
                    <Button
                      onClick={handleUploadAndProcess}
                      className="mt-3 bg-[#2b6cb0] hover:bg-[#1a365d] text-white"
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      Upload &amp; Analyze with AI
                    </Button>
                  )}

                  {(uploading || processing) && (
                    <div className="mt-3 mx-auto max-w-xs">
                      <div className="flex items-center justify-center gap-2 text-sm text-[#2b6cb0]">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#2b6cb0] border-t-transparent" />
                        {uploading ? `Uploading… ${uploadProgress}%` : 'AI analyzing document…'}
                      </div>
                      {uploading && (
                        <div className="mt-2 h-1.5 w-full rounded-full bg-gray-200">
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
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                  aria-label="Drop a file or click to upload"
                  className={`rounded-xl border-2 border-dashed py-12 text-center cursor-pointer transition-colors ${
                    dragActive
                      ? 'border-[#2b6cb0] bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                  }`}
                >
                  <Upload className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-2 text-sm font-medium text-gray-600">
                    Drop a .docx or .pdf draft here, or click to browse
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Max 20MB — AI will extract content and detect document type</p>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.pdf"
                title="Upload draft document"
                aria-label="Upload draft document"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              />
            </div>
          )}

          {/* ── Step 2: AI results + review ─────────────────────────────── */}
          {processed && (
            <>
              {/* Success banner */}
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium text-emerald-800">Document analyzed successfully</p>
                  <p className="text-xs text-emerald-600">
                    {selectedFile?.name} — {detectedVars.length} variable{detectedVars.length === 1 ? '' : 's'} detected
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setExtractedContent(''); setStoragePath(''); setDetectedVars([]); }}
                  className="ml-auto text-xs text-emerald-600 hover:underline"
                >
                  Re-upload
                </button>
              </div>

              {/* Document type */}
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
                  <label className="text-xs font-medium text-gray-700">Display Name *</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g., Last Will and Testament — John Smith"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none"
                  />
                </div>
              </div>

              {/* Detected variables table */}
              {detectedVars.length > 0 && (
                <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-purple-600" />
                    <span className="text-sm font-semibold text-purple-800">
                      {detectedVars.length} Variable{detectedVars.length === 1 ? '' : 's'} Detected
                    </span>
                  </div>
                  <p className="text-[10px] text-purple-600 mb-3">
                    These fields were found in the document and will be used by the AI when this
                    draft is referenced in future generation tasks.
                  </p>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-purple-200 bg-white">
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
                            <td className="px-3 py-1.5 font-mono text-gray-600 truncate max-w-[140px]" title={v.originalText}>
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
                                className="w-full font-mono text-xs px-1.5 py-0.5 rounded border border-gray-200 text-[#2b6cb0] focus:border-[#2b6cb0] focus:outline-none"
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
            </>
          )}
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !processed || !displayName.trim()}
            className="bg-[#2b6cb0] hover:bg-[#1a365d] text-white"
          >
            {saving ? 'Saving…' : 'Save to Vault'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
