import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, ArrowLeft } from 'lucide-react';
import { useDocument } from '@/hooks/useFirestore';
import { COLLECTIONS } from '@/config/constants';
import PrintableQuestionnaire from '@/components/questionnaire/PrintableQuestionnaire';
import type { Client } from '@/types';
import { Button } from '@/components/ui/button';

export default function PrintableQuestionnairePage() {
    const { clientId, firmId } = useParams<{ clientId: string; firmId: string }>();
    const navigate = useNavigate();

    const docPath = clientId && firmId ? `${COLLECTIONS.CLIENTS(firmId)}/${clientId}` : null;
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

    if (loading) {
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

    const displayHeading = spouseFullName
        ? `${clientFullName} & ${spouseFullName}`
        : clientFullName || 'Client';

    return <PrintableQuestionnaire clientName={displayHeading} data={client} />;
}
