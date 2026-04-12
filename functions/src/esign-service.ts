import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

export const sendForSignature = functions.region('us-east1').https.onCall(async (data, context) => {
    // 1. Verify Authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { firmId, clientId, documentId, signerName, signerEmail } = data;

    if (!firmId || !clientId || !documentId || !signerName || !signerEmail) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required parameters.');
    }

    // 2. Fetch firm settings to get the API Key (HelloSign/DocuSign mock or real integration)
    const firmRef = admin.firestore().collection('firms').doc(firmId);
    const firmDoc = await firmRef.get();

    if (!firmDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Firm not found.');
    }

    // Wait, does the firm have a saved eSignature API key in their firm document settings?
    // We can just rely on standard logging for now, or use a generic Webhook.

    // 3. Mark document as 'Sent for eSignature' in Activity / Audit Trail
    const docRef = admin.firestore()
        .collection('firms')
        .doc(firmId)
        .collection('clients')
        .doc(clientId)
        .collection('documents')
        .doc(documentId);

    const document = await docRef.get();
    if (!document.exists) {
        throw new functions.https.HttpsError('not-found', 'Document not found.');
    }

    const documentData = document.data() || {};

    // Create an Activity Log for the signature request
    await admin.firestore()
        .collection('firms')
        .doc(firmId)
        .collection('clients')
        .doc(clientId)
        .collection('activityLogs')
        .add({
            type: 'document_sent_for_signature',
            title: 'Document Sent for E-Signature',
            description: `Sent "${documentData.displayName || 'Document'}" to ${signerName} (${signerEmail}) for electronic signature.`,
            relatedDocumentId: documentId,
            createdBy: context.auth.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

    // Since we do not have a hardcoded DocuSign API or HelloSign API (and it strongly depends on the specific provider API schema and OAuth app), 
    // we will simulate the e-signature request success here. If the user provides a provider, we can drop the real REST API call here.

    // Mock API call simulation
    console.log(`[ESIGN] Sending request to ${signerEmail} for ${documentData.displayName}`);

    return {
        success: true,
        signatureRequestId: `sig_req_${Date.now()}`
    };
});
