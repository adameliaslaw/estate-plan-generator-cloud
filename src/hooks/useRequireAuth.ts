/**
 * useRequireAuth — enforces authentication (and optionally role) for a route.
 *
 * Usage:
 *   const { user, userProfile, loading } = useRequireAuth();
 *   const { user, userProfile, loading } = useRequireAuth(['admin', 'attorney']);
 *
 * Behaviour:
 *   - While auth state is resolving: returns loading=true, no redirect yet.
 *   - Not signed in: redirects to /login, preserving the current URL as
 *     a `redirect` query param so the login page can send the user back.
 *   - Signed in but wrong role: redirects to /unauthorized.
 *   - Signed in with correct role (or no role requirement): returns the user.
 */

import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES } from '@/config/constants';
import type { UserRole } from '@/types';

export interface RequireAuthResult {
  user: ReturnType<typeof useAuth>['user'];
  userProfile: ReturnType<typeof useAuth>['userProfile'];
  loading: boolean;
}

export function useRequireAuth(requiredRoles?: UserRole[]): RequireAuthResult {
  const { user, userProfile, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Don't redirect while the initial auth state is still loading.
    if (loading) return;

    // Not authenticated → go to login, preserve intended destination.
    if (!user) {
      const redirectTo = encodeURIComponent(
        location.pathname + location.search,
      );
      void navigate(`${ROUTES.LOGIN}?redirect=${redirectTo}`, {
        replace: true,
      });
      return;
    }

    // Role check — only applied once the profile has loaded.
    if (requiredRoles && requiredRoles.length > 0 && userProfile) {
      if (!requiredRoles.includes(userProfile.role)) {
        void navigate(ROUTES.UNAUTHORIZED, { replace: true });
      }
    }
  }, [loading, user, userProfile, requiredRoles, navigate, location]);

  return { user, userProfile, loading };
}
