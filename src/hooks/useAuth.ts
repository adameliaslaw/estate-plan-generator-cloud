/**
 * useAuth — convenience hook to consume AuthContext.
 *
 * Throws a descriptive error if used outside of <AuthProvider>.
 */

import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from '@/contexts/AuthContext';

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error(
      'useAuth must be used within an <AuthProvider>. ' +
        'Wrap your component tree with <AuthProvider> in main.tsx.',
    );
  }
  return context;
}
