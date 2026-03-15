/**
 * AddTemplateDialog.tsx â€” extracted from KnowledgeBasePage.tsx
 */

import { useState, useRef } from 'react';
import { Upload, FileText, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  templateService,
} from '@/services/knowledge-base-service';
import { DOC_TYPES } from '@/config/constants';

const DOC_TYPE_OPTIONS = Object.entries(DOC_TYPES).map(([, value]) => ({
  value,
  label: value
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s: string) => s.toUpperCase())
    .trim(),
}));

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

export interface DetectedVariable {
  originalText: string;
  suggestedVariable: string;
  fieldLabel: string;
  confidence: string;
  context: string;
}

export function AddTemplateDialog({
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
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

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
      if (result.suggestedTags?.length > 0) setSelectedTags(result.suggestedTags);
      if (result.learningStats) setLearningStats(result.learningStats);

      toast.success(`File processed — ${result.detectedVariables?.length || 0} variables detected.`);
    } catch {
      console.error('File upload/process error');
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
        tags: selectedTags,
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
      setSelectedTags([]);
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
          <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-lg w-fit" role="group" aria-label="Upload mode selection">
            <button
              type="button"
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
              type="button"
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
            <div>
              {selectedFile ? (
                <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 py-6 text-center">
                  <FileText className="mx-auto h-10 w-10 text-emerald-500" />
                  <p className="mt-2 text-sm font-medium text-emerald-700">{selectedFile.name}</p>
                  <p className="text-xs text-emerald-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                  {!uploading && !processing && (
                    <Button
                      onClick={() => handleUploadAndProcess()}
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
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                  aria-label="Drop a file or click to upload"
                  className={`rounded-xl border-2 border-dashed py-10 text-center cursor-pointer transition-colors ${
                    dragActive
                      ? 'border-[#2b6cb0] bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                  }`}
                >
                  <Upload className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-2 text-sm font-medium text-gray-600">
                    Drop a .docx or .pdf file here, or click to browse
                  </p>
                  <p className="text-xs text-gray-400">Max 20MB. AI will auto-detect template variables.</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.pdf"
                title="Upload template file"
                aria-label="Upload template file"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              />
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

          {/* Tags */}
          <div>
            <label className="text-xs font-medium text-gray-700 mb-2 block">Tags</label>
            <div className="space-y-2">
              {TEMPLATE_TAGS.map((group) => (
                <div key={group.category}>
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{group.category}</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {group.tags.map((tag) => (
                      <button
                        key={tag.value}
                        type="button"
                        onClick={() => setSelectedTags((prev) => prev.includes(tag.value) ? prev.filter((t) => t !== tag.value) : [...prev, tag.value])}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
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
// Bulk Template Upload Dialog
// ---------------------------------------------------------------------------

