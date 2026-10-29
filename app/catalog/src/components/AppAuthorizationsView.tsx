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
import { Plus, Pencil, Trash2, Shield, AlertTriangle } from 'lucide-react';
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

  // Unified Add / Edit Dialog State (`editingAuth === null` means Add mode; non-null means Edit mode)
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAuth, setEditingAuth] = useState<any | null>(null);
  const [selectedScimUser, setSelectedScimUser] = useState<any>(null);
  const [dialogRoles, setDialogRoles] = useState<AppRoleId[]>(['AUTHORIZATION_ARCHITECT']);
  const [dialogActive, setDialogActive] = useState<boolean>(true);
  const [dialogEnvironments, setDialogEnvironments] = useState<string[]>(['D', 'Q', 'P']);
  const [dialogAccessDomains, setDialogAccessDomains] = useState<string[] | null>(null); // null = ALL
  const [dialogDerivedScope, setDialogDerivedScope] = useState<string>('ALL');

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

  // ─── Dialog Openers (Add vs Edit) ───────────────────────────────────────────
  const handleOpenAddDialog = () => {
    setEditingAuth(null);
    setSelectedScimUser(null);
    setDialogRoles(['AUTHORIZATION_ARCHITECT']);
    setDialogActive(true);
    setDialogEnvironments(['D', 'Q', 'P']);
    setDialogAccessDomains(null);
    setDialogDerivedScope('ALL');
    setDialogOpen(true);
  };

  const handleOpenEditDialog = (auth: any) => {
    const currentRoles = getEffectiveRolesForRow(auth);
    setEditingAuth(auth);
    setSelectedScimUser({
      username: auth.userId,
      displayName: auth.userName || auth.userId,
    });
    setDialogRoles([...currentRoles]);
    setDialogActive(!!auth.isActive);
    setDialogEnvironments(parseEnvironments(auth.allowedEnvironments));
    setDialogAccessDomains(parseAccessDomains(auth.allowedAccessDomains));
    setDialogDerivedScope(auth.managedDerivedRolesScope || 'ALL');
    setDialogOpen(true);
  };

  const handleToggleDialogRole = (roleId: AppRoleId) => {
    setDialogRoles((prev) => {
      const exists = prev.includes(roleId);
      const nextRaw = exists ? prev.filter((r) => r !== roleId) : [...prev, roleId];
      return normalizeSelectedRoles(prev, nextRaw);
    });
  };

  // ─── Save (Create or Update via the same Dialog) ────────────────────────────
  const handleSaveAuthorization = async () => {
    if (!editingAuth && !selectedScimUser) {
      setSnackbar({ open: true, message: 'Please select a user from SCIM', severity: 'error' });
      return;
    }
    if (dialogRoles.length === 0) {
      setSnackbar({ open: true, message: 'Please select at least one application role', severity: 'error' });
      return;
    }

    const flags = rolesToFlags(dialogRoles);
    const hasEnvScope = rolesSupportEnvironmentScope(dialogRoles);
    const hasDomainScope = rolesSupportAccessDomainScope(dialogRoles);
    const hasDerivedScope = rolesSupportDerivedRoleScope(dialogRoles);

    const allowedEnvironments = !hasEnvScope
      ? 'ALL'
      : serializeEnvironments(dialogEnvironments);

    const allowedAccessDomains = !hasDomainScope
      ? 'ALL'
      : dialogAccessDomains === null
        ? 'ALL'
        : serializeAccessDomains(dialogAccessDomains, accessDomains);

    const managedDerivedRolesScope = hasDerivedScope
      ? (dialogDerivedScope || 'ALL')
      : 'ALL';

    const payload = {
      ...flags,
      managedDerivedRolesScope,
      allowedEnvironments,
      allowedAccessDomains,
      isActive: dialogActive,
    };

    if (editingAuth) {
      try {
        await api.updateAppAuthorization(editingAuth.ID, payload);
        setUserRoleOverrides((prev) => ({ ...prev, [editingAuth.ID]: [...dialogRoles] }));
        setAuthorizations((prev) =>
          prev.map((item) => (item.ID === editingAuth.ID ? { ...item, ...payload } : item))
        );
        setDialogOpen(false);
        setEditingAuth(null);
        setSnackbar({ open: true, message: 'User authorization updated', severity: 'success' });
      } catch (err: any) {
        setSnackbar({ open: true, message: err.message || 'Failed to update authorization', severity: 'error' });
      }
      return;
    }

    const exists = authorizations.some(
      (a) => a.userId.toLowerCase() === selectedScimUser.username.toLowerCase()
    );
    if (exists) {
      setSnackbar({ open: true, message: `User "${selectedScimUser.displayName}" is already configured`, severity: 'error' });
      return;
    }

    try {
      const newAuth = await api.createAppAuthorization({
        userId: selectedScimUser.username,
        userName: selectedScimUser.displayName,
        ...payload,
      });
      if (newAuth) {
        setAuthorizations((prev) => [...prev, newAuth].filter(Boolean));
        if (newAuth.ID) {
          setUserRoleOverrides((prev) => ({ ...prev, [newAuth.ID]: [...dialogRoles] }));
        }
      } else {
        await loadData();
      }
      setDialogOpen(false);
      setSnackbar({ open: true, message: 'User authorization added', severity: 'success' });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'Failed to add authorization', severity: 'error' });
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      await api.updateAppAuthorization(id, { isActive });
      setAuthorizations((prev) => prev.map((item) => (item.ID === id ? { ...item, isActive } : item)));
      setSnackbar({ open: true, message: `User ${isActive ? 'activated' : 'deactivated'}`, severity: 'success' });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'Update failed', severity: 'error' });
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

  // ─── Scope Helpers & Sub-components ─────────────────────────────────────────
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
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%' }}>
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
          onClick={handleOpenAddDialog}
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
            subtitle="Each user can hold one or more Application Roles; click Edit to modify roles and scopes"
          />
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>User ID</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>User Name</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="center">Active</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Application Roles</TableCell>
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
                    const showDomainScope = rolesSupportAccessDomainScope(assignedRoleIds);
                    const scopeItems = parseScope(auth.managedDerivedRolesScope);
                    const envList = parseEnvironments(auth.allowedEnvironments);
                    const domainIds = parseAccessDomains(auth.allowedAccessDomains);

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
                        {/* Read-only Role Chips (clicking opens the unified Add/Edit dialog) */}
                        <TableCell sx={{ py: 1 }}>
                          <Box
                            onClick={() => handleOpenEditDialog(auth)}
                            sx={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 0.75,
                              cursor: 'pointer',
                              alignItems: 'center'
                            }}
                          >
                            {assignedRoleDefs.map((roleDef) => (
                              <Tooltip key={roleDef.id} title={roleDef.description} arrow>
                                <Chip
                                  label={roleDef.label}
                                  size="small"
                                  color={roleDef.color}
                                  variant="outlined"
                                  sx={{ fontWeight: 600, cursor: 'pointer' }}
                                />
                              </Tooltip>
                            ))}
                          </Box>
                        </TableCell>
                        {/* Derived Role Scope Summary */}
                        <TableCell align="center">
                          {showDerivedScope ? (
                            scopeItems.length === 0 ? (
                              <Chip label="All Parent Roles" size="small" color="secondary" variant="outlined" />
                            ) : (
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 0.5 }}>
                                {scopeItems.map((s: any) => {
                                  const rObj = allRoles.find((r) => r.ID === s.roleId);
                                  return (
                                    <Chip
                                      key={s.roleId}
                                      label={rObj ? rObj.name : s.roleId}
                                      size="small"
                                      variant="outlined"
                                    />
                                  );
                                })}
                              </Box>
                            )
                          ) : assignedRoleIds.includes('SUPER_ADMIN') || assignedRoleIds.includes('AUTHORIZATION_ARCHITECT') ? (
                            <Chip label="All Roles" size="small" color="primary" variant="outlined" />
                          ) : (
                            <Typography variant="caption" color="text.secondary">—</Typography>
                          )}
                        </TableCell>
                        {/* Environments Summary */}
                        <TableCell align="center">
                          {!showEnvScope || auth.allowedEnvironments === 'ALL' || envList.length === 3 ? (
                            <Chip label="ALL" size="small" color="primary" variant="outlined" />
                          ) : envList.length === 0 ? (
                            <Typography variant="caption" color="text.secondary">None</Typography>
                          ) : (
                            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5 }}>
                              {envList.map((env) => (
                                <Chip key={env} label={env} size="small" variant="outlined" sx={{ fontWeight: 600 }} />
                              ))}
                            </Box>
                          )}
                        </TableCell>
                        {/* Access Domains Summary */}
                        <TableCell align="center">
                          {!showDomainScope || auth.isSuperAdmin || domainIds === null ? (
                            <Chip label="All Access Domains" size="small" color="primary" variant="outlined" />
                          ) : domainIds.length === 0 ? (
                            <Typography variant="caption" color="text.secondary">None</Typography>
                          ) : (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 0.5 }}>
                              {domainIds.map((id) => {
                                const dom = accessDomains.find((d) => d.ID === id);
                                return (
                                  <Chip
                                    key={id}
                                    label={dom ? dom.name : id}
                                    size="small"
                                    variant="outlined"
                                  />
                                );
                              })}
                            </Box>
                          )}
                        </TableCell>
                        {/* Actions: Edit (opens unified dialog) + Delete */}
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          <Tooltip title="Edit roles & scopes">
                            <IconButton
                              color="primary"
                              size="small"
                              onClick={() => handleOpenEditDialog(auth)}
                              aria-label="Edit user authorization"
                              sx={{ mr: 0.5 }}
                            >
                              <Pencil size={15} />
                            </IconButton>
                          </Tooltip>
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

      {/* ── Unified Add / Edit Application User Dialog ─────────────────────── */}
      <Dialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditingAuth(null);
        }}
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
          {editingAuth
            ? `Edit Application User — ${editingAuth.userName || editingAuth.userId}`
            : 'Add Application User'}
        </DialogTitle>
        <DialogContent sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* 1. User Selection (or read-only User Identity when editing) */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ flex: 1 }}>
              {editingAuth ? (
                <TextField
                  label="User"
                  value={`${editingAuth.userName || editingAuth.userId} (${editingAuth.userId})`}
                  size="small"
                  fullWidth
                  disabled
                />
              ) : (
                <UserSelection
                  value={selectedScimUser}
                  onChange={(_e: any, v: any) => setSelectedScimUser(v)}
                />
              )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', mt: editingAuth ? 0 : 1 }}>
              <Checkbox
                id="dialog-user-active"
                checked={dialogActive}
                onChange={(e) => setDialogActive(e.target.checked)}
              />
              <Box component="label" htmlFor="dialog-user-active" sx={{ cursor: 'pointer' }}>
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
                const selected = dialogRoles.includes(role.id);
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
          {(rolesSupportEnvironmentScope(dialogRoles) ||
            rolesSupportAccessDomainScope(dialogRoles) ||
            rolesSupportDerivedRoleScope(dialogRoles)) && (
            <>
              <Divider />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Scope & Boundaries
                </Typography>

                {/* Derived Role Scope */}
                {rolesSupportDerivedRoleScope(dialogRoles) && (
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
                      Permitted Parent Roles for Derivation
                    </Typography>
                    <ScopeSelector
                      scopeStr={dialogDerivedScope}
                      onChange={(val) => setDialogDerivedScope(val)}
                    />
                  </Box>
                )}

                {/* Allowed Environments */}
                {rolesSupportEnvironmentScope(dialogRoles) && (
                  <Box>
                    <EnvironmentSelection
                      multiple={true}
                      value={dialogEnvironments}
                      onChange={(val: string[]) => setDialogEnvironments(val)}
                      size="small"
                      label="Allowed Environments"
                      fullWidth
                    />
                  </Box>
                )}

                {/* Allowed Access Domains */}
                {rolesSupportAccessDomainScope(dialogRoles) && (
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
                      Allowed Access Domains
                    </Typography>
                    {dialogAccessDomains === null ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip label="All Access Domains" size="small" color="primary" variant="outlined" />
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => setDialogAccessDomains([])}
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
                          value={accessDomains.filter((s) => (dialogAccessDomains || []).includes(s.ID))}
                          onChange={(_e, val) => setDialogAccessDomains(val.map((s: any) => s.ID))}
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
                        {dialogAccessDomains.length === 0 && (
                          <Button
                            size="small"
                            variant="text"
                            sx={{ mt: 0.5 }}
                            onClick={() => setDialogAccessDomains(null)}
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
          <Button
            onClick={() => {
              setDialogOpen(false);
              setEditingAuth(null);
            }}
            color="inherit"
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveAuthorization}
            disabled={(!editingAuth && !selectedScimUser) || dialogRoles.length === 0}
          >
            {editingAuth ? 'Save Changes' : 'Add'}
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
