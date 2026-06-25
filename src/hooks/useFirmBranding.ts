import { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

export interface FirmBrandingPublic {
    logoUrl: string | null;
    firmName: string | null;
    googleMapsApiKey: string | null;
}

// Per-firm cache to prevent multiple Cloud Function calls across components.
// Keyed by firmId so one firm's branding (logo, name, Maps API key) never
// leaks into another firm's session.
const CACHE_KEY = (firmId?: string) => firmId ?? '__default__';
const cachedBranding = new Map<string, FirmBrandingPublic>();
const fetchPromises = new Map<string, Promise<FirmBrandingPublic>>();

export function useFirmBranding(firmId?: string) {
    const key = CACHE_KEY(firmId);
    const [data, setData] = useState<FirmBrandingPublic | null>(cachedBranding.get(key) ?? null);
    const [loading, setLoading] = useState(!cachedBranding.has(key));

    useEffect(() => {
        // Initial state already reflects a cached hit for this key.
        if (cachedBranding.has(key)) {
            return;
        }

        let promise = fetchPromises.get(key);
        if (!promise) {
            const getBranding = httpsCallable<{ firmId?: string }, FirmBrandingPublic>(functions, 'getFirmBranding');
            promise = getBranding({ firmId }).then((res) => {
                cachedBranding.set(key, res.data);
                return res.data;
            });
            fetchPromises.set(key, promise);
        }

        let active = true;
        promise
            .then((res) => {
                if (!active) return;
                setData(res);
                setLoading(false);
            })
            .catch((err) => {
                // Clear the failed promise so a later mount can retry instead of
                // being permanently wedged on the failed state.
                fetchPromises.delete(key);
                console.error('Failed to fetch firm branding:', err);
                if (!active) return;
                setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [firmId, key]);

    return { data, loading };
}
