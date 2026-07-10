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
  Alert,
  Snackbar,
  Select,
  MenuItem,
  OutlinedInput,
  Chip
} from '@mui/material';
import { Plus, Trash2, Shield, Users, AlertTriangle } from 'lucide-react';
import * as api from '../api';

const parseEnvironments = (val) => {
  if (!val || val === 'ALL' || val === '*') return ['D', 'Q', 'P'];
  try {
    const parsed = JSON.parse(val);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    return val.split(',').map(s => s.trim().toUpperCase());
  }
  return [];
};

const serializeEnvironments = (arr) => {
  if (!arr || arr.length === 0) return '[]';
  if (arr.length === 3) return 'ALL';
  return JSON.stringify(arr);
};

export default function AppAuthorizationsView() {
  const [authorizations, setAuthorizations] = useState([]);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: 'Confirm', message: '', onConfirm: null });
  const [allRoles, setAllRoles] = useState([]);
  const [restrictionFields, setRestrictionFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ldapOptions, setLdapOptions] = useState([]);
  const [ldapLoading, setLdapLoading] = useState(false);
  const [ldapInput, setLdapInput] = useState('');
  
  // Dialog state
  const [openAdd, setOpenAdd] = useState(false);
  const [selectedLdapUser, setSelectedLdapUser] = useState(null);
  const [newPermissions, setNewPermissions] = useState({
    isSuperAdmin: false,
    canManageAppUsers: false,
    canManageOrgRoles: true,
    canManageSingleRoles: true,
    canManageDerivedRoles: true,
    managedDerivedRolesScope: 'ALL',
    canAssignRoles: true,
    canManageReplications: false,
    canViewAuditLogs: true,
    canManageSettings: false,
    allowedEnvironments: ['D', 'Q', 'P'],
    isActive: true
  });
  
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const loadData = async () => {
    setLoading(true);
    try {
      const [authData, rolesData, fieldsData] = await Promise.all([
        api.getAppAuthorizations(),
        api.getRoles(),
        api.getRestrictionFields()
      ]);
      setAuthorizations((authData || []).filter(Boolean));
      setAllRoles(rolesData || []);
      setRestrictionFields(fieldsData || []);
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Failed to load authorizations', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Debounced LDAP search
  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      if (!ldapInput.trim()) return;
      setLdapLoading(true);
      api.searchLdapUsers(ldapInput)
        .then(res => {
          setLdapOptions(res || []);
          setLdapLoading(false);
        })
        .catch(err => {
          console.error(err);
          setLdapLoading(false);
        });
    }, 250);
    return () => clearTimeout(delayDebounce);
  }, [ldapInput]);

  const handleTogglePermission = async (id, field, value) => {
    try {
      await api.updateAppAuthorization(id, { [field]: value });
      setAuthorizations(prev => prev.map(item => item.ID === id ? { ...item, [field]: value } : item));
      setSnackbar({ open: true, message: 'Authorization updated successfully', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Update failed', severity: 'error' });
    }
  };

  const handleUpdateEnvironments = async (id, valueArr) => {
    const serialized = serializeEnvironments(valueArr);
    try {
      await api.updateAppAuthorization(id, { allowedEnvironments: serialized });
      setAuthorizations(prev => prev.map(item => item.ID === id ? { ...item, allowedEnvironments: serialized } : item));
      setSnackbar({ open: true, message: 'Environments scope updated successfully', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Update failed', severity: 'error' });
    }
  };

  const handleUpdateScope = async (id, value) => {
    try {
      await api.updateAppAuthorization(id, { managedDerivedRolesScope: value });
      setAuthorizations(prev => prev.map(item => item.ID === id ? { ...item, managedDerivedRolesScope: value } : item));
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Update failed', severity: 'error' });
    }
  };

  const getRoleRestrictionFields = (roleId) => {
    const roleObj = allRoles.find(r => r.ID === roleId);
    if (!roleObj) return [];
    const own = roleObj.ownRestrictions ? roleObj.ownRestrictions.map(r => r.field) : [];
    const fields = new Set(own);
    const queue = roleObj.parentRoles ? roleObj.parentRoles.map(pr => pr.parent?.ID || pr.parent_ID).filter(Boolean) : [];
    const visited = new Set(queue);
    while (queue.length > 0) {
      const currId = queue.shift();
      const currRole = allRoles.find(r => r.ID === currId);
      if (currRole) {
        if (currRole.ownRestrictions) {
          currRole.ownRestrictions.forEach(r => fields.add(r.field));
        }
        if (currRole.parentRoles) {
          currRole.parentRoles.forEach(pr => {
            const pid = pr.parent?.ID || pr.parent_ID;
            if (pid && !visited.has(pid)) {
              visited.add(pid);
              queue.push(pid);
            }
          });
        }
      }
    }
    return restrictionFields.filter(f => !fields.has(f.name));
  };

  const parseScope = (scopeStr) => {
    if (!scopeStr || scopeStr === 'ALL') return [];
    try {
      const parsed = JSON.parse(scopeStr);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      const rolesList = scopeStr.split(',').map(s => s.trim()).filter(Boolean);
      return rolesList.map(roleNameOrId => {
        const role = allRoles.find(r => r.name === roleNameOrId || r.ID === roleNameOrId);
        return { roleId: role ? role.ID : roleNameOrId, fields: [] };
      });
    }
    return [];
  };

  const ScopeSelector = ({ scopeStr, onChange }) => {
    const scopeList = parseScope(scopeStr);
    const selectedRoleIds = scopeList.map(s => s.roleId);
    const availableRoles = allRoles.filter(r => !selectedRoleIds.includes(r.ID));

    const handleAddRole = (role) => {
      if (!role) return;
      const updated = [...scopeList, { roleId: role.ID, fields: [] }];
      onChange(JSON.stringify(updated));
    };

    const handleRemoveRole = (roleId) => {
      const updated = scopeList.filter(s => s.roleId !== roleId);
      onChange(updated.length === 0 ? 'ALL' : JSON.stringify(updated));
    };

    const handleFieldChange = (roleId, fields) => {
      const updated = scopeList.map(s => s.roleId === roleId ? { ...s, fields } : s);
      onChange(JSON.stringify(updated));
    };

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, width: 240, mt: 1 }}>
        <Autocomplete
          size="small"
          options={availableRoles}
          getOptionLabel={(option) => option.name || option.ID || ''}
          value={null}
          onChange={(e, val) => handleAddRole(val)}
          renderInput={(params) => (
            <TextField {...params} placeholder="Add Role..." variant="outlined" />
          )}
        />
        {scopeList.map(item => {
          const roleObj = allRoles.find(r => r.ID === item.roleId);
          const roleName = roleObj ? roleObj.name : item.roleId;
          const allowedFields = getRoleRestrictionFields(item.roleId);

          return (
            <Card key={item.roleId} variant="outlined" sx={{ p: 1, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>{roleName}</Typography>
                <IconButton size="small" color="error" onClick={() => handleRemoveRole(item.roleId)} sx={{ p: 0.5 }}>
                  <Trash2 size={12} />
                </IconButton>
              </Box>
              <Autocomplete
                multiple
                size="small"
                options={allowedFields}
                getOptionLabel={(option) => option.name || ''}
                value={allowedFields.filter(f => item.fields.includes(f.name))}
                onChange={(e, val) => handleFieldChange(item.roleId, val.map(f => f.name))}
                renderInput={(params) => (
                  <TextField {...params} placeholder="Select fields..." variant="outlined" />
                )}
                sx={{ mt: 0.5 }}
              />
            </Card>
          );
        })}
      </Box>
    );
  };

  const handleAddAuthorization = async () => {
    if (!selectedLdapUser) {
      setSnackbar({ open: true, message: 'Please select a user from LDAP', severity: 'error' });
      return;
    }

    const exists = authorizations.some(a => a.userId.toLowerCase() === selectedLdapUser.username.toLowerCase());
    if (exists) {
      setSnackbar({ open: true, message: `User "${selectedLdapUser.displayName}" is already configured`, severity: 'error' });
      return;
    }

    try {
      const newAuth = await api.createAppAuthorization({
        userId: selectedLdapUser.username,
        userName: selectedLdapUser.displayName,
        isSuperAdmin: newPermissions.isSuperAdmin,
        canManageAppUsers: newPermissions.canManageAppUsers,
        canManageOrgRoles: newPermissions.canManageOrgRoles,
        canManageSingleRoles: newPermissions.canManageSingleRoles,
        canManageDerivedRoles: newPermissions.canManageDerivedRoles,
        managedDerivedRolesScope: newPermissions.managedDerivedRolesScope || 'ALL',
        canAssignRoles: newPermissions.canAssignRoles,
        canManageReplications: newPermissions.canManageReplications,
        canViewAuditLogs: newPermissions.canViewAuditLogs,
        canManageSettings: newPermissions.canManageSettings,
        allowedEnvironments: serializeEnvironments(newPermissions.allowedEnvironments),
        isActive: newPermissions.isActive
      });
      if (newAuth) {
        setAuthorizations(prev => [...prev, newAuth].filter(Boolean));
      } else {
        await loadData();
      }
      setOpenAdd(false);
      setSelectedLdapUser(null);
      setNewPermissions({
        isSuperAdmin: false,
        canManageAppUsers: false,
        canManageOrgRoles: true,
        canManageSingleRoles: true,
        canManageDerivedRoles: true,
        managedDerivedRolesScope: 'ALL',
        canAssignRoles: true,
        canManageReplications: false,
        canViewAuditLogs: true,
        canManageSettings: false,
        allowedEnvironments: ['D', 'Q', 'P'],
        isActive: true
      });
      setSnackbar({ open: true, message: 'User authorization added successfully', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Failed to add authorization', severity: 'error' });
    }
  };

  const handleDelete = (id, name) => {
    setConfirmDialog({
      open: true,
      title: 'Remove Authorizations',
      message: `Remove application authorizations for user "${name}"?`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await api.deleteAppAuthorization(id);
          setAuthorizations(prev => prev.filter(item => item.ID !== id));
          setSnackbar({ open: true, message: 'Authorization removed successfully', severity: 'success' });
        } catch (err) {
          setSnackbar({ open: true, message: err.message || 'Deletion failed', severity: 'error' });
        }
      }
    });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
            Application Access Control
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage roles/features permission levels for administrators within the Auth Wizard itself.
          </Typography>
        </Box>
        <Button 
          variant="contained" 
          startIcon={<Plus size={16} />}
          onClick={() => setOpenAdd(true)}
        >
          Add User Authorization
        </Button>
      </Box>

      {authorizations.length === 0 && !loading && (
        <Card sx={{ bgcolor: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
          <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <AlertTriangle size={24} color="#f59e0b" />
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, color: '#f59e0b' }}>
                Open Demo Mode Active
              </Typography>
              <Typography variant="caption" color="text.secondary">
                No user authorizations are explicitly defined yet. All logged-in simulation users have full administrator access. Add a user below to enable strict role-based access control.
              </Typography>
            </Box>
          </CardContent>
        </Card>
      )}

      <Card>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={30} />
          </Box>
        ) : (
          <TableContainer>
             <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell style={{ fontWeight: 600 }}>User ID</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>User Name</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="center">Active</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="center">Super Admin</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="center">Manage Users</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="center">Manage Org Roles</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="center">Manage Single Roles</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="center">Manage Derived Roles</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="center">Assign Roles</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="center">Manage Replications</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="center">Manage Settings</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="center">View Audit Logs</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="center">Environments</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {authorizations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                      No administrator authorization definitions set.
                    </TableCell>
                  </TableRow>
                ) : (
                  authorizations.map(auth => {
                    if (!auth) return null;
                    return (
                      <TableRow key={auth.ID} hover>
                        <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{auth.userId}</TableCell>
                      <TableCell sx={{ fontWeight: 500 }}>{auth.userName}</TableCell>
                      <TableCell align="center">
                        <Checkbox 
                          checked={auth.isActive}
                          onChange={(e) => handleTogglePermission(auth.ID, 'isActive', e.target.checked)}
                          sx={{ '&.Mui-checked': { color: '#ef4444' } }}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Checkbox 
                          checked={auth.isSuperAdmin}
                          onChange={(e) => handleTogglePermission(auth.ID, 'isSuperAdmin', e.target.checked)}
                          sx={{ '&.Mui-checked': { color: '#f43f5e' } }}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Checkbox 
                          checked={auth.canManageAppUsers}
                          onChange={(e) => handleTogglePermission(auth.ID, 'canManageAppUsers', e.target.checked)}
                          disabled={auth.isSuperAdmin}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Checkbox 
                          checked={auth.canManageOrgRoles}
                          onChange={(e) => handleTogglePermission(auth.ID, 'canManageOrgRoles', e.target.checked)}
                          sx={{ '&.Mui-checked': { color: '#3b82f6' } }}
                          disabled={auth.isSuperAdmin}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Checkbox 
                          checked={auth.canManageSingleRoles}
                          onChange={(e) => handleTogglePermission(auth.ID, 'canManageSingleRoles', e.target.checked)}
                          sx={{ '&.Mui-checked': { color: '#a78bfa' } }}
                          disabled={auth.isSuperAdmin}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                          <Checkbox 
                            checked={auth.canManageDerivedRoles}
                            onChange={(e) => handleTogglePermission(auth.ID, 'canManageDerivedRoles', e.target.checked)}
                            sx={{ '&.Mui-checked': { color: '#f59e0b' } }}
                            disabled={auth.isSuperAdmin}
                          />
                          {!auth.isSuperAdmin && auth.canManageDerivedRoles && (
                            <ScopeSelector
                              scopeStr={auth.managedDerivedRolesScope}
                              onChange={(val) => handleUpdateScope(auth.ID, val)}
                            />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell align="center">
                        <Checkbox 
                          checked={auth.canAssignRoles}
                          onChange={(e) => handleTogglePermission(auth.ID, 'canAssignRoles', e.target.checked)}
                          sx={{ '&.Mui-checked': { color: '#10b981' } }}
                          disabled={auth.isSuperAdmin}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Checkbox 
                          checked={auth.canManageReplications}
                          onChange={(e) => handleTogglePermission(auth.ID, 'canManageReplications', e.target.checked)}
                          sx={{ '&.Mui-checked': { color: '#0ea5e9' } }}
                          disabled={auth.isSuperAdmin}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Checkbox 
                          checked={auth.canManageSettings}
                          onChange={(e) => handleTogglePermission(auth.ID, 'canManageSettings', e.target.checked)}
                          disabled={auth.isSuperAdmin}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Checkbox 
                          checked={auth.canViewAuditLogs}
                          onChange={(e) => handleTogglePermission(auth.ID, 'canViewAuditLogs', e.target.checked)}
                          disabled={auth.isSuperAdmin}
                        />
                      </TableCell>
                      <TableCell align="center">
                        {auth.isSuperAdmin ? (
                          <Chip label="ALL" size="small" color="primary" variant="outlined" />
                        ) : (
                          <Select
                            multiple
                            value={parseEnvironments(auth.allowedEnvironments)}
                            onChange={(e) => handleUpdateEnvironments(auth.ID, e.target.value)}
                            input={<OutlinedInput size="small" style={{ width: 80, fontSize: '0.75rem' }} />}
                            renderValue={(selected) => (
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.2 }}>
                                {selected.map((value) => (
                                  <Typography key={value} style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{value}</Typography>
                                ))}
                              </Box>
                            )}
                          >
                            <MenuItem value="D">D (Dev)</MenuItem>
                            <MenuItem value="Q">Q (QA)</MenuItem>
                            <MenuItem value="P">P (Prod)</MenuItem>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton 
                          color="error"
                          onClick={() => handleDelete(auth.ID, auth.userName || auth.userId)}
                          size="small"
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      {/* Add User Dialog */}
      <Dialog 
        open={openAdd} 
        onClose={() => setOpenAdd(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            backgroundImage: 'none',
            border: '1px solid',
            borderColor: 'divider',
          }
        }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 2 }}>
          Add User Authorization
        </DialogTitle>
        <DialogContent sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Autocomplete
            value={selectedLdapUser}
            onChange={(event, newValue) => {
              setSelectedLdapUser(newValue);
            }}
            inputValue={ldapInput}
            onInputChange={(event, newInputValue) => {
              setLdapInput(newInputValue);
            }}
            options={ldapOptions}
            loading={ldapLoading}
            getOptionLabel={(option) => `${option.displayName} (${option.username})`}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Search User (LDAP)"
                size="small"
                placeholder="Type username or name..."
                InputProps={{
                  ...(params.InputProps || {}),
                  endAdornment: (
                    <>
                      {ldapLoading ? <CircularProgress color="inherit" size={20} /> : null}
                      {params.InputProps?.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderOption={(props, option) => {
              const { key, ...optionProps } = props;
              return (
                <li key={key || option.username} {...optionProps}>
                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{option.displayName} ({option.username})</Typography>
                    <Typography variant="caption" color="text.secondary">{option.department}</Typography>
                  </Box>
                </li>
              );
            }}
            fullWidth
          />

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>Permissions</Typography>
            
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Checkbox 
                checked={newPermissions.isActive}
                onChange={(e) => setNewPermissions(prev => ({ ...prev, isActive: e.target.checked }))}
                id="perm-active"
              />
              <Box component="label" htmlFor="perm-active" sx={{ cursor: 'pointer' }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>Active User Account</Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
              <Checkbox 
                checked={newPermissions.isSuperAdmin}
                onChange={(e) => setNewPermissions(prev => ({ ...prev, isSuperAdmin: e.target.checked }))}
                id="perm-superadmin"
              />
              <Box component="label" htmlFor="perm-superadmin" sx={{ cursor: 'pointer' }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>Super Administrator</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Unrestricted master control bypass</Typography>
              </Box>
            </Box>

            {!newPermissions.isSuperAdmin && (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                  <Checkbox 
                    checked={newPermissions.canManageAppUsers}
                    onChange={(e) => setNewPermissions(prev => ({ ...prev, canManageAppUsers: e.target.checked }))}
                    id="perm-app-users"
                  />
                  <Box component="label" htmlFor="perm-app-users" sx={{ cursor: 'pointer' }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>Manage Application Users</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Edit permissions of other admin users</Typography>
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                  <Checkbox 
                    checked={newPermissions.canManageOrgRoles}
                    onChange={(e) => setNewPermissions(prev => ({ ...prev, canManageOrgRoles: e.target.checked }))}
                    id="perm-org-roles"
                  />
                  <Box component="label" htmlFor="perm-org-roles" sx={{ cursor: 'pointer' }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>Manage Org-Based Roles</Typography>
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                  <Checkbox 
                    checked={newPermissions.canManageSingleRoles}
                    onChange={(e) => setNewPermissions(prev => ({ ...prev, canManageSingleRoles: e.target.checked }))}
                    id="perm-single-roles"
                  />
                  <Box component="label" htmlFor="perm-single-roles" sx={{ cursor: 'pointer' }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>Manage Single Roles</Typography>
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Checkbox 
                      checked={newPermissions.canManageDerivedRoles}
                      onChange={(e) => setNewPermissions(prev => ({ ...prev, canManageDerivedRoles: e.target.checked }))}
                      id="perm-derived-roles"
                    />
                    <Box component="label" htmlFor="perm-derived-roles" sx={{ cursor: 'pointer' }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>Manage Derived Roles</Typography>
                    </Box>
                  </Box>
                  {newPermissions.canManageDerivedRoles && (
                    <Box sx={{ ml: 4, mt: 0.5 }}>
                      <ScopeSelector
                        scopeStr={newPermissions.managedDerivedRolesScope}
                        onChange={(val) => setNewPermissions(prev => ({ ...prev, managedDerivedRolesScope: val }))}
                      />
                    </Box>
                  )}
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                  <Checkbox 
                    checked={newPermissions.canAssignRoles}
                    onChange={(e) => setNewPermissions(prev => ({ ...prev, canAssignRoles: e.target.checked }))}
                    id="perm-assign"
                  />
                  <Box component="label" htmlFor="perm-assign" sx={{ cursor: 'pointer' }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>Assign Roles</Typography>
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                  <Checkbox 
                    checked={newPermissions.canManageReplications}
                    onChange={(e) => setNewPermissions(prev => ({ ...prev, canManageReplications: e.target.checked }))}
                    id="perm-replications"
                  />
                  <Box component="label" htmlFor="perm-replications" sx={{ cursor: 'pointer' }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>Manage Replications</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Trigger and monitor Datasphere replication runs</Typography>
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                  <Checkbox 
                    checked={newPermissions.canManageSettings}
                    onChange={(e) => setNewPermissions(prev => ({ ...prev, canManageSettings: e.target.checked }))}
                    id="perm-settings"
                  />
                  <Box component="label" htmlFor="perm-settings" sx={{ cursor: 'pointer' }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>Manage Settings</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Configure BDC, Contexts, and Fields</Typography>
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                  <Checkbox 
                    checked={newPermissions.canViewAuditLogs}
                    onChange={(e) => setNewPermissions(prev => ({ ...prev, canViewAuditLogs: e.target.checked }))}
                    id="perm-audit"
                  />
                  <Box component="label" htmlFor="perm-audit" sx={{ cursor: 'pointer' }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>View System Audit Logs</Typography>
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Allowed Environments</Typography>
                  <Select
                    multiple
                    value={newPermissions.allowedEnvironments}
                    onChange={(e) => setNewPermissions(prev => ({ ...prev, allowedEnvironments: e.target.value }))}
                    input={<OutlinedInput size="small" />}
                    renderValue={(selected) => (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {selected.map((value) => (
                          <Chip key={value} label={value} size="small" />
                        ))}
                      </Box>
                    )}
                  >
                    <MenuItem value="D">D (Dev)</MenuItem>
                    <MenuItem value="Q">Q (QA)</MenuItem>
                    <MenuItem value="P">P (Prod)</MenuItem>
                  </Select>
                </Box>
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid', borderColor: 'divider', px: 3, py: 2 }}>
          <Button onClick={() => setOpenAdd(false)} color="inherit">Cancel</Button>
          <Button variant="contained" onClick={handleAddAuthorization} disabled={!selectedLdapUser}>Add</Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Dialog */}
      <Dialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog(prev => ({ ...prev, open: false }))}
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
      >
        <DialogTitle id="confirm-dialog-title">
          {confirmDialog.title}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="confirm-dialog-description">
            {confirmDialog.message}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(prev => ({ ...prev, open: false }))} color="inherit">
            Cancel
          </Button>
          <Button onClick={confirmDialog.onConfirm} color="primary" variant="contained" autoFocus>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
