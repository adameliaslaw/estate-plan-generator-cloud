import React, { useRef, useState } from 'react';
import { UploadCloud, X, Loader2, FileText } from 'lucide-react';
import { useQuestionnaire } from '@/contexts/QuestionnaireContext';
import { storageService, type UploadedFile } from '@/services/storage-service';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useParams } from 'react-router-dom';

export function QuestionnaireUploader() {
    const { data, updateField } = useQuestionnaire();
    const { firmId, clientId } = useParams<{ firmId: string; clientId: string }>();

    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const uploads = data.uploads || [];

    async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        // Basic validation
        const maxSize = 50 * 1024 * 1024; // 50MB
        if (file.size > maxSize) {
            toast.error('File is too large. Maximum size is 50MB.');
            return;
        }

        if (!firmId || !clientId) {
            toast.error('Missing firm or client context. Cannot upload.');
            return;
        }

        try {
            setIsUploading(true);
            setProgress(0);

            const uploadedFile = await storageService.uploadClientFile(
                firmId,
                clientId,
                file,
                (p) => setProgress(p)
            );

            // Append to context
            updateField('uploads', [...uploads, uploadedFile]);
            toast.success('Document uploaded successfully');

            // Reset input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        } catch (error) {
            console.error('Upload failed:', error);
            toast.error('Failed to upload document. Please try again.');
        } finally {
            setIsUploading(false);
            setProgress(0);
        }
    }

    async function handleDelete(fileToDelete: UploadedFile) {
        try {
            // Optimistic update
            const newUploads = uploads.filter((f) => f.path !== fileToDelete.path);
            updateField('uploads', newUploads);

            // Delete from storage
            await storageService.deleteFile(fileToDelete.path);
            toast.success('Document removed');
        } catch (error) {
            console.error('Delete failed:', error);
            toast.error('Failed to delete document');
            // Revert if failed
            updateField('uploads', uploads);
        }
    }

    return (
        <div className="flex flex-col gap-3">
            {/* Upload Button */}
            <div className="flex items-center gap-4">
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    className="hidden"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                />
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className={cn(
                        "flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#1a365d] focus:ring-offset-2",
                        isUploading && "opacity-50 cursor-not-allowed"
                    )}
                >
                    {isUploading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-[#1a365d]" />
                    ) : (
                        <UploadCloud className="h-4 w-4 text-gray-500" />
                    )}
                    {isUploading ? `Uploading ${Math.round(progress)}%...` : 'Upload Document'}
                </button>
                <span className="text-xs text-gray-500 hidden sm:inline-block">
                    Accepts PDF, Word, or Image files (Max 50MB)
                </span>
            </div>

            {/* Uploaded Files List */}
            {uploads.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                    {uploads.map((file, idx) => (
                        <div
                            key={idx}
                            className="group flex items-center gap-2 rounded-full border border-gray-200 bg-white pl-3 pr-1 py-1 shadow-sm transition-all hover:border-[#1a365d]/40"
                        >
                            <FileText className="h-3.5 w-3.5 text-gray-400" />
                            <a
                                href={file.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-medium text-gray-700 hover:text-[#1a365d] hover:underline truncate max-w-[150px]"
                                title={file.name}
                            >
                                {file.name}
                            </a>
                            <button
                                onClick={() => handleDelete(file)}
                                className="ml-1 rounded-full p-1 text-gray-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"
                                aria-label="Remove document"
                                title="Remove document"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
