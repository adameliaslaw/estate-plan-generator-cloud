import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';

export interface AudioRecorderState {
    isRecording: boolean;
    durationSeconds: number;
    audioBlob: Blob | null;
    audioFileName: string;
    audioDataUri: string | null;
}

export function useAudioRecorder() {
    const [state, setState] = useState<AudioRecorderState>({
        isRecording: false,
        durationSeconds: 0,
        audioBlob: null,
        audioFileName: '',
        audioDataUri: null,
    });

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const startRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Explicitly request 128kbps to ensure high transcription quality
            const options = { audioBitsPerSecond: 128000 };
            let mr: MediaRecorder;
            try {
                mr = new MediaRecorder(stream, options);
            } catch (err) {
                // Fallback if the browser doesn't support specifying the bitrate this way
                mr = new MediaRecorder(stream);
            }

            mediaRecorderRef.current = mr;
            chunksRef.current = [];

            mr.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            mr.onstop = () => {
                const mimeType = mr.mimeType || (chunksRef.current[0]?.type || 'audio/webm');
                const blob = new Blob(chunksRef.current, { type: mimeType });
                const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('wav') ? 'wav' : 'webm';
                const fileName = `recording-${Date.now()}.${ext}`;
                const reader = new FileReader();
                reader.onloadend = () => {
                    setState((prev) => ({
                        ...prev,
                        isRecording: false,
                        audioBlob: blob,
                        audioFileName: fileName,
                        audioDataUri: reader.result as string,
                    }));
                };
                reader.readAsDataURL(blob);
                stream.getTracks().forEach((t) => t.stop());
            };

            mr.start();

            let elapsed = 0;
            timerRef.current = setInterval(() => {
                elapsed += 1;
                setState((prev) => ({ ...prev, durationSeconds: elapsed }));
            }, 1000);

            setState((prev) => ({
                ...prev,
                isRecording: true,
                durationSeconds: 0,
                audioBlob: null,
                audioFileName: '',
                audioDataUri: null,
            }));
        } catch {
            toast.error('Microphone access denied. Please allow mic permission and try again.');
        }
    }, []);

    const stopRecording = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
    }, []);

    const cancelRecording = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stream?.getTracks().forEach((t) => t.stop());
            mediaRecorderRef.current.stop();
        }
        setState((prev) => ({
            ...prev,
            isRecording: false,
            durationSeconds: 0,
            audioBlob: null,
            audioFileName: '',
            audioDataUri: null,
        }));
    }, []);

    const clearAudio = useCallback(() => {
        setState((prev) => ({
            ...prev,
            isRecording: false,
            durationSeconds: 0,
            audioBlob: null,
            audioFileName: '',
            audioDataUri: null,
        }));
    }, []);

    const setUploadedAudio = useCallback((blob: Blob, fileName: string) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            setState((prev) => ({
                ...prev,
                isRecording: false,
                durationSeconds: 0,
                audioBlob: blob,
                audioFileName: fileName,
                audioDataUri: reader.result as string,
            }));
        };
        reader.readAsDataURL(blob);
    }, []);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    const result = useMemo(
        () => ({
            ...state,
            startRecording,
            stopRecording,
            cancelRecording,
            clearAudio,
            setUploadedAudio,
        }),
        [state, startRecording, stopRecording, cancelRecording, clearAudio, setUploadedAudio]
    );

    return result;
}
