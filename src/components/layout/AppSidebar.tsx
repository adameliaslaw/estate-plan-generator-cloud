import { NavLink, Link, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Calendar,
  LogOut,
  X,
  Scale,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES, FIRM_DEFAULTS, COLLECTIONS } from '@/config/constants';
import { useDocument } from '@/hooks/useFirestore';
import type { Firm } from '@/types';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: ROUTES.DASHBOARD, icon: LayoutDashboard },
  { label: 'Clients', href: ROUTES.CLIENTS, icon: Users },
  { label: 'Calendar', href: ROUTES.CALENDAR, icon: Calendar },
];

interface AppSidebarProps {
  onClose?: () => void;
  isSheet?: boolean;
}

export function AppSidebar({ onClose, isSheet = false }: AppSidebarProps) {
  const { userProfile, signOut } = useAuth();
  const navigate = useNavigate();

  const { data: firmDoc } = useDocument<Firm>(
    userProfile?.firmId ? `${COLLECTIONS.FIRMS}/${userProfile.firmId}` : null
  );

  async function handleSignOut() {
    try {
      await signOut();
      navigate(ROUTES.LOGIN, { replace: true });
    } catch {
      // Sign out failed silently - user will be redirected by auth state listener
    }
  }

  const roleLabel: Record<string, string> = {
    admin: 'Admin',
    attorney: 'Attorney',
    paralegal: 'Paralegal',
    client: 'Client',
  };

  const roleBadgeColor: Record<string, string> = {
    admin: 'bg-purple-100 text-purple-700',
    attorney: 'bg-blue-100 text-[#2b6cb0]',
    paralegal: 'bg-green-100 text-green-700',
    client: 'bg-gray-100 text-gray-600',
  };

  return (
    <aside className="flex h-full w-64 flex-col bg-[#1a365d] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-5 border-b border-white/10">
        <Link to={ROUTES.DASHBOARD} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          {/* Logo mark */}
          {firmDoc?.logoUrl ? (
            <img src={firmDoc.logoUrl} alt="Logo" className="max-h-12 max-w-[150px] object-contain" />
          ) : (
            <>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 ring-2 ring-white/20">
                <Scale className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight text-white">
                  {firmDoc?.firmName || FIRM_DEFAULTS.firmName}
                </p>
                <p className="text-xs text-white/60 mt-0.5">Estate Planning</p>
              </div>
            </>
          )}
        </Link>
        {isSheet && onClose && (
          <button
            onClick={onClose}
            className="ml-2 rounded p-1 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          if (item.disabled) {
            return (
              <div
                key={item.href}
                className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-white/40 cursor-not-allowed select-none"
                title="Coming soon"
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{item.label}</span>
                <span className="ml-auto text-[10px] font-medium bg-white/10 text-white/50 rounded px-1.5 py-0.5">
                  Soon
                </span>
              </div>
            );
          }
          return (
            <NavLink
              key={item.href}
              to={item.href}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'bg-[#2b6cb0] text-white shadow-sm'
                    : 'text-white/75 hover:bg-white/10 hover:text-white',
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="border-t border-white/10 px-3 py-4 space-y-2">
        {userProfile && (
          <div className="flex items-center gap-3 px-2 py-1">
            {/* Avatar */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2b6cb0] text-sm font-semibold text-white">
              {userProfile.displayName
                ? userProfile.displayName
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2)
                : userProfile.email[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white leading-tight">
                {userProfile.displayName || userProfile.email}
              </p>
              <span
                className={cn(
                  'inline-block mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                  roleBadgeColor[userProfile.role] ?? 'bg-gray-100 text-gray-600',
                )}
              >
                {roleLabel[userProfile.role] ?? userProfile.role}
              </span>
            </div>
          </div>
        )}
        <button
          onClick={() => void handleSignOut()}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-white/75 hover:bg-white/10 hover:text-white transition-colors"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
