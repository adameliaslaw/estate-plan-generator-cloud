import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

// Triggered when a new client is created
export const syncClientToLevitate = functions.region('us-east1').firestore
    .document('firms/{firmId}/clients/{clientId}')
    .onCreate(async (snap, context) => {
        const clientData = snap.data();
        const firmId = context.params.firmId;

        if (!clientData) return;

        // Fetch the firm settings to check for Levitate integration keys
        const firmDoc = await admin.firestore().collection('firms').doc(firmId).get();
        if (!firmDoc.exists) return;

        const firmSettings = firmDoc.data();
        const levitateWebhookUrl = firmSettings?.levitateWebhookUrl || firmSettings?.settings?.levitateWebhookUrl;
        const levitateApiKey = firmSettings?.levitateApiKey || firmSettings?.settings?.levitateApiKey;

        if (!levitateWebhookUrl && !levitateApiKey) {
            console.log(`[syncClientToLevitate] Firm ${firmId} has no Levitate integration configured. Skipping.`);
            return;
        }

        const payload = {
            firstName: clientData.personalInfo?.firstName || '',
            lastName: clientData.personalInfo?.lastName || '',
            email: clientData.personalInfo?.email || '',
            phone: clientData.personalInfo?.phone || '',
            address: clientData.personalInfo?.address || '',
            city: clientData.personalInfo?.city || '',
            state: clientData.personalInfo?.state || '',
            zip: clientData.personalInfo?.zip || '',
            clientId: snap.id,
            status: clientData.status || 'Drafting',
            source: 'NJ Estate Plan Generator',
        };

        try {
            // 1. Try Webhook first (Zapier/Make preferred route)
            if (levitateWebhookUrl) {
                console.log(`[syncClientToLevitate] Pushing client ${snap.id} to Webhook ${levitateWebhookUrl}`);
                const response = await fetch(levitateWebhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });

                if (!response.ok) {
                    console.error(`[syncClientToLevitate] Webhook failed. Status: ${response.status}`, await response.text());
                } else {
                    console.log(`[syncClientToLevitate] Webhook sync successful for client ${snap.id}`);
                    return;
                }
            }

            // 2. Try raw API Key if provided (Undocumented endpoints)
            // Since Levitate's actual raw public endpoints are closed entirely off from typical docs, 
            // we provide a best-effort endpoint for custom setups.
            if (levitateApiKey) {
                console.log(`[syncClientToLevitate] Pushing client ${snap.id} via API Key...`);
                // Example mock endpoint: "https://api.levitate.ai/v2/contacts"
                const API_ENDPOINT = 'https://api.levitate.ai/v2/contacts';
                const response = await fetch(API_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${levitateApiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });

                if (!response.ok) {
                    console.error(`[syncClientToLevitate] API Key sync failed. HTTP ${response.status}:`, await response.text());
                } else {
                    console.log(`[syncClientToLevitate] API Key sync successful for client ${snap.id}`);
                }
            }

        } catch (err: unknown) {
            console.error(`[syncClientToLevitate] Exception during Levitate sync:`, err);
        }
    });
