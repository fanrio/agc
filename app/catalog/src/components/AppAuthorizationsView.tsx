import { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Checkbox,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  Autocomplete,
  CircularProgress,
  AlertColor,
  Chip,
  Divider,
  Tooltip
} from '@mui/material';
import { Plus, Trash2, Shield, AlertTriangle } from 'lucide-react';
import * as api from '../api';
import AppToast from './AppToast';
import UserSelection from './UserSelection';
import EnvironmentSelection from './EnvironmentSelection';

// ─── Fixed Application Role Catalog ──────────────────────────────────────────

export type AppRoleId =
  | 'SUPER_ADMIN'
  | 'SYSTEM_ADMIN'
  | 'AUTHORIZATION_ARCHITECT'
  | 'DERIVED_ROLE_MANAGER'
  | 'USER_ASSIGNMENT_ADMIN'
  | 'AUDITOR';

export interface AppRoleFlags {
  isSuperAdmin: boolean;
  canManageAppUsers: boolean;
  canManageSettings: boolean;
  canManageOrgRoles: boolean;
  canManageSingleRoles: boolean;
  canManageDerivedRoles: boolean;
  canAssignRoles: boolean;
  canManageReplications: boolean;
  canViewAuditLogs: boolean;
}

export interface AppRoleDefinition {
  id: AppRoleId;
  label: string;
  description: string;
  color: 'error' | 'warning' | 'primary' | 'secondary' | 'info' | 'success';
  flags: AppRoleFlags;
  supportsEnvironmentScope: boolean;
  supportsAccessDomainScope: boolean;
  supportsDerivedRoleScope: boolean;
}

export const APP_ROLES: AppRoleDefinition[] = [
  {
    id: 'SUPER_ADMIN',
    label: 'Super Administrator',
    description: 'Full unrestricted access to all system settings, roles, assignments, replications, and users',
    color: 'error',
    flags: {
      isSuperAdmin: true,
      canManageAppUsers: true,
      canManageSettings: true,
      canManageOrgRoles: true,
      canManageSingleRoles: true,
      canManageDerivedRoles: true,
      canAssignRoles: true,
      canManageReplications: true,
      canViewAuditLogs: true,
    },
    supportsEnvironmentScope: false,
    supportsAccessDomainScope: false,
    supportsDerivedRoleScope: false,
  },
  {
    id: 'SYSTEM_ADMIN',
    label: 'System Administrator',
    description: 'Manages BDC/HANA connections, Restriction Fields, Access Domains, Dynamic Rules, Replications, and App Users',
    color: 'warning',
    flags: {
      isSuperAdmin: false,
      canManageAppUsers: true,
      canManageSettings: true,
      canManageOrgRoles: false,
      canManageSingleRoles: false,
      canManageDerivedRoles: false,
      canAssignRoles: false,
      canManageReplications: true,
      canViewAuditLogs: false,
    },
    supportsEnvironmentScope: true,
    supportsAccessDomainScope: false,
    supportsDerivedRoleScope: false,
  },
  {
    id: 'AUTHORIZATION_ARCHITECT',
    label: 'Authorization Architect',
    description: 'Central role designer — manages Org Structure, Single Roles, Derived Roles, and Replications',
    color: 'primary',
    flags: {
      isSuperAdmin: false,
      canManageAppUsers: false,
      canManageSettings: false,
      canManageOrgRoles: true,
      canManageSingleRoles: true,
      canManageDerivedRoles: true,
      canAssignRoles: false,
      canManageReplications: true,
      canViewAuditLogs: false,
    },
    supportsEnvironmentScope: true,
    supportsAccessDomainScope: true,
    supportsDerivedRoleScope: false,
  },
  {
    id: 'DERIVED_ROLE_MANAGER',
    label: 'Derived Role Manager (Key User)',
    description: 'Regional/department lead — derives child roles from permitted parent roles and assigns those derived roles to users',
    color: 'secondary',
    flags: {
      isSuperAdmin: false,
      canManageAppUsers: false,
      canManageSettings: false,
      canManageOrgRoles: false,
      canManageSingleRoles: false,
      canManageDerivedRoles: true,
      canAssignRoles: false,
      canManageReplications: false,
      canViewAuditLogs: false,
    },
    supportsEnvironmentScope: true,
    supportsAccessDomainScope: true,
    supportsDerivedRoleScope: true,
  },
  {
    id: 'USER_ASSIGNMENT_ADMIN',
    label: 'User Assignment Admin',
    description: 'Helpdesk / IAM provisioning — assigns and revokes existing roles for users and inspects effective access profiles',
    color: 'success',
    flags: {
      isSuperAdmin: false,
      canManageAppUsers: false,
      canManageSettings: false,
      canManageOrgRoles: false,
      canManageSingleRoles: false,
      canManageDerivedRoles: false,
      canAssignRoles: true,
      canManageReplications: false,
      canViewAuditLogs: false,
    },
    supportsEnvironmentScope: true,
    supportsAccessDomainScope: true,
    supportsDerivedRoleScope: false,
  },
  {
    id: 'AUDITOR',
    label: 'Auditor',
    description: 'Read-only compliance reviewer — views Audit Logs, Dashboard KPIs, and User Access Profiles',
    color: 'info',
    flags: {
      isSuperAdmin: false,
      canManageAppUsers: false,
      canManageSettings: false,
      canManageOrgRoles: false,
      canManageSingleRoles: false,
      canManageDerivedRoles: false,
      canAssignRoles: false,
      canManageReplications: false,
      canViewAuditLogs: true,
    },
    supportsEnvironmentScope: true,
    supportsAccessDomainScope: true,
    supportsDerivedRoleScope: false,
  },
];

