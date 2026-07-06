import { createContext, useContext, useState, useEffect } from 'react';
import * as api from '../api';

const PermissionsContext = createContext(null);

export function PermissionsProvider({ userId, children }) {
  const [permissions, setPermissions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
        managedDerivedRolesScope: '[]',
        canAssignRoles: false,
        canManageReplications: false,
        canViewAuditLogs: false,
        canManageSettings: false,
        allowedEnvironments: '[]',
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
