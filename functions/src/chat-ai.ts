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
            const systemPrompt = `You are a helpful, expert AI assistant embedded within an Estate Planning legal portal.
You help attorneys and paralegals summarize client data, answer questions about estate planning, and navigate the app.
Be concise and clear.
${contextStr ? `Here is the data context of what the user is currently viewing:\n${contextStr}` : ''}
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
