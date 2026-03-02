import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { OpenAI } from 'openai';
import { defineSecret } from 'firebase-functions/params';

const openAiKey = defineSecret('OPENAI_API_KEY');

export const processQuestionnaireScan = functions
    .runWith({
        secrets: [openAiKey],
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

        const db = admin.firestore();
        const storage = admin.storage();
        const bucket = storage.bucket();

        try {
            const apiKey = openAiKey.value();
            if (!apiKey) {
                throw new functions.https.HttpsError('failed-precondition', 'OpenAI API key not configured.');
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
                model: 'gpt-4o',
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

            let extractedData: Record<string, any>;
            try {
                extractedData = JSON.parse(jsonStr);
            } catch (err) {
                throw new functions.https.HttpsError('internal', 'Failed to parse JSON from OpenAI.');
            }

            // Update client document
            const clientRef = db.doc(`firms/${firmId}/clients/${clientId}`);
            await clientRef.set(extractedData, { merge: true });

            return { success: true, extractedData };

        } catch (err: any) {
            console.error('OCR Error:', err);
            throw new functions.https.HttpsError('internal', err.message || 'Failed to process OCR.');
        }
    });
