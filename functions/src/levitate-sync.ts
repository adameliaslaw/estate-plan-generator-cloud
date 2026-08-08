import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { loadFirmSecrets } from './firm-secrets';
import { logAuditEvent } from './audit-trail';

/**
 * Audit a push of client identity data to Levitate (#172, #168).
 * The entry names the client, the route, and the OUTCOME — a failed push is
 * recorded too, so the integration cannot silently rot behind console.error.
 * It never carries the webhook URL: the URL embeds a credential (#168) and
 * must not reach the audit log.
 */
async function auditLevitateSync(
    firmId: string,
    clientId: string,
    clientName: string,
    route: 'webhook' | 'api',
    outcome: 'success' | 'failed',
    httpStatus?: number,
): Promise<void> {
    await logAuditEvent({
        firmId,
        eventType: 'integration_synced',
        userId: 'system', // onCreate trigger — no acting user in context
        userEmail: '',
        userRole: '',
        clientId,
        clientName,
        details:
            outcome === 'success'
                ? `Client synced to Levitate CRM (${route})`
                : `Levitate CRM sync FAILED (${route}${httpStatus ? `, HTTP ${httpStatus}` : ''})`,
        metadata: { provider: 'levitate', route, outcome, httpStatus: httpStatus ?? null },
    });
}

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

        const firmSettings = { ...(firmDoc.data() ?? {}), ...(await loadFirmSecrets(firmId)) };
        const levitateWebhookUrl = firmSettings?.levitateWebhookUrl || firmSettings?.settings?.levitateWebhookUrl;
        const levitateApiKey = firmSettings?.levitateApiKey || firmSettings?.settings?.levitateApiKey;

        if (!levitateWebhookUrl && !levitateApiKey) {
            console.log(`[syncClientToLevitate] Firm ${firmId} has no Levitate integration configured. Skipping.`);
            return;
        }

        // #168: the CRM contact card only — name + email, per the issue's own
        // spec. Street address, phone, zip and matter status are identity data
        // a marketing platform does not need; if a future consent-gated
        // decision wants them back, that decision adds them deliberately.
        const payload = {
            firstName: clientData.personalInfo?.firstName || '',
            lastName: clientData.personalInfo?.lastName || '',
            email: clientData.personalInfo?.email || '',
            clientId: snap.id,
            source: 'NJ Estate Plan Generator',
        };

        try {
            // 1. Try Webhook first (Zapier/Make preferred route)
            if (levitateWebhookUrl) {
                // #168: the URL IS the credential (Zapier/Make-style) — it must
                // never reach Cloud Logging. Log only that one is configured.
                console.log(`[syncClientToLevitate] Pushing client ${snap.id} via configured webhook`);
                const response = await fetch(levitateWebhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });

                if (!response.ok) {
                    // #168: log the status ONLY. The response body is
                    // third-party controlled and — for Zapier/Make behind
                    // Cloudflare — routinely echoes the webhook host or the
                    // full secret URL, which is the credential this file must
                    // keep out of Cloud Logging. (Found by adversarial
                    // verification: the first fix redacted our own log line
                    // but let the vendor's error body carry the URL in.)
                    console.error(`[syncClientToLevitate] Webhook failed. Status: ${response.status}`);
                    await auditLevitateSync(firmId, snap.id, `${payload.firstName} ${payload.lastName}`.trim(), 'webhook', 'failed', response.status);
                } else {
                    console.log(`[syncClientToLevitate] Webhook sync successful for client ${snap.id}`);
                    await auditLevitateSync(firmId, snap.id, `${payload.firstName} ${payload.lastName}`.trim(), 'webhook', 'success');
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
                    // Status only — same posture as the webhook branch. This
                    // endpoint is a fixed public URL, but a response body is
                    // still third-party text with no place in our logs.
                    console.error(`[syncClientToLevitate] API Key sync failed. HTTP ${response.status}`);
                    await auditLevitateSync(firmId, snap.id, `${payload.firstName} ${payload.lastName}`.trim(), 'api', 'failed', response.status);
                } else {
                    console.log(`[syncClientToLevitate] API Key sync successful for client ${snap.id}`);
                    await auditLevitateSync(firmId, snap.id, `${payload.firstName} ${payload.lastName}`.trim(), 'api', 'success');
                }
            }

        } catch (err: unknown) {
            // #168: log the MESSAGE only — a Node fetch failure's cause chain
            // can carry the request host, and for a webhook integration the
            // host is part of the credential.
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[syncClientToLevitate] Exception during Levitate sync: ${message}`);
            await auditLevitateSync(
                firmId,
                snap.id,
                `${payload.firstName} ${payload.lastName}`.trim(),
                levitateWebhookUrl ? 'webhook' : 'api',
                'failed',
            );
        }
    });
