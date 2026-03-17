import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';

export interface AudioRecorderState {
    isRecording: boolean;
    durationSeconds: number;
    audioBlob: Blob | null;
    audioFileName: string;
    audioDataUri: string | null;
}

/**
 * Interval (ms) at which the MediaRecorder emits data chunks.
 * Using 5 s keeps chunks small enough to survive a sudden kill while
 * limiting the number of `ondataavailable` events.
 */
const CHUNK_INTERVAL_MS = 5_000;

/**
 * Build a final Blob from whatever chunks have accumulated so far.
 */
function buildBlob(chunks: Blob[], mimeType: string): Blob {
    return new Blob(chunks, { type: mimeType || 'audio/webm' });
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
    const wakeLockRef = useRef<WakeLockSentinel | null>(null);

    // ─── Wake Lock helpers ──────────────────────────────────────────────
    const requestWakeLock = useCallback(async () => {
        try {
            if ('wakeLock' in navigator) {
                wakeLockRef.current = await navigator.wakeLock.request('screen');
                wakeLockRef.current.addEventListener('release', () => {
                    wakeLockRef.current = null;
                });
            }
        } catch {
            // Wake Lock can fail silently — not essential
        }
    }, []);

    const releaseWakeLock = useCallback(() => {
        wakeLockRef.current?.release().catch(() => { /* ignore */ });
        wakeLockRef.current = null;
    }, []);

    // ─── Finalise a recording into state ────────────────────────────────
    const finaliseRecording = useCallback((chunks: Blob[], mimeType: string, wasAutoSaved = false) => {
        if (chunks.length === 0) return;

        const blob = buildBlob(chunks, mimeType);
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
            if (wasAutoSaved) {
                toast.warning(
                    'Your recording was auto-saved because the browser lost focus or your computer went to sleep. Please review before submitting.',
                    { duration: 8000 },
                );
            }
        };
        reader.readAsDataURL(blob);
    }, []);

    // ─── Start ──────────────────────────────────────────────────────────
    const startRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Explicitly request 128kbps to ensure high transcription quality
            const options = { audioBitsPerSecond: 128000 };
            let mr: MediaRecorder;
            try {
                mr = new MediaRecorder(stream, options);
            } catch (_err) {
                // Fallback if the browser doesn't support specifying the bitrate this way
                mr = new MediaRecorder(stream);
            }

            mediaRecorderRef.current = mr;
            chunksRef.current = [];

            mr.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            mr.onstop = () => {
                stream.getTracks().forEach((t) => t.stop());
            };

            // Use timeslice so chunks stream in every CHUNK_INTERVAL_MS
            // instead of only on stop(). This is the key sleep-resilience fix.
            mr.start(CHUNK_INTERVAL_MS);

            // Acquire Wake Lock to reduce chance of system sleep
            await requestWakeLock();

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
    }, [requestWakeLock]);

    // ─── Stop (normal) ──────────────────────────────────────────────────
    const stopRecording = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        releaseWakeLock();

        const mr = mediaRecorderRef.current;
        if (mr && mr.state !== 'inactive') {
            // Capture mime type before stop
            const mimeType = mr.mimeType || 'audio/webm';

            // Attach a one-time handler so we finalise AFTER the last chunk arrives
            const originalOnStop = mr.onstop;
            mr.onstop = (ev) => {
                if (originalOnStop && typeof originalOnStop === 'function') {
                    originalOnStop.call(mr, ev);
                }
                finaliseRecording(chunksRef.current, mimeType, false);
            };
            mr.stop();
        } else {
            // MediaRecorder already dead — salvage whatever chunks we have
            const mimeType = mr?.mimeType || 'audio/webm';
            if (chunksRef.current.length > 0) {
                finaliseRecording(chunksRef.current, mimeType, true);
            }
        }
    }, [releaseWakeLock, finaliseRecording]);

    // ─── Cancel ─────────────────────────────────────────────────────────
    const cancelRecording = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        releaseWakeLock();

        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stream?.getTracks().forEach((t) => t.stop());
            mediaRecorderRef.current.stop();
        }
        chunksRef.current = [];
        setState((prev) => ({
            ...prev,
            isRecording: false,
            durationSeconds: 0,
            audioBlob: null,
            audioFileName: '',
            audioDataUri: null,
        }));
    }, [releaseWakeLock]);

    // ─── Clear ──────────────────────────────────────────────────────────
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

    // ─── Accept uploaded file ───────────────────────────────────────────
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

    // ─── Visibility change handler ──────────────────────────────────────
    // When the tab becomes hidden (computer sleep, tab switch, screen lock)
    // we auto-stop the recording and salvage whatever chunks we have.
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden' && mediaRecorderRef.current?.state === 'recording') {
                console.warn('[useAudioRecorder] Tab hidden while recording — auto-saving partial audio.');

                if (timerRef.current) {
                    clearInterval(timerRef.current);
                    timerRef.current = null;
                }
                releaseWakeLock();

                const mr = mediaRecorderRef.current;
                const mimeType = mr.mimeType || 'audio/webm';

                // Request one final data flush before stopping
                try { mr.requestData(); } catch { /* may throw if already stopping */ }

                const originalOnStop = mr.onstop;
                mr.onstop = (ev) => {
                    if (originalOnStop && typeof originalOnStop === 'function') {
                        originalOnStop.call(mr, ev);
                    }
                    finaliseRecording(chunksRef.current, mimeType, true);
                };

                try {
                    mr.stop();
                } catch {
                    // MediaRecorder may already be dead
                    finaliseRecording(chunksRef.current, mimeType, true);
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [releaseWakeLock, finaliseRecording]);

    // Clean up timer on unmount
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
