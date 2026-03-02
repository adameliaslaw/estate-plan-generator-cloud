import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { callAI } from './ai-client';

/**
 * Request payload for the Global AI Chat Widget.
 */
interface ChatAiRequest {
    firmId: string;
    clientId?: string;
    message: string;
    contextParams?: Record<string, any>;
    history?: { role: 'user' | 'assistant', content: string }[];
}

export const chatAi = functions.region('us-east1').https.onCall(
    async (data: ChatAiRequest, context: functions.https.CallableContext) => {
        // 1. Authenticate user
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'You must be signed in to use the AI Assistant.',
            );
        }

        const { firmId, clientId, message, contextParams, history = [] } = data;

        if (!firmId) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'firmId is required.',
            );
        }
        if (!message) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'message is required.',
            );
        }

        try {
            // 2. Fetch firm data (to get API keys and provider preference)
            const firmDoc = await admin.firestore().collection('firms').doc(firmId).get();
            if (!firmDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'Firm not found.');
            }
            const firmData = firmDoc.data();

            // 3. Compile context
            let contextStr = '';
            if (clientId) {
                const clientDoc = await admin.firestore()
                    .collection('firms')
                    .doc(firmId)
                    .collection('clients')
                    .doc(clientId)
                    .get();
                if (clientDoc.exists) {
                    contextStr += `\nViewing Client: ${JSON.stringify(clientDoc.data())}\n`;
                }
            }

            if (contextParams) {
                contextStr += `\nAdditional UI Context: ${JSON.stringify(contextParams)}\n`;
            }

            // 4. Build prompt
            const systemPrompt = `You are an expert New Jersey estate planning attorney assistant.
Your primary role is to act as a specialized legal assistant, focusing on New Jersey estate planning law, citations, and statutory compliance.
When answering questions about estate planning, drafting, or legal strategy, you must strictly cite relevant New Jersey statutes (e.g., Title 3B for Administration of Estates, N.J.S.A. 46:2B-8 for Powers of Attorney, N.J.S.A. 26:2H-53 for Advance Directives) and applicable case law. 
Provide highly intuitive, legally accurate, and professional guidance. Be analytical, precise, and proactive in identifying potential legal issues or statutory requirements.
Do not fabricate citations; if you do not know the exact statute, refer to the general legal principle under New Jersey law.
Here is the data context of the user's current environment or client:
${contextStr}
`;

            // Build User Prompt including history
            let userPrompt = '';
            if (history.length > 0) {
                userPrompt += 'Chat History:\n';
                for (const msg of history) {
                    userPrompt += `${msg.role.toUpperCase()}: ${msg.content}\n`;
                }
                userPrompt += `\nCURRENT USER MESSAGE: ${message}`;
            } else {
                userPrompt = message;
            }

            // 5. Call the LLM
            const reply = await callAI(systemPrompt, userPrompt, firmData, {
                model: firmData?.chatbotModel || undefined,
                temperature: 0.4,
                maxTokens: 1000,
            });

            return {
                reply,
            };
        } catch (error: any) {
            console.error('[chatAi] Error:', error);
            throw new functions.https.HttpsError(
                'internal',
                error.message || 'An error occurred bridging to the AI provider.',
            );
        }
    },
);
