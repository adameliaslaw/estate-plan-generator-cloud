import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { storage, functions } from '@/config/firebase';

/**
 * Upload audio blob to Cloud Storage.
 * Returns the storage URL and the full path used for transcription.
 */
export async function uploadAudioToStorage(
    blob: Blob,
    firmId: string,
    clientId: string,
    noteId: string,
): Promise<{ url: string; fullPath: string }> {
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('wav') ? 'wav' : 'webm';
    const storagePath = `firms/${firmId}/clients/${clientId}/audio/${noteId}.${ext}`;
    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, blob, { contentType: blob.type });
    const url = await getDownloadURL(storageRef);

    return { url, fullPath: storagePath };
}

/**
 * Trigger Whisper transcription via Cloud Function.
 */
export async function requestTranscription(
    firmId: string,
    clientId: string,
    noteId: string,
    storagePath: string,
): Promise<void> {
    const transcribeAudio = httpsCallable(functions, 'transcribeAudio');
    await transcribeAudio({ firmId, clientId, noteId, storagePath });
}
