import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, ArrowLeft } from 'lucide-react';
import { useDocument } from '@/hooks/useFirestore';
import { useAuth } from '@/hooks/useAuth';
import { COLLECTIONS } from '@/config/constants';
import PrintableQuestionnaire from '@/components/questionnaire/PrintableQuestionnaire';
import type { Client } from '@/types';
import { Button } from '@/components/ui/button';

export default function PrintableQuestionnairePage() {
    const { clientId, firmId } = useParams<{ clientId: string; firmId: string }>();
    const navigate = useNavigate();
    const { loading: authLoading } = useAuth();

    // Wait for Firebase Auth to restore the session before querying Firestore.
    // Without this, opening in a new tab races the auth restore and hits
    // "Missing or insufficient permissions".
    const docPath = !authLoading && clientId && firmId
        ? `${COLLECTIONS.CLIENTS(firmId)}/${clientId}`
        : null;
    const { data: client, loading, error } = useDocument<Client>(docPath);

    if (!clientId || !firmId) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
                <p className="text-lg font-semibold text-red-600">Invalid link.</p>
                <p className="mt-1 text-sm text-gray-500">
                    Missing firm ID or client ID.
                </p>
            </div>
        );
    }

    if (authLoading || loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-50">
                <Loader2 className="h-8 w-8 animate-spin text-[#1a365d]" />
            </div>
        );
    }

    if (error || !client) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
                <p className="text-lg font-semibold text-red-600">Failed to load client data.</p>
                <Button
                    variant="outline"
                    className="mt-4 gap-2"
                    onClick={() => navigate(-1)}
                >
                    <ArrowLeft className="h-4 w-4" />
                    Go Back
                </Button>
            </div>
        );
    }

    const clientFullName = [
        client.personalInfo?.firstName,
        client.personalInfo?.middleName,
        client.personalInfo?.lastName,
        client.personalInfo?.suffix,
    ]
        .filter(Boolean)
        .join(' ');

    const spouseFullName = client.spouseInfo
        ? [
            client.spouseInfo.firstName,
            client.spouseInfo.middleName,
            client.spouseInfo.lastName,
            client.spouseInfo.suffix,
        ]
            .filter(Boolean)
            .join(' ')
        : null;

    // When a spouse exists, render two separate questionnaires — one per person
    if (spouseFullName) {
        return (
            <>
                <PrintableQuestionnaire clientName={clientFullName || 'Client'} client={client} />
                {/* Page-break separator between the two questionnaires */}
                <div
                    className="print:hidden"
                    style={{
                        borderTop: '3px dashed #1a365d',
                        margin: '2rem auto',
                        maxWidth: '8.5in',
                        position: 'relative',
                        textAlign: 'center',
                    }}
                >
                    <span
                        style={{
                            background: '#f1f5f9',
                            padding: '0 1rem',
                            position: 'relative',
                            top: '-0.65rem',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: '#1a365d',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                        }}
                    >
                        Spouse Questionnaire Below
                    </span>
                </div>
                <PrintableQuestionnaire clientName={spouseFullName} client={client} />
            </>
        );
    }

    return <PrintableQuestionnaire clientName={clientFullName || 'Client'} client={client} />;
}
