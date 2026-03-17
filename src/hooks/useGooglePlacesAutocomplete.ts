import { useEffect, useRef, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
    interface Window {
        google: any;
    }
}

/** Minimal type shims so we don't need @types/google.maps */
interface GoogleAddressComponent {
    long_name: string;
    short_name: string;
    types: string[];
}

interface GooglePlaceResult {
    address_components?: GoogleAddressComponent[];
    formatted_address?: string;
}

interface GoogleAutocomplete {
    addListener(event: string, cb: () => void): { remove(): void };
    getPlace(): GooglePlaceResult | undefined;
}
/* eslint-enable @typescript-eslint/no-explicit-any */


/**
 * Loads the Google Maps Javascript API script dynamically if not already present.
 */
function loadGoogleMapsScript(apiKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined') return reject();
        if (window.google && window.google.maps && window.google.maps.places) {
            return resolve();
        }

        const scriptId = 'google-maps-script';
        const existingScript = document.getElementById(scriptId);

        if (existingScript) {
            // If script exists but hasn't finished loading, wait for it
            const checkInterval = setInterval(() => {
                if (window.google && window.google.maps && window.google.maps.places) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);
            return;
        }

        const script = document.createElement('script');
        script.id = scriptId;
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = (err) => reject(err);
        document.head.appendChild(script);
    });
}

interface AddressComponents {
    streetNumber: string;
    route: string;
    city: string;
    state: string;
    zip: string;
    county: string;
}

export function useGooglePlacesAutocomplete(
    apiKey: string | undefined,
    inputRef: React.RefObject<HTMLInputElement | null>,
    onChange: (value: Partial<AddressComponents>) => void
) {
    const [isReady, setIsReady] = useState(false);
    const autocompleteRef = useRef<GoogleAutocomplete | null>(null);
    // Use a ref for the callback so the listener always calls the latest version
    const onChangeRef = useRef(onChange);
    useEffect(() => { onChangeRef.current = onChange; });

    useEffect(() => {
        if (!apiKey) return;

        let isMounted = true;
        loadGoogleMapsScript(apiKey)
            .then(() => {
                if (isMounted) setIsReady(true);
            })
            .catch((err) => {
                console.error('Failed to load Google Maps script', err);
            });

        return () => {
            isMounted = false;
        };
    }, [apiKey]);

    useEffect(() => {
        if (!isReady || !inputRef.current) return;
        if (autocompleteRef.current) return; // already initialized

        const input = inputRef.current;

        autocompleteRef.current = new window.google.maps.places.Autocomplete(input, {
            types: ['address'],
            fields: ['address_components', 'formatted_address'],
        }) as GoogleAutocomplete;

        const listener = autocompleteRef.current.addListener('place_changed', () => {
            const place = autocompleteRef.current?.getPlace();
            if (!place || !place.address_components) return;

            const components: Partial<AddressComponents> = {};
            let streetNum = '';
            let routeName = '';

            place.address_components.forEach((component: GoogleAddressComponent) => {
                const types = component.types;
                if (types.includes('street_number')) {
                    streetNum = component.long_name;
                } else if (types.includes('route')) {
                    routeName = component.long_name;
                } else if (types.includes('locality') || types.includes('sublocality_level_1') || types.includes('postal_town')) {
                    components.city = component.long_name;
                } else if (types.includes('administrative_area_level_1')) {
                    components.state = component.short_name; // e.g. NJ
                } else if (types.includes('postal_code')) {
                    components.zip = component.long_name;
                } else if (types.includes('administrative_area_level_2')) {
                    // Removes "County" from the end if present, just to match our DB formats like "Middlesex"
                    components.county = component.short_name.replace(/ County$/i, '');
                }
            });

            if (streetNum && routeName) {
                components.streetNumber = `${streetNum} ${routeName}`;
            } else if (routeName) {
                components.streetNumber = routeName;
            }

            // Reset the input to just the street address — Google overwrites it
            // with the full formatted address (e.g. "123 Main St, City, NJ 08831")
            if (input && components.streetNumber) {
                input.value = components.streetNumber;
            }

            onChangeRef.current(components);
        });

        return () => {
            if (listener) {
                window.google.maps.event.removeListener(listener);
            }
        };
    }, [isReady, inputRef]);

    return { isReady };
}