export const APP_ROLES_BY_ID: Record<AppRoleId, AppRoleDefinition> = APP_ROLES.reduce(
  (acc, r) => {
    acc[r.id] = r;
    return acc;
  },
  {} as Record<AppRoleId, AppRoleDefinition>
);

export function rolesToFlags(roleIds: AppRoleId[]): AppRoleFlags {
  const effective: AppRoleFlags = {
    isSuperAdmin: false,
    canManageAppUsers: false,
    canManageSettings: false,
    canManageOrgRoles: false,
    canManageSingleRoles: false,
    canManageDerivedRoles: false,
    canAssignRoles: false,
    canManageReplications: false,
    canViewAuditLogs: false,
  };
  for (const id of roleIds) {
    const def = APP_ROLES_BY_ID[id];
    if (!def) continue;
    (Object.keys(effective) as (keyof AppRoleFlags)[]).forEach((k) => {
      if (def.flags[k]) effective[k] = true;
    });
  }
  return effective;
}

export function inferAppRolesFromFlags(auth: Record<string, any>): AppRoleId[] {
  if (!auth) return ['AUDITOR'];
  if (auth.isSuperAdmin) return ['SUPER_ADMIN'];
  const roles: AppRoleId[] = [];
  if (auth.canManageSettings || auth.canManageAppUsers) {
    roles.push('SYSTEM_ADMIN');
  }
  if (auth.canManageOrgRoles || auth.canManageSingleRoles) {
    roles.push('AUTHORIZATION_ARCHITECT');
  } else if (auth.canManageDerivedRoles) {
    roles.push('DERIVED_ROLE_MANAGER');
  }
  if (auth.canAssignRoles) {
    roles.push('USER_ASSIGNMENT_ADMIN');
  }
  if (auth.canViewAuditLogs) {
    roles.push('AUDITOR');
  }
  return roles.length > 0 ? roles : ['AUDITOR'];
}

function normalizeSelectedRoles(prevRoles: AppRoleId[], nextRoles: AppRoleId[]): AppRoleId[] {
  if (nextRoles.length === 0) return [];
  const hadSuper = prevRoles.includes('SUPER_ADMIN');
  const hasSuper = nextRoles.includes('SUPER_ADMIN');
  if (!hadSuper && hasSuper) {
    return ['SUPER_ADMIN'];
  }
  if (hadSuper && nextRoles.length > 1) {
    return nextRoles.filter((r) => r !== 'SUPER_ADMIN');
  }
  return nextRoles;
}

function rolesSupportEnvironmentScope(roleIds: AppRoleId[]): boolean {
  if (roleIds.includes('SUPER_ADMIN')) return false;
  return roleIds.some((id) => APP_ROLES_BY_ID[id]?.supportsEnvironmentScope);
}

function rolesSupportAccessDomainScope(roleIds: AppRoleId[]): boolean {
  if (roleIds.includes('SUPER_ADMIN')) return false;
  return roleIds.some((id) => APP_ROLES_BY_ID[id]?.supportsAccessDomainScope);
}

function rolesSupportDerivedRoleScope(roleIds: AppRoleId[]): boolean {
  if (roleIds.includes('SUPER_ADMIN') || roleIds.includes('AUTHORIZATION_ARCHITECT')) return false;
  return roleIds.includes('DERIVED_ROLE_MANAGER');
}

// ─── Environment helpers ──────────────────────────────────────────────────────
const parseEnvironments = (val: any): string[] => {
  if (!val || val === 'ALL' || val === '*') return ['D', 'Q', 'P'];
  try {
    const parsed = JSON.parse(val);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    return String(val).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  }
  return [];
};

