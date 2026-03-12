import { type ReactNode, useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Menu, ChevronDown, LogOut, User, AlertTriangle } from 'lucide-react';
import { AppSidebar } from './AppSidebar';
const GlobalAiWidget = lazy(() => import('@/components/ai/GlobalAiWidget').then(m => ({ default: m.GlobalAiWidget })));
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES } from '@/config/constants';
import type { UserRole } from '@/types';
import { cn } from '@/lib/utils';

/** Map each pathname to a human-readable page title. */
function usePageTitle(): string {
  const location = useLocation();
  const titlesMap: Record<string, string> = {
    [ROUTES.DASHBOARD]: 'Dashboard',
    [ROUTES.CLIENTS]: 'Clients',
    [ROUTES.CALENDAR]: 'Calendar',
    [ROUTES.PAYMENTS]: 'Payments',
    [ROUTES.SETTINGS]: 'Settings',
    [ROUTES.SETTINGS_FIRM]: 'Firm Settings',
    [ROUTES.SETTINGS_USERS]: 'User Management',
    [ROUTES.SETTINGS_BILLING]: 'Billing',
  };

  const path = location.pathname;

  // Exact match first
  if (titlesMap[path]) return titlesMap[path];

  // Client detail page
  if (/^\/clients\/[^/]+$/.test(path)) return 'Client Profile';
  if (/^\/clients\/[^/]+\/questionnaire/.test(path)) return 'Questionnaire';
  if (/^\/clients\/[^/]+\/documents\/[^/]+\/edit/.test(path)) return 'Document Editor';
  if (/^\/clients\/[^/]+\/documents/.test(path)) return 'Documents';

  return 'Estate Planning Portal';
}

interface AppLayoutProps {
  children: ReactNode;
  allowedRoles?: UserRole[];
  /** If true, removes the max-width constraint and padding from the main content area.
   *  Used by full-screen editors and dashboards that manage their own layout. */
  fullWidth?: boolean;
}

export function AppLayout({ children, allowedRoles, fullWidth = false }: AppLayoutProps) {
  const { loading } = useRequireAuth(allowedRoles);
  const { userProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const pageTitle = usePageTitle();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [sessionWarning, setSessionWarning] = useState(false);

  // Listen for the custom 'session-warning' event dispatched by AuthContext
  useEffect(() => {
    function handleWarning() {
      setSessionWarning(true);
    }
    window.addEventListener('session-warning', handleWarning);
    return () => window.removeEventListener('session-warning', handleWarning);
  }, []);

  // Close the mobile sidebar if we resize to desktop
  useEffect(() => {
    function onResize() {
      if (window.innerWidth >= 1024) setSidebarOpen(false);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  async function handleSignOut() {
    try {
      await signOut();
      navigate(ROUTES.LOGIN, { replace: true });
    } catch {
      // sign-out failure handled by auth listener
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#ebf4ff]">
        <LoadingSpinner size="lg" label="Loading..." />
      </div>
    );
  }

  const initials = userProfile?.displayName
    ? userProfile.displayName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
    : (userProfile?.email?.[0]?.toUpperCase() ?? '?');

  return (
    <div className="flex h-screen print:h-auto overflow-hidden print:!overflow-visible bg-gray-50">
      {/* ── Desktop sidebar ── */}
      <div className="hidden lg:flex lg:shrink-0">
        <AppSidebar />
      </div>

      {/* ── Mobile sidebar overlay ── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          {/* Drawer */}
          <div className="absolute inset-y-0 left-0 z-50 flex w-64 shadow-2xl">
            <AppSidebar isSheet onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* ── Main column ── */}
      <div className="flex flex-1 flex-col overflow-hidden print:!overflow-visible">
        {/* Session timeout warning banner */}
        {sessionWarning && (
          <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="font-medium">
              Your session will expire in less than 2 minutes due to inactivity.
            </span>
            <button
              onClick={() => setSessionWarning(false)}
              className="ml-auto text-amber-600 hover:text-amber-800 underline text-xs"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Header */}
        <header className="flex h-16 shrink-0 items-center border-b border-gray-200 bg-white px-4 shadow-sm print:hidden">
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="mr-3 rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Page title */}
          <h1 className="text-lg font-semibold text-[#1a365d] truncate">{pageTitle}</h1>

          {/* Right side: user menu */}
          <div className="ml-auto relative">
            <button
              onClick={() => setDropdownOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
              aria-haspopup="true"
              aria-expanded={dropdownOpen}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1a365d] text-xs font-semibold text-white">
                {initials}
              </div>
              <span className="hidden sm:block truncate max-w-[140px]">
                {userProfile?.displayName || userProfile?.email || 'User'}
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-gray-400 transition-transform duration-150',
                  dropdownOpen && 'rotate-180',
                )}
              />
            </button>

            {/* Dropdown menu */}
            {dropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setDropdownOpen(false)}
                  aria-hidden="true"
                />
                <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  <div className="border-b border-gray-100 px-4 py-2.5">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {userProfile?.displayName || 'User'}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{userProfile?.email}</p>
                  </div>
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      navigate(ROUTES.SETTINGS);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <User className="h-4 w-4" />
                    Profile & Settings
                  </button>
                  <div className="border-t border-gray-100 mt-1 pt-1">
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        void handleSignOut();
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Main scrollable content */}
        <main className={cn('flex-1 overflow-hidden print:!overflow-visible', !fullWidth && 'overflow-y-auto print:!overflow-y-visible')}>
          {fullWidth ? (
            <div className="h-full">{children}</div>
          ) : (
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
          )}
        </main>
      </div>

      {/* ── Global AI Chat Widget (lazy-loaded for faster initial page load) ── */}
      <Suspense fallback={null}>
        <GlobalAiWidget />
      </Suspense>
    </div>
  );
}
