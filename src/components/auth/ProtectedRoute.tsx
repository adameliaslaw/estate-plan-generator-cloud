import type { ReactNode } from 'react';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import type { UserRole } from '@/types';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: UserRole[];
}

/**
 * Route guard that:
 * - Shows a loading spinner while auth state is resolving
 * - Redirects to /login if not authenticated (via useRequireAuth)
 * - Redirects to /unauthorized if role does not match (via useRequireAuth)
 * - Renders children when authorized
 */
export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { loading } = useRequireAuth(allowedRoles);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#ebf4ff]">
        <LoadingSpinner size="lg" label="Verifying session..." />
      </div>
    );
  }

  return <>{children}</>;
}
