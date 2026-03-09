import type { ReactNode } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Scale, Lock, LogOut } from 'lucide-react';
import { FIRM_DEFAULTS, ROUTES } from '@/config/constants';
import { useAuth } from '@/hooks/useAuth';
import { useEffect } from 'react';

interface ClientLayoutProps {
  children: ReactNode;
}

/**
 * Clean, minimal layout for client-facing pages (questionnaire, etc.).
 * No sidebar — just a branded header, centered content area, and a footer
 * with an attorney-client privilege notice.
 */
export function ClientLayout({ children }: ClientLayoutProps) {
  const { userProfile, signOut, loading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isClient = userProfile?.role === 'client';

  useEffect(() => {
    if (!loading && !user) {
      // User is not logged in, redirect to login page and preserve the intended URL
      const redirectUrl = encodeURIComponent(location.pathname + location.search);
      navigate(`${ROUTES.LOGIN}?redirect=${redirectUrl}`, { replace: true });
    }
  }, [loading, user, navigate, location]);

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate(ROUTES.LOGIN, { replace: true });
    } catch {
      // Ignored
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#ebf4ff]">
      {/* Header */}
      <header className="border-b border-[#2b6cb0]/20 bg-white shadow-sm px-4 sm:px-6 py-4 flex items-center justify-between">
        {isClient ? (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1a365d]">
              <Scale className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-base font-semibold text-[#1a365d]">{FIRM_DEFAULTS.firmName}</p>
              <p className="text-xs text-gray-500">Estate Planning Questionnaire</p>
            </div>
          </div>
        ) : (
          <Link
            to={ROUTES.DASHBOARD}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1a365d]">
              <Scale className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-base font-semibold text-[#1a365d]">{FIRM_DEFAULTS.firmName}</p>
              <p className="text-xs text-gray-500">Back to Dashboard</p>
            </div>
          </Link>
        )}

        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-red-600 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </header>

      {/* Page content */}
      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">{children}</div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#2b6cb0]/15 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Privilege notice */}
            <div className="flex items-start gap-2 text-xs text-gray-500">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2b6cb0]" />
              <span>
                <span className="font-semibold text-gray-700">
                  Attorney-Client Privilege Notice:
                </span>{' '}
                The information you provide is confidential and protected by the attorney-client
                privilege. It will only be used to prepare your estate planning documents.
              </span>
            </div>

            {/* Firm info */}
            <div className="shrink-0 text-right text-xs text-gray-400">
              <p className="font-medium text-gray-500">{FIRM_DEFAULTS.firmName}</p>
              <p>{FIRM_DEFAULTS.firmPhone}</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