const serializeEnvironments = (arr: string[]) => {
  if (!arr || arr.length === 0) return '[]';
  if (arr.length === 3) return 'ALL';
  return JSON.stringify(arr);
};

// ─── Access Domain helpers ───────────────────────────────────────────────────
const parseAccessDomains = (val: any): string[] | null => {
  if (!val || val === 'ALL' || val === '*') return null; // null = ALL
  try {
    const parsed = JSON.parse(val);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    return String(val).split(',').map((s) => s.trim()).filter(Boolean);
  }
  return null;
};

const serializeAccessDomains = (ids: string[] | null, allAccessDomains: any[]) => {
  if (!ids || (allAccessDomains.length > 0 && ids.length === allAccessDomains.length)) return 'ALL';
  return JSON.stringify(ids);
};

// ─── Section heading ──────────────────────────────────────────────────────────
function SectionHeading({ icon: Icon, title, subtitle, color = 'var(--accent-primary)' }: {
  icon: any;
  title: string;
  subtitle: string;
  color?: string;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'rgba(15,23,42,0.02)' }}>
      <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={16} color="#fff" />
      </Box>
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>{title}</Typography>
        <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
      </Box>
    </Box>
  );
}

export default function AppAuthorizationsView() {
  const [authorizations, setAuthorizations] = useState<any[]>([]);
  const [userRoleOverrides, setUserRoleOverrides] = useState<Record<string, AppRoleId[]>>({});
  const [accessDomains, setAccessDomains] = useState<any[]>([]);
  const [allRoles, setAllRoles] = useState<any[]>([]);
  const [restrictionFields, setRestrictionFields] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openAdd, setOpenAdd] = useState(false);
  const [selectedScimUser, setSelectedScimUser] = useState<any>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: (() => void) | null;
  }>({ open: false, title: '', message: '', onConfirm: null });
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: AlertColor;
  }>({ open: false, message: '', severity: 'success' });

  // Add-user dialog state
  const [newUserRoles, setNewUserRoles] = useState<AppRoleId[]>(['AUTHORIZATION_ARCHITECT']);
  const [newUserActive, setNewUserActive] = useState<boolean>(true);
  const [newUserEnvironments, setNewUserEnvironments] = useState<string[]>(['D', 'Q', 'P']);
  const [newUserAccessDomains, setNewUserAccessDomains] = useState<string[] | null>(null); // null = ALL
  const [newUserDerivedScope, setNewUserDerivedScope] = useState<string>('ALL');

  const resetAddDialogState = () => {
    setSelectedScimUser(null);
    setNewUserRoles(['AUTHORIZATION_ARCHITECT']);
    setNewUserActive(true);
    setNewUserEnvironments(['D', 'Q', 'P']);
    setNewUserAccessDomains(null);
    setNewUserDerivedScope('ALL');
  };

  // ─── Data loading ───────────────────────────────────────────────────────────
  const loadData = async () => {
    setLoading(true);
    try {
      const [authData, rolesData, fieldsData, accessDomainsData] = await Promise.all([
        api.getAppAuthorizations(),
        api.getRoles(),
        api.getRestrictionFields(),
        api.getAccessDomainsFlat()
      ]);
      const validAuths = (authData || []).filter(Boolean);
      setAuthorizations(validAuths);
      const initialRoleMap: Record<string, AppRoleId[]> = {};
      validAuths.forEach((a: any) => {
        if (a?.ID) {
          initialRoleMap[a.ID] = inferAppRolesFromFlags(a);
        }
      });
      setUserRoleOverrides(initialRoleMap);
      setAllRoles(rolesData || []);
      setRestrictionFields(fieldsData || []);
      setAccessDomains((accessDomainsData || []).filter((s: any) => !s.parent));
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'Failed to load data', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const getEffectiveRolesForRow = (auth: any): AppRoleId[] => {
    if (auth?.ID && userRoleOverrides[auth.ID]?.length) {
      return userRoleOverrides[auth.ID];
    }
    return inferAppRolesFromFlags(auth);
  };

  // ─── Update handlers ────────────────────────────────────────────────────────
  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      await api.updateAppAuthorization(id, { isActive });
      setAuthorizations((prev) => prev.map((item) => (item.ID === id ? { ...item, isActive } : item)));
      setSnackbar({ open: true, message: `User ${isActive ? 'activated' : 'deactivated'}`, severity: 'success' });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'Update failed', severity: 'error' });
    }
  };

  const handleUpdateUserRoles = async (auth: any, nextRoleDefs: AppRoleDefinition[]) => {
    const prevRoles = getEffectiveRolesForRow(auth);
    const rawNextIds = nextRoleDefs.map((d) => d.id);
    const normalizedIds = normalizeSelectedRoles(prevRoles, rawNextIds);

    if (normalizedIds.length === 0) {
      setSnackbar({ open: true, message: 'At least one application role must be assigned', severity: 'warning' });
      return;
    }

    const flags = rolesToFlags(normalizedIds);
    const payload: Record<string, any> = { ...flags };

    if (normalizedIds.includes('SUPER_ADMIN')) {
      payload.allowedEnvironments = 'ALL';
      payload.allowedAccessDomains = 'ALL';
      payload.managedDerivedRolesScope = 'ALL';
    } else if (normalizedIds.includes('AUTHORIZATION_ARCHITECT')) {
      payload.managedDerivedRolesScope = 'ALL';
    }

    try {
      await api.updateAppAuthorization(auth.ID, payload);
      setUserRoleOverrides((prev) => ({ ...prev, [auth.ID]: normalizedIds }));
      setAuthorizations((prev) =>
        prev.map((item) => (item.ID === auth.ID ? { ...item, ...payload } : item))
      );
      setSnackbar({ open: true, message: 'Application roles updated', severity: 'success' });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'Update failed', severity: 'error' });
    }
  };

  const handleUpdateEnvironments = async (id: string, valueArr: string[]) => {
    const serialized = serializeEnvironments(valueArr);
    try {
      await api.updateAppAuthorization(id, { allowedEnvironments: serialized });
      setAuthorizations((prev) => prev.map((item) => (item.ID === id ? { ...item, allowedEnvironments: serialized } : item)));
      setSnackbar({ open: true, message: 'Environments updated', severity: 'success' });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'Update failed', severity: 'error' });
    }
  };

  const handleUpdateAccessDomains = async (id: string, accessDomainIds: string[]) => {
    const serialized = serializeAccessDomains(accessDomainIds, accessDomains);
    try {
      await api.updateAppAuthorization(id, { allowedAccessDomains: serialized });
      setAuthorizations((prev) => prev.map((item) => (item.ID === id ? { ...item, allowedAccessDomains: serialized } : item)));
      setSnackbar({ open: true, message: 'Access Domain scope updated', severity: 'success' });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'Update failed', severity: 'error' });
    }
  };

  const handleUpdateScope = async (id: string, value: string) => {
    try {
      await api.updateAppAuthorization(id, { managedDerivedRolesScope: value });
      setAuthorizations((prev) => prev.map((item) => (item.ID === id ? { ...item, managedDerivedRolesScope: value } : item)));
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'Update failed', severity: 'error' });
    }
  };

  // ─── Add / Delete ───────────────────────────────────────────────────────────
  const handleToggleDialogRole = (roleId: AppRoleId) => {
    setNewUserRoles((prev) => {
      const exists = prev.includes(roleId);
      const nextRaw = exists ? prev.filter((r) => r !== roleId) : [...prev, roleId];
      return normalizeSelectedRoles(prev, nextRaw);
    });
  };

  const handleAddAuthorization = async () => {
    if (!selectedScimUser) {
      setSnackbar({ open: true, message: 'Please select a user from SCIM', severity: 'error' });
      return;
    }
    if (newUserRoles.length === 0) {
      setSnackbar({ open: true, message: 'Please select at least one application role', severity: 'error' });
      return;
    }
    const exists = authorizations.some(
      (a) => a.userId.toLowerCase() === selectedScimUser.username.toLowerCase()
    );
    if (exists) {
      setSnackbar({ open: true, message: `User "${selectedScimUser.displayName}" is already configured`, severity: 'error' });
      return;
    }

    const flags = rolesToFlags(newUserRoles);
    const hasEnvScope = rolesSupportEnvironmentScope(newUserRoles);
    const hasDomainScope = rolesSupportAccessDomainScope(newUserRoles);
    const hasDerivedScope = rolesSupportDerivedRoleScope(newUserRoles);

    const allowedEnvironments = !hasEnvScope
      ? 'ALL'
      : serializeEnvironments(newUserEnvironments);

    const allowedAccessDomains = !hasDomainScope
      ? 'ALL'
      : newUserAccessDomains === null
        ? 'ALL'
        : serializeAccessDomains(newUserAccessDomains, accessDomains);

    const managedDerivedRolesScope = hasDerivedScope
      ? (newUserDerivedScope || 'ALL')
      : 'ALL';

    try {
      const newAuth = await api.createAppAuthorization({
        userId: selectedScimUser.username,
        userName: selectedScimUser.displayName,
        ...flags,
        managedDerivedRolesScope,
        allowedEnvironments,
        allowedAccessDomains,
        isActive: newUserActive,
      });
      if (newAuth) {
        setAuthorizations((prev) => [...prev, newAuth].filter(Boolean));
        if (newAuth.ID) {
          setUserRoleOverrides((prev) => ({ ...prev, [newAuth.ID]: [...newUserRoles] }));
        }
      } else {
        await loadData();
      }
      setOpenAdd(false);
      resetAddDialogState();
      setSnackbar({ open: true, message: 'User authorization added', severity: 'success' });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'Failed to add authorization', severity: 'error' });
    }
  };

  const handleDelete = (id: string, name: string) => {
    setConfirmDialog({
      open: true,
      title: 'Remove Authorization',
      message: `Remove application authorization for user "${name}"?`,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));
        try {
          await api.deleteAppAuthorization(id);
          setAuthorizations((prev) => prev.filter((item) => item.ID !== id));
          setUserRoleOverrides((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setSnackbar({ open: true, message: 'Authorization removed', severity: 'success' });
        } catch (err: any) {
          setSnackbar({ open: true, message: err.message || 'Deletion failed', severity: 'error' });
        }
      }
    });
  };

  // ─── Sub-components ─────────────────────────────────────────────────────────
  const getRoleRestrictionFields = (roleId: string) => {
    const roleObj = allRoles.find((r) => r.ID === roleId);
    if (!roleObj) return [];
    const own = roleObj.ownRestrictions ? roleObj.ownRestrictions.map((r: any) => r.field) : [];
    const fields = new Set(own);
    const queue = roleObj.parentRoles
      ? roleObj.parentRoles.map((pr: any) => pr.parent?.ID || pr.parent_ID).filter(Boolean)
      : [];
    const visited = new Set(queue);
    while (queue.length > 0) {
      const currId = queue.shift();
      const currRole = allRoles.find((r) => r.ID === currId);
      if (currRole) {
        if (currRole.ownRestrictions) currRole.ownRestrictions.forEach((r: any) => fields.add(r.field));
        if (currRole.parentRoles) {
          currRole.parentRoles.forEach((pr: any) => {
            const pid = pr.parent?.ID || pr.parent_ID;
            if (pid && !visited.has(pid)) {
              visited.add(pid);
              queue.push(pid);
            }
          });
        }
      }
    }
    return restrictionFields.filter((f) => !fields.has(f.name));
  };

  const parseScope = (scopeStr: string) => {
    if (!scopeStr || scopeStr === 'ALL') return [];
    try {
      const parsed = JSON.parse(scopeStr);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      return scopeStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((nameOrId) => {
          const role = allRoles.find((r) => r.name === nameOrId || r.ID === nameOrId);
          return { roleId: role ? role.ID : nameOrId, fields: [] };
        });
    }
    return [];
  };

  const ScopeSelector = ({ scopeStr, onChange }: { scopeStr: string; onChange: (val: string) => void }) => {
    const scopeList = parseScope(scopeStr);
    const selectedRoleIds = scopeList.map((s: any) => s.roleId);
    const availableRoles = allRoles.filter((r) => !selectedRoleIds.includes(r.ID));
    const handleAddRole = (role: any) => {
      if (!role) return;
      onChange(JSON.stringify([...scopeList, { roleId: role.ID, fields: [] }]));
    };
    const handleRemoveRole = (roleId: string) => {
      const updated = scopeList.filter((s: any) => s.roleId !== roleId);
      onChange(updated.length === 0 ? 'ALL' : JSON.stringify(updated));
    };
    const handleFieldChange = (roleId: string, fields: string[]) => {
      onChange(JSON.stringify(scopeList.map((s: any) => (s.roleId === roleId ? { ...s, fields } : s))));
    };
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: 230 }}>
        <Autocomplete
          size="small"
          options={availableRoles}
          getOptionLabel={(o: any) => o.name || o.ID || ''}
          value={null}
          onChange={(_e, val) => handleAddRole(val)}
          renderInput={(params) => <TextField {...params} placeholder="Add parent role scope..." variant="outlined" />}
        />
        {scopeList.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            All parent roles allowed (add a role above to restrict)
          </Typography>
        )}
        {scopeList.map((item: any) => {
          const roleObj = allRoles.find((r) => r.ID === item.roleId);
          const roleName = roleObj ? roleObj.name : item.roleId;
          const allowedFields = getRoleRestrictionFields(item.roleId);
          return (
            <Card key={item.roleId} variant="outlined" sx={{ p: 1, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>{roleName}</Typography>
                <Tooltip title="Remove role">
                  <IconButton size="small" color="error" onClick={() => handleRemoveRole(item.roleId)} sx={{ p: 0.5 }} aria-label="Remove role">
                    <Trash2 size={12} />
                  </IconButton>
                </Tooltip>
              </Box>
              <Autocomplete
                multiple
                size="small"
                options={allowedFields}
                getOptionLabel={(o: any) => o.name || ''}
                value={allowedFields.filter((f) => (item.fields || []).includes(f.name))}
                onChange={(_e, val) => handleFieldChange(item.roleId, val.map((f: any) => f.name))}
                renderInput={(params) => <TextField {...params} placeholder="Select fields..." variant="outlined" />}
                sx={{ mt: 0.5 }}
              />
            </Card>
          );
        })}
      </Box>
    );
  };

  const AccessDomainCell = ({ auth, roleIds }: { auth: any; roleIds: AppRoleId[] }) => {
    if (!rolesSupportAccessDomainScope(roleIds)) {
      return <Chip label="All Access Domains" size="small" color="primary" variant="outlined" />;
    }
    const accessDomainIds = parseAccessDomains(auth.allowedAccessDomains);
    if (auth.isSuperAdmin || accessDomainIds === null) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
          <Chip label="All Access Domains" size="small" color="primary" variant="outlined" />
          {accessDomains.length > 0 && (
            <Button
              size="small"
              variant="text"
              sx={{ fontSize: '0.7rem', minWidth: 'auto', px: 0.75 }}
              onClick={() => handleUpdateAccessDomains(auth.ID, [accessDomains[0].ID])}
            >
              Restrict
            </Button>
          )}
        </Box>
      );
    }
    const selectedAccessDomainNames = accessDomainIds.map((id) => {
      const s = accessDomains.find((st) => st.ID === id);
      return s ? s.name : id;
    });
    return (
      <Autocomplete
        multiple
        size="small"
        options={accessDomains}
        getOptionLabel={(o: any) => o.name || o.ID}
        value={accessDomains.filter((s) => accessDomainIds.includes(s.ID))}
        onChange={(_e, val) => handleUpdateAccessDomains(auth.ID, val.map((s: any) => s.ID))}
        renderTags={(value, getTagProps) =>
          value.map((option: any, index: number) => {
            const { key, ...tagProps } = getTagProps({ index });
            return <Chip key={key} label={option.name} size="small" {...tagProps} />;
          })
        }
        renderInput={(params) => (
          <TextField
            {...params}
            variant="outlined"
            size="small"
            placeholder={selectedAccessDomainNames.length === 0 ? 'All access domains' : ''}
            sx={{ minWidth: 160 }}
          />
        )}
        sx={{ minWidth: 160 }}
      />
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <AppToast
        open={snackbar.open}
        message={snackbar.message}
        severity={snackbar.severity}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
      />

      {/* Page header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
            Application Access Control
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Assign one or more fixed application roles and data scopes to administrators.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Plus size={16} />}
          onClick={() => {
            resetAddDialogState();
            setOpenAdd(true);
          }}
        >
          Add User
        </Button>
      </Box>

      {/* Open Demo Mode banner */}
      {authorizations.length === 0 && !loading && (
        <Card sx={{ bgcolor: 'rgba(217, 119, 6, 0.05)', border: '1px solid rgba(217, 119, 6, 0.2)' }}>
          <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <AlertTriangle size={24} color="#d97706" />
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'warning.main' }}>Open Demo Mode Active</Typography>
              <Typography variant="caption" color="text.secondary">
                No authorizations defined. All simulated users have full access. Add a user to enable strict role-based access control.
              </Typography>
            </Box>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={30} />
        </Box>
      ) : (
        <Card>
          <SectionHeading
            icon={Shield}
            title="Application Users & Assigned Roles"
            subtitle="Each user can hold one or more Application Roles; permissions combine automatically"
          />
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>User ID</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>User Name</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="center">Active</TableCell>
                  <TableCell sx={{ fontWeight: 700, minWidth: 280 }}>Application Roles</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="center">Derived Role Scope</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="center">Environments</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="center">Access Domains</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {authorizations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                      No user authorizations defined.
                    </TableCell>
                  </TableRow>
                ) : (
                  authorizations.map((auth) => {
                    if (!auth) return null;
                    const assignedRoleIds = getEffectiveRolesForRow(auth);
                    const assignedRoleDefs = assignedRoleIds
                      .map((id) => APP_ROLES_BY_ID[id])
                      .filter(Boolean);
                    const showDerivedScope = rolesSupportDerivedRoleScope(assignedRoleIds);
                    const showEnvScope = rolesSupportEnvironmentScope(assignedRoleIds);

                    return (
                      <TableRow key={auth.ID} hover>
                        <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                          {auth.userId}
                        </TableCell>
                        <TableCell sx={{ fontWeight: 500, whiteSpace: 'nowrap' }}>
                          {auth.userName}
                        </TableCell>
                        <TableCell align="center">
                          <Checkbox
                            size="small"
                            checked={!!auth.isActive}
                            onChange={(e) => handleToggleActive(auth.ID, e.target.checked)}
                            inputProps={{ 'aria-label': `Active status for ${auth.userName || auth.userId}` }}
                          />
                        </TableCell>
                        {/* Multi-select Application Roles */}
                        <TableCell sx={{ minWidth: 280, py: 1 }}>
                          <Autocomplete
                            multiple
                            disableClearable
                            size="small"
                            options={APP_ROLES}
                            getOptionLabel={(option) => option.label}
                            isOptionEqualToValue={(option, value) => option.id === value.id}
                            value={assignedRoleDefs}
                            onChange={(_e, nextDefs) => handleUpdateUserRoles(auth, nextDefs)}
                            renderOption={(props, option) => {
                              const { key, ...restProps } = props as any;
                              return (
                                <li key={key} {...restProps}>
                                  <Box sx={{ display: 'flex', flexDirection: 'column', py: 0.25 }}>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      {option.label}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {option.description}
                                    </Typography>
                                  </Box>
                                </li>
                              );
                            }}
                            renderTags={(value, getTagProps) =>
                              value.map((option, index) => {
                                const { key, ...tagProps } = getTagProps({ index });
                                return (
                                  <Tooltip key={key} title={option.description} arrow>
                                    <Chip
                                      label={option.label}
                                      size="small"
                                      color={option.color}
                                      variant="outlined"
                                      sx={{ fontWeight: 600 }}
                                      {...tagProps}
                                    />
                                  </Tooltip>
                                );
                              })
                            }
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                variant="outlined"
                                size="small"
                                placeholder={assignedRoleDefs.length === 0 ? 'Select roles...' : ''}
                              />
                            )}
                          />
                        </TableCell>
                        {/* Derived Role Scope */}
                        <TableCell align="center">
                          {showDerivedScope ? (
                            <ScopeSelector
                              scopeStr={auth.managedDerivedRolesScope}
                              onChange={(val) => handleUpdateScope(auth.ID, val)}
                            />
                          ) : assignedRoleIds.includes('SUPER_ADMIN') || assignedRoleIds.includes('AUTHORIZATION_ARCHITECT') ? (
                            <Chip label="All Roles" size="small" color="primary" variant="outlined" />
                          ) : (
                            <Typography variant="caption" color="text.secondary">—</Typography>
                          )}
                        </TableCell>
                        {/* Environments */}
                        <TableCell align="center">
                          {!showEnvScope ? (
                            <Chip label="ALL" size="small" color="primary" variant="outlined" />
                          ) : (
                            <EnvironmentSelection
                              multiple={true}
                              value={parseEnvironments(auth.allowedEnvironments)}
                              onChange={(val: string[]) => handleUpdateEnvironments(auth.ID, val)}
                              size="small"
                              sx={{ minWidth: 120 }}
                              fullWidth={false}
                            />
                          )}
                        </TableCell>
                        {/* Access Domains */}
                        <TableCell align="center">
                          <AccessDomainCell auth={auth} roleIds={assignedRoleIds} />
                        </TableCell>
                        {/* Actions */}
                        <TableCell align="right">
                          <Tooltip title="Delete user authorization">
                            <IconButton
                              color="error"
                              size="small"
                              onClick={() => handleDelete(auth.ID, auth.userName || auth.userId)}
                              aria-label="Delete user authorization"
                            >
                              <Trash2 size={15} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      {/* ── Add User Dialog (Multi-Role Selection) ─────────────────────────── */}
      <Dialog
        open={openAdd}
        onClose={() => setOpenAdd(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            backgroundImage: 'none',
            border: '1px solid',
            borderColor: 'divider'
          }
        }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 2 }}>
          Add Application User
        </DialogTitle>
        <DialogContent sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* 1. User Selection */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ flex: 1 }}>
              <UserSelection
                value={selectedScimUser}
                onChange={(_e: any, v: any) => setSelectedScimUser(v)}
              />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
              <Checkbox
                id="new-user-active"
                checked={newUserActive}
                onChange={(e) => setNewUserActive(e.target.checked)}
              />
              <Box component="label" htmlFor="new-user-active" sx={{ cursor: 'pointer' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>Active</Typography>
              </Box>
            </Box>
          </Box>

          <Divider />

          {/* 2. Multi-Select Application Roles */}
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
              Application Roles (select one or more)
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              When multiple roles are selected, the user receives the combined permissions of all selected roles.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {APP_ROLES.map((role) => {
                const selected = newUserRoles.includes(role.id);
                return (
                  <Card
                    key={role.id}
                    variant="outlined"
                    onClick={() => handleToggleDialogRole(role.id)}
                    sx={{
                      p: 1.25,
                      cursor: 'pointer',
                      borderRadius: 1.5,
                      borderColor: selected ? 'primary.main' : 'divider',
                      bgcolor: selected ? 'rgba(37, 99, 235, 0.04)' : 'transparent',
                      transition: 'all 0.15s ease',
                      '&:hover': {
                        borderColor: 'primary.main',
                        bgcolor: 'rgba(37, 99, 235, 0.02)'
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                      <Checkbox
                        size="small"
                        checked={selected}
                        onChange={() => handleToggleDialogRole(role.id)}
                        onClick={(e) => e.stopPropagation()}
                        sx={{ p: 0.25, mt: 0.25 }}
                      />
                      <Box sx={{ flex: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {role.label}
                          </Typography>
                          <Chip
                            label={role.id.replace(/_/g, ' ')}
                            size="small"
                            color={role.color}
                            variant="outlined"
                            sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700 }}
                          />
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.35 }}>
                          {role.description}
                        </Typography>
                      </Box>
                    </Box>
                  </Card>
                );
              })}
            </Box>
          </Box>

          {/* 3. Dynamic Scoping Controls */}
          {(rolesSupportEnvironmentScope(newUserRoles) ||
            rolesSupportAccessDomainScope(newUserRoles) ||
            rolesSupportDerivedRoleScope(newUserRoles)) && (
            <>
              <Divider />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Scope & Boundaries
                </Typography>

                {/* Derived Role Scope */}
                {rolesSupportDerivedRoleScope(newUserRoles) && (
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
                      Permitted Parent Roles for Derivation
                    </Typography>
                    <ScopeSelector
                      scopeStr={newUserDerivedScope}
                      onChange={(val) => setNewUserDerivedScope(val)}
                    />
                  </Box>
                )}

                {/* Allowed Environments */}
                {rolesSupportEnvironmentScope(newUserRoles) && (
                  <Box>
                    <EnvironmentSelection
                      multiple={true}
                      value={newUserEnvironments}
                      onChange={(val: string[]) => setNewUserEnvironments(val)}
                      size="small"
                      label="Allowed Environments"
                      fullWidth
                    />
                  </Box>
                )}

                {/* Allowed Access Domains */}
                {rolesSupportAccessDomainScope(newUserRoles) && (
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
                      Allowed Access Domains
                    </Typography>
                    {newUserAccessDomains === null ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip label="All Access Domains" size="small" color="primary" variant="outlined" />
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => setNewUserAccessDomains([])}
                        >
                          Restrict
                        </Button>
                      </Box>
                    ) : (
                      <>
                        <Autocomplete
                          multiple
                          size="small"
                          options={accessDomains}
                          getOptionLabel={(o: any) => o.name || o.ID}
                          value={accessDomains.filter((s) => (newUserAccessDomains || []).includes(s.ID))}
                          onChange={(_e, val) => setNewUserAccessDomains(val.map((s: any) => s.ID))}
                          renderTags={(value, getTagProps) =>
                            value.map((option: any, index: number) => {
                              const { key, ...tagProps } = getTagProps({ index });
                              return <Chip key={key} label={option.name} size="small" {...tagProps} />;
                            })
                          }
                          renderInput={(params) => (
                            <TextField {...params} placeholder="Select access domains..." variant="outlined" />
                          )}
                        />
                        {newUserAccessDomains.length === 0 && (
                          <Button
                            size="small"
                            variant="text"
                            sx={{ mt: 0.5 }}
                            onClick={() => setNewUserAccessDomains(null)}
                          >
                            ← Grant all access domains
                          </Button>
                        )}
                      </>
                    )}
                  </Box>
                )}
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid', borderColor: 'divider', px: 3, py: 2 }}>
          <Button onClick={() => setOpenAdd(false)} color="inherit">
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleAddAuthorization}
            disabled={!selectedScimUser || newUserRoles.length === 0}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Confirm Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog((p) => ({ ...p, open: false }))}>
        <DialogTitle>{confirmDialog.title}</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirmDialog.message}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog((p) => ({ ...p, open: false }))} color="inherit">
            Cancel
          </Button>
          <Button onClick={confirmDialog.onConfirm || undefined} color="primary" variant="contained" autoFocus>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
