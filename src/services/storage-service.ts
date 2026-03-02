import { storage } from '@/config/firebase';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';

export interface UploadedFile {
    name: string;
    url: string;
    date: string;
    size: number;
    type: string;
    path: string; // the GS path
}

class StorageService {
    /**
     * Uploads a file to Firebase Storage under firms/{firmId}/clients/{clientId}/uploads/
     */
    async uploadClientFile(
        firmId: string,
        clientId: string,
        file: File,
        onProgress?: (progress: number) => void
    ): Promise<UploadedFile> {
        const timestamp = Date.now();
        // Sanitize filename to prevent weird characters
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const path = `firms/${firmId}/clients/${clientId}/uploads/${timestamp}_${safeName}`;
        const storageRef = ref(storage, path);

        return new Promise((resolve, reject) => {
            const uploadTask = uploadBytesResumable(storageRef, file);

            uploadTask.on(
                'state_changed',
                (snapshot) => {
                    if (onProgress) {
                        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                        onProgress(progress);
                    }
                },
                (error) => {
                    reject(error);
                },
                async () => {
                    try {
                        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                        resolve({
                            name: file.name,
                            url: downloadUrl,
                            date: new Date().toISOString(),
                            size: file.size,
                            type: file.type,
                            path: path,
                        });
                    } catch (err) {
                        reject(err);
                    }
                }
            );
        });
    }

    /**
     * Deletes a file from storage given its full path
     */
    async deleteFile(path: string): Promise<void> {
        const storageRef = ref(storage, path);
        await deleteObject(storageRef);
    }
}

export const storageService = new StorageService();
