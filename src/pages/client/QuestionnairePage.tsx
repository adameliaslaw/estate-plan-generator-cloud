import { useParams } from 'react-router-dom';
import { QuestionnaireProvider } from '@/contexts/QuestionnaireContext';
import { QuestionnaireShell } from '@/components/questionnaire/QuestionnaireShell';

export default function QuestionnairePage() {
  const { clientId } = useParams<{ clientId: string }>();
  // firmId is extracted from URL context; for the client-facing route
  // (/questionnaire/:clientId) we use a default until Firebase auth is wired.
  // For the staff route (/clients/:clientId/questionnaire) the staff are
  // authenticated so we could read firmId from auth context later.
  const firmId = 'default-firm'; // placeholder until real firm auth is set

  if (!clientId) {
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
