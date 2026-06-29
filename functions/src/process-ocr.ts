import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { OpenAI } from 'openai';

/**
 * Recursively drop null/undefined/empty-string values, empty arrays, and empty
 * objects from an OCR extraction.
 *
 * The OCR prompt tells the model to return `null` for any field it can't read
 * and `[]` for empty arrays. Writing that straight back with `set(..., { merge:
 * true })` overwrites existing client data with blanks — scanning a single
 * page would null out spouse/children/contact info already on the record (the
 * source of every generated document). Stripping empties first means only the
 * fields the model actually extracted are merged. (Audit finding BT.)
 *
 * Note: Firestore `merge` replaces arrays wholesale rather than element-merging,
 * so a non-empty extracted array still replaces the existing one — that is the
 * intended "this scan covered that section" behavior; only empty arrays are
 * dropped so a partial scan can't erase a populated section.
 */
export function stripEmpty(value: unknown): unknown {
    if (Array.isArray(value)) {
        const cleaned = value.map(stripEmpty).filter((v) => v !== undefined);
        return cleaned.length ? cleaned : undefined;
    }
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            const cleaned = stripEmpty(v);
            if (cleaned !== undefined) out[k] = cleaned;
        }
        return Object.keys(out).length ? out : undefined;
    }
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    return value;
}

export const processQuestionnaireScan = functions
    .region('us-east1')
    .runWith({
        timeoutSeconds: 300,
        memory: '1GB',
    })
    .https.onCall(async (data: { firmId: string; clientId: string; imagePaths: string[] }, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
        }

        const { firmId, clientId, imagePaths } = data;
        if (!firmId || !clientId || !imagePaths || !imagePaths.length) {
            throw new functions.https.HttpsError('invalid-argument', 'firmId, clientId, and imagePaths are required.');
        }

        if ((context.auth.token.firmId as string | undefined) !== firmId) {
            throw new functions.https.HttpsError('permission-denied', 'Cannot process OCR for a different firm.');
        }

        // Scan upload lives in the staff client-dashboard UI only. Without
        // this check any authenticated user could burn the firm's OpenAI
        // quota and overwrite client questionnaire data via OCR results.
        const callerRole = context.auth.token.role as string | undefined;
        if (!callerRole || !['admin', 'attorney', 'paralegal'].includes(callerRole)) {
            throw new functions.https.HttpsError('permission-denied', 'Only staff members can process questionnaire scans.');
        }

        const db = admin.firestore();
        const storage = admin.storage();
        const bucket = storage.bucket();

        try {
            // Get API key from firm settings in Firestore
            const firmDoc = await db.doc(`firms/${firmId}`).get();
            const firmData = firmDoc.data();
            const apiKey = firmData?.openAiApiKey ?? firmData?.settings?.openAiApiKey ?? process.env.OPENAI_API_KEY;
            if (!apiKey) {
                throw new functions.https.HttpsError('failed-precondition', 'OpenAI API key not configured. Set it in Firm Settings.');
            }

            const openai = new OpenAI({ apiKey });

            const imageContents: OpenAI.Chat.Completions.ChatCompletionContentPartImage[] = [];

            for (const path of imagePaths) {
                const file = bucket.file(path);
                const [exists] = await file.exists();
                if (!exists) continue;

                const [buffer] = await file.download();
                const base64Image = buffer.toString('base64');
                const mimeType = path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

                imageContents.push({
                    type: 'image_url',
                    image_url: {
                        url: `data:${mimeType};base64,${base64Image}`
                    }
                });
            }

            if (!imageContents.length) {
                throw new functions.https.HttpsError('not-found', 'No valid images found at provided paths.');
            }

            const systemPrompt = `
You are an expert legal aide extracting information from handwritten Estate Planning Questionnaires.
Extract the data from the provided images into a structured JSON object.
Use the following JSON schema. For any missing fields, use null.
If an array is empty, return an empty array [].
Do NOT wrap the output in markdown code blocks. Just return raw JSON.

Schema:
{
  "personalInfo": {
    "firstName": null, "middleName": null, "lastName": null, "suffix": null, "preferredNames": null,
    "email": null, "phone": null, "dateOfBirth": null, "ssn4": null, "usCitizen": null, 
    "address": {"street": null, "city": null, "state": null, "zipCode": null}
  },
  "spouseInfo": {
    "firstName": null, "middleName": null, "lastName": null, "suffix": null, "preferredNames": null,
    "email": null, "phone": null, "dateOfBirth": null, "ssn4": null, "usCitizen": null,
    "dateOfMarriage": null, "isFirstMarriage": null
  },
  "children": [
    { "fullName": null, "dateOfBirth": null, "parentage": null, "specialNeeds": null, "financialIssues": null, "preDeceased": null }
  ]
}
`;

            const response = await openai.chat.completions.create({
                model: 'gpt-5.4',
                messages: [
                    { role: 'system', content: systemPrompt },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Please extract the handwritten data from these questionnaire pages.' },
                            ...imageContents
                        ]
                    }
                ],
                temperature: 0,
                response_format: { type: 'json_object' }
            });

            const jsonStr = response.choices[0]?.message?.content?.trim() || '{}';

            let extractedData: Record<string, unknown>;
            try {
                extractedData = JSON.parse(jsonStr);
            } catch {
                throw new functions.https.HttpsError('internal', 'Failed to parse JSON from OpenAI.');
            }

            // Strip blanks so a partial scan can't overwrite existing client
            // data with nulls/empties (audit finding BT), then merge only the
            // fields the model actually read.
            const cleaned = (stripEmpty(extractedData) ?? {}) as Record<string, unknown>;

            const clientRef = db.doc(`firms/${firmId}/clients/${clientId}`);
            if (Object.keys(cleaned).length > 0) {
                await clientRef.set(cleaned, { merge: true });
            }

            return { success: true, extractedData: cleaned, fieldsExtracted: Object.keys(cleaned).length };

        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to process OCR.';
            console.error('OCR Error:', err);
            throw new functions.https.HttpsError('internal', message);
        }
    });
