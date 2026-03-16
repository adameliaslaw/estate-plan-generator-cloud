import { serverTimestamp } from 'firebase/firestore';
import { createDoc } from '@/hooks/useFirestore';
import type { UserProfile } from '@/types';

export type ActivityAction =
    | 'drafting documents'
    | 'editing documents'
    | 'adding client'
    | 'deleting client'
    | 'editing questionnaire'
    | 'completing questionnaire'
    | 'scheduling appointment'
    | 'entering task'
    | 'completing task'
    | 'logging payment'
    | 'sending payment request'
    | string;

export interface ActivityContext {
    clientName?: string;
    clientId?: string;
    documentName?: string;
    appointmentTitle?: string;
    taskTitle?: string;
    paymentAmount?: string;
    [key: string]: unknown;
}

export async function logSystemActivity(
    firmId: string,
    userProfile: UserProfile | null,
    action: ActivityAction,
    context?: ActivityContext
) {
    if (!firmId || !userProfile) return;

    try {
        let description = `${action}`;

        // Enrich description based on context
        if (context?.clientName) {
            if (action.includes('client') || action.includes('questionnaire')) {
                description = `${action} for ${context.clientName}`;
            } else {
                description = `${action} (${context.clientName})`;
            }
        }

        // Add specific details if available
        if (context?.documentName) description += ` - ${context.documentName}`;
        if (context?.appointmentTitle) description += ` - ${context.appointmentTitle}`;
        if (context?.taskTitle) description += ` - ${context.taskTitle}`;
        if (context?.paymentAmount) description += ` for ${context.paymentAmount}`;

        const collectionPath = `firms/${firmId}/activities`;
        const payload = {
            firmId,
            userId: userProfile.uid,
            userName: userProfile.displayName || userProfile.email || 'Unknown User',
            action,
            description,
            context: context || null,
            clientId: context?.clientId ?? null,
            timestamp: serverTimestamp(),
        };

        await createDoc(collectionPath, payload);
    } catch (err) {
        console.warn('[ActivityLogger] Failed to log activity:', err);
    }
}
