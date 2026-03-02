import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes } from 'firebase/storage';
import { toast } from 'sonner';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, UploadCloud, FileImage } from 'lucide-react';
import { functions, storage } from '@/config/firebase';
import { COLLECTIONS } from '@/config/constants';

interface UploadScanModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    firmId: string;
    clientId: string;
}

export function UploadScanModal({ open, onOpenChange, firmId, clientId }: UploadScanModalProps) {
    const [files, setFiles] = useState<File[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            setFiles(Array.from(e.target.files));
        }
    };

    const handleUploadAndProcess = async () => {
        if (files.length === 0) return;

        setIsUploading(true);
        setProgress(10);

        try {
            const paths: string[] = [];

            // 1. Upload each image strategy to Storage
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileRef = ref(storage, `${COLLECTIONS.CLIENTS(firmId)}/${clientId}/scans/${Date.now()}_${file.name}`);
                await uploadBytes(fileRef, file);
                paths.push(fileRef.fullPath);
                setProgress(10 + Math.floor((i + 1) / files.length * 40));
            }

            // 2. Call Cloud Function
            setProgress(60);
            const processScan = httpsCallable(functions, 'processQuestionnaireScan');
            await processScan({ firmId, clientId, imagePaths: paths });

            setProgress(100);
            toast.success('Scan processed successfully! The digital questionnaire has been auto-filled.');
            onOpenChange(false);

        } catch (err: any) {
            console.error('Failed to process scan', err);
            toast.error(err.message || 'An error occurred during OCR processing.');
        } finally {
            setIsUploading(false);
            setProgress(0);
            setFiles([]);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Upload Handwritten Questionnaire</DialogTitle>
                    <DialogDescription>
                        Upload photos or images of the client's handwritten questionnaire.
                        Our AI will automatically extract and merge the answers.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="scanFiles">Select Images</Label>
                        <Input
                            id="scanFiles"
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handleFileChange}
                            disabled={isUploading}
                        />
                        {files.length > 0 && (
                            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                <FileImage className="h-3 w-3" />
                                {files.length} file(s) selected
                            </p>
                        )}
                    </div>

                    {isUploading && (
                        <div className="space-y-1">
                            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-[#1a365d] transition-all"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <p className="text-xs text-center text-gray-500">Processing... This might take a minute.</p>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isUploading}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleUploadAndProcess}
                        disabled={!files.length || isUploading}
                        className="gap-2 bg-[#1a365d] hover:bg-[#2b6cb0] text-white"
                    >
                        {isUploading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <UploadCloud className="h-4 w-4" />
                        )}
                        {isUploading ? 'Processing...' : 'Upload & Auto-Fill'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
