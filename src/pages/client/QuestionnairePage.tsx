import { useParams, useSearchParams } from 'react-router-dom';
import { QuestionnaireProvider } from '@/contexts/QuestionnaireContext';
import { QuestionnaireShell } from '@/components/questionnaire/QuestionnaireShell';
import { useAuth } from '@/hooks/useAuth';

export default function QuestionnairePage() {
  const { clientId, firmId: urlFirmId } = useParams<{ clientId: string; firmId?: string }>();
  const { userProfile } = useAuth();
  const [searchParams] = useSearchParams();

  // firmId is extracted from URL context; for the client-facing route
  // (/questionnaire/:firmId/:clientId) it will be present.
  // For the staff route (/clients/:clientId/questionnaire) we fall back
  // to the authenticated user's firmId from their profile.
  const firmId = urlFirmId || userProfile?.firmId || '';

  // Edit mode is only available to staff — clients who receive the link
  // without ?edit=1 (or who are role=client) are unaffected.
  const isStaff = userProfile?.role !== 'client';
  const isEditMode = isStaff && searchParams.get('edit') === '1';

  if (!clientId || !firmId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <p className="text-lg font-semibold text-red-600">Invalid questionnaire link.</p>
        <p className="mt-1 text-sm text-gray-500">
          Please use the link provided by your attorney.
        </p>
      </div>
    );
  }

  return (
    <QuestionnaireProvider firmId={firmId} clientId={clientId}>
      <QuestionnaireShell isEditMode={isEditMode} />
    </QuestionnaireProvider>
  );
}
