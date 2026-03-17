import { useAuth } from '@/hooks/useAuth';
import type { UserCapability } from '@/types';

export function usePermissions() {
  const { userProfile } = useAuth();
  
  if (!userProfile) {
    return {
      canManageFirmSettings: false,
      canManageUsers: false,
      canManageClients: false,
      canManageDocuments: false,
      canManageBilling: false,
      hasCapability: () => false,
      isAdmin: false,
      isAttorney: false,
      isParalegal: false,
    };
  }

  const { role, customCapabilities = [] } = userProfile;
  const isAdmin = role === 'admin';
  
  const hasCapability = (cap: UserCapability) => {
    return isAdmin || customCapabilities.includes(cap);
  };
  
  return {
    canManageFirmSettings: role === 'attorney' || role === 'paralegal' || hasCapability('manage_firm_settings'),
    canManageUsers: role === 'attorney' || role === 'paralegal' || hasCapability('manage_users'),
    canManageClients: role === 'attorney' || role === 'paralegal' || hasCapability('manage_clients'),
    canManageDocuments: role === 'attorney' || role === 'paralegal' || hasCapability('manage_documents'),
    canManageBilling: role === 'attorney' || role === 'paralegal' || hasCapability('manage_billing'),
    hasCapability,
    isAdmin,
    isAttorney: role === 'attorney',
    isParalegal: role === 'paralegal',
  };
}
