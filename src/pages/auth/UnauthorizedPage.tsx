import { useNavigate } from 'react-router-dom';
import { ShieldOff, ArrowLeft, LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES, FIRM_DEFAULTS } from '@/config/constants';

export default function UnauthorizedPage() {
  const { signOut, userProfile } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    try {
      await signOut();
      navigate(ROUTES.LOGIN, { replace: true });
    } catch {
      navigate(ROUTES.LOGIN, { replace: true });
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#ebf4ff] px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-red-100 bg-white px-8 py-12 text-center shadow-lg">
        {/* Icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 border-2 border-red-100">
          <ShieldOff className="h-10 w-10 text-red-500" />
        </div>

        {/* Heading */}
        <h1 className="text-2xl font-bold text-[#1a365d]">Access Denied</h1>
        <p className="mt-3 text-sm text-gray-600">
          You don&apos;t have permission to view this page.
          {userProfile && (
            <>
              {' '}
              Your current role (<span className="font-semibold capitalize">{userProfile.role}</span>)
              does not have access to this resource.
            </>
          )}
        </p>

        <p className="mt-2 text-xs text-gray-400">
          If you believe this is a mistake, please contact{' '}
          <a
            href={`mailto:${FIRM_DEFAULTS.firmEmail}`}
            className="text-[#2b6cb0] hover:underline"
          >
            {FIRM_DEFAULTS.firmEmail}
          </a>
          .
        </p>

        {/* Actions */}
        <div className="mt-8 flex flex-col gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </button>
          <button
            onClick={() => void handleSignOut()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1a365d] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1e407a] transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-gray-400">
        &copy; {new Date().getFullYear()} {FIRM_DEFAULTS.firmName}
      </p>
    </div>
  );
}
