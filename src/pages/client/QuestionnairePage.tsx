import { useParams } from 'react-router-dom';
import { QuestionnaireProvider } from '@/contexts/QuestionnaireContext';
import { QuestionnaireShell } from '@/components/questionnaire/QuestionnaireShell';

export default function QuestionnairePage() {
  const { clientId, firmId: urlFirmId } = useParams<{ clientId: string; firmId?: string }>();
  // firmId is extracted from URL context; for the client-facing route
  // (/questionnaire/:firmId/:clientId) it will be present.
  // For the staff route (/clients/:clientId/questionnaire) the staff are
  // authenticated, but the route currently doesn't have firmId. We use a fallback
  // if needed, though in the future we should read firmId from auth context.
  const firmId = urlFirmId || 'default-firm'; // placeholder until real firm auth is set

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
      <QuestionnaireShell />
    </QuestionnaireProvider>
  );
}
