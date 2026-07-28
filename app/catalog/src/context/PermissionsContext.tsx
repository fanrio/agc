import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import * as api from '../api';

export interface UserPermissions {
  isSuperAdmin: boolean;
  canManageAppUsers: boolean;
  canManageOrgRoles: boolean;
  canManageSingleRoles: boolean;
  canManageDerivedRoles: boolean;
  managedDerivedRolesScope: [];
  canAssignRoles: boolean;
  canManageReplications: boolean;
  canViewAuditLogs: boolean;
  canManageSettings: boolean;
  allowedEnvironments: [];
  allowedAccessDomains: [];
  isActive: boolean;
  userId?: string;
  userName?: string;
}

export interface PermissionsContextType {
  permissions: UserPermissions | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  userId: string;
}

const PermissionsContext = createContext<PermissionsContextType | null>(null);

export function PermissionsProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [permissions, setPermissions] = useState<UserPermissions | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPermissions = async () => {
    setLoading(true);
    setError(null);
    try {
      // Sync simulated user header value in api client
      api.setSimulatedUser(userId);
      const data = await api.getCurrentUserPermissions();
      setPermissions(data || {
        isSuperAdmin: false,
        canManageAppUsers: false,
        canManageOrgRoles: false,
        canManageSingleRoles: false,
        canManageDerivedRoles: false,
        managedDerivedRolesScope: '[]',
        canAssignRoles: false,
        canManageReplications: false,
        canViewAuditLogs: false,
        canManageSettings: false,
        allowedEnvironments: '[]',
        allowedAccessDomains: '[]',
        isActive: false
      });
    } catch (err) {
      console.error('Failed to load user permissions:', err);
      setError(err.message || 'Failed to load permissions');
      setPermissions({
        isSuperAdmin: false,
        canManageAppUsers: false,
        canManageOrgRoles: false,
        canManageSingleRoles: false,
        canManageDerivedRoles: false,
        managedDerivedRolesScope: [],
        canAssignRoles: false,
        canManageReplications: false,
        canViewAuditLogs: false,
        canManageSettings: false,
        allowedEnvironments: [],
        allowedAccessDomains: [],
        isActive: false
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userId) {
      fetchPermissions();
    }
  }, [userId]);

  return (
    <PermissionsContext.Provider value={{ permissions, loading, error, refetch: fetchPermissions, userId }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export const usePermissions = () => {
  const context = useContext(PermissionsContext);
  if (!context) {
    throw new Error('usePermissions must be used within a PermissionsProvider');
  }
  return context;
};
