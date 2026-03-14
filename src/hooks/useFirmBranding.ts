import { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

export interface FirmBrandingPublic {
    logoUrl: string | null;
    firmName: string | null;
    googleMapsApiKey: string | null;
}

// Global cache to prevent multiple Cloud Function calls across components
let cachedBranding: FirmBrandingPublic | null = null;
let fetchPromise: Promise<FirmBrandingPublic> | null = null;

export function useFirmBranding(firmId?: string) {
    const [data, setData] = useState<FirmBrandingPublic | null>(cachedBranding);
    const [loading, setLoading] = useState(!cachedBranding);

    useEffect(() => {
        if (cachedBranding) {
            setData(cachedBranding);
            setLoading(false);
            return;
        }

        if (!fetchPromise) {
            const getBranding = httpsCallable<{ firmId?: string }, FirmBrandingPublic>(functions, 'getFirmBranding');
            fetchPromise = getBranding({ firmId }).then((res) => {
                cachedBranding = res.data;
                return res.data;
            });
        }

        fetchPromise
            .then((res) => {
                setData(res);
                setLoading(false);
            })
            .catch((err) => {
                console.error('Failed to fetch firm branding:', err);
                setLoading(false);
            });
    }, [firmId]);

    return { data, loading };
}
