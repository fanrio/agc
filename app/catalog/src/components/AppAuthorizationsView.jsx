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
  Chip,
  Divider
} from '@mui/material';
import { Plus, Trash2, Shield, Settings, AlertTriangle } from 'lucide-react';
import * as api from '../api';

// ─── Environment helpers ──────────────────────────────────────────────────────
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

// ─── Stream helpers ───────────────────────────────────────────────────────────
const parseStreams = (val) => {
  if (!val || val === 'ALL' || val === '*') return null; // null = ALL
  try {
    const parsed = JSON.parse(val);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    return val.split(',').map(s => s.trim()).filter(Boolean);
  }
  return null;
};

const serializeStreams = (ids, allStreams) => {
  if (!ids || ids.length === allStreams.length) return 'ALL';
  return JSON.stringify(ids);
};

// ─── Section heading ──────────────────────────────────────────────────────────
function SectionHeading({ icon: Icon, title, subtitle, color = '#0F172A' }) {
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
  const [authorizations, setAuthorizations] = useState([]);
  const [streams, setStreams]               = useState([]);
  const [allRoles, setAllRoles]             = useState([]);
  const [restrictionFields, setRestrictionFields] = useState([]);
  const [loading, setLoading]               = useState(true);
  const [ldapOptions, setLdapOptions]       = useState([]);
  const [ldapLoading, setLdapLoading]       = useState(false);
  const [ldapInput, setLdapInput]           = useState('');
  const [openAdd, setOpenAdd]               = useState(false);
  const [selectedLdapUser, setSelectedLdapUser] = useState(null);
  const [confirmDialog, setConfirmDialog]   = useState({ open: false, title: '', message: '', onConfirm: null });
  const [snackbar, setSnackbar]             = useState({ open: false, message: '', severity: 'success' });

  const defaultPermissions = {
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
    allowedStreams: null, // null = ALL
    isActive: true
  };
  const [newPermissions, setNewPermissions] = useState(defaultPermissions);

  // ─── Data loading ───────────────────────────────────────────────────────────
  const loadData = async () => {
    setLoading(true);
    try {
      const [authData, rolesData, fieldsData, streamsData] = await Promise.all([
        api.getAppAuthorizations(),
        api.getRoles(),
        api.getRestrictionFields(),
        api.getStreamsFlat()
      ]);
      setAuthorizations((authData || []).filter(Boolean));
      setAllRoles(rolesData || []);
      setRestrictionFields(fieldsData || []);
      setStreams((streamsData || []).filter(s => !s.parent)); // root streams only for selection
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Failed to load data', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // LDAP debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      if (!ldapInput.trim()) return;
      setLdapLoading(true);
      api.searchLdapUsers(ldapInput)
        .then(res => { setLdapOptions(res || []); setLdapLoading(false); })
        .catch(() => setLdapLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [ldapInput]);

  // ─── Update handlers ────────────────────────────────────────────────────────
  const handleTogglePermission = async (id, field, value) => {
    try {
      await api.updateAppAuthorization(id, { [field]: value });
      setAuthorizations(prev => prev.map(item => item.ID === id ? { ...item, [field]: value } : item));
      setSnackbar({ open: true, message: 'Permission updated', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Update failed', severity: 'error' });
    }
  };

  const handleUpdateEnvironments = async (id, valueArr) => {
    const serialized = serializeEnvironments(valueArr);
    try {
      await api.updateAppAuthorization(id, { allowedEnvironments: serialized });
      setAuthorizations(prev => prev.map(item => item.ID === id ? { ...item, allowedEnvironments: serialized } : item));
      setSnackbar({ open: true, message: 'Environments updated', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Update failed', severity: 'error' });
    }
  };

  const handleUpdateStreams = async (id, streamIds) => {
    const serialized = serializeStreams(streamIds, streams);
    try {
      await api.updateAppAuthorization(id, { allowedStreams: serialized });
      setAuthorizations(prev => prev.map(item => item.ID === id ? { ...item, allowedStreams: serialized } : item));
      setSnackbar({ open: true, message: 'Stream scope updated', severity: 'success' });
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

  // ─── Add / Delete ───────────────────────────────────────────────────────────
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
      const streamVal = newPermissions.allowedStreams === null
        ? 'ALL'
        : serializeStreams(newPermissions.allowedStreams, streams);
      const newAuth = await api.createAppAuthorization({
        userId:                   selectedLdapUser.username,
        userName:                 selectedLdapUser.displayName,
        isSuperAdmin:             newPermissions.isSuperAdmin,
        canManageAppUsers:        newPermissions.canManageAppUsers,
        canManageOrgRoles:        newPermissions.canManageOrgRoles,
        canManageSingleRoles:     newPermissions.canManageSingleRoles,
        canManageDerivedRoles:    newPermissions.canManageDerivedRoles,
        managedDerivedRolesScope: newPermissions.managedDerivedRolesScope || 'ALL',
        canAssignRoles:           newPermissions.canAssignRoles,
        canManageReplications:    newPermissions.canManageReplications,
        canViewAuditLogs:         newPermissions.canViewAuditLogs,
        canManageSettings:        newPermissions.canManageSettings,
        allowedEnvironments:      serializeEnvironments(newPermissions.allowedEnvironments),
        allowedStreams:            streamVal,
        isActive:                 newPermissions.isActive
      });
      if (newAuth) {
        setAuthorizations(prev => [...prev, newAuth].filter(Boolean));
      } else {
        await loadData();
      }
      setOpenAdd(false);
      setSelectedLdapUser(null);
      setNewPermissions(defaultPermissions);
      setSnackbar({ open: true, message: 'User authorization added', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Failed to add authorization', severity: 'error' });
    }
  };

  const handleDelete = (id, name) => {
    setConfirmDialog({
      open: true,
      title: 'Remove Authorization',
      message: `Remove application authorization for user "${name}"?`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        try {
          await api.deleteAppAuthorization(id);
          setAuthorizations(prev => prev.filter(item => item.ID !== id));
          setSnackbar({ open: true, message: 'Authorization removed', severity: 'success' });
        } catch (err) {
          setSnackbar({ open: true, message: err.message || 'Deletion failed', severity: 'error' });
        }
      }
    });
  };

  // ─── Sub-components ─────────────────────────────────────────────────────────
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
        if (currRole.ownRestrictions) currRole.ownRestrictions.forEach(r => fields.add(r.field));
        if (currRole.parentRoles) {
          currRole.parentRoles.forEach(pr => {
            const pid = pr.parent?.ID || pr.parent_ID;
            if (pid && !visited.has(pid)) { visited.add(pid); queue.push(pid); }
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
      return scopeStr.split(',').map(s => s.trim()).filter(Boolean)
        .map(nameOrId => {
          const role = allRoles.find(r => r.name === nameOrId || r.ID === nameOrId);
          return { roleId: role ? role.ID : nameOrId, fields: [] };
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
      onChange(JSON.stringify([...scopeList, { roleId: role.ID, fields: [] }]));
    };
    const handleRemoveRole = (roleId) => {
      const updated = scopeList.filter(s => s.roleId !== roleId);
      onChange(updated.length === 0 ? 'ALL' : JSON.stringify(updated));
    };
    const handleFieldChange = (roleId, fields) => {
      onChange(JSON.stringify(scopeList.map(s => s.roleId === roleId ? { ...s, fields } : s)));
    };
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, width: 240, mt: 1 }}>
        <Autocomplete
          size="small" options={availableRoles}
          getOptionLabel={(o) => o.name || o.ID || ''} value={null}
          onChange={(e, val) => handleAddRole(val)}
          renderInput={(params) => <TextField {...params} placeholder="Add Role..." variant="outlined" />}
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
                multiple size="small" options={allowedFields}
                getOptionLabel={(o) => o.name || ''}
                value={allowedFields.filter(f => item.fields.includes(f.name))}
                onChange={(e, val) => handleFieldChange(item.roleId, val.map(f => f.name))}
                renderInput={(params) => <TextField {...params} placeholder="Select fields..." variant="outlined" />}
                sx={{ mt: 0.5 }}
              />
            </Card>
          );
        })}
      </Box>
    );
  };

  // Stream chip/selector for a single row
  const StreamCell = ({ auth }) => {
    const streamIds = parseStreams(auth.allowedStreams);
    if (auth.isSuperAdmin || streamIds === null) {
      return <Chip label="All Streams" size="small" color="primary" variant="outlined" />;
    }
    const selectedStreamNames = streamIds.map(id => {
      const s = streams.find(st => st.ID === id);
      return s ? s.name : id;
    });
    return (
      <Autocomplete
        multiple
        size="small"
        options={streams}
        getOptionLabel={(o) => o.name || o.ID}
        value={streams.filter(s => streamIds.includes(s.ID))}
        onChange={(e, val) => handleUpdateStreams(auth.ID, val.map(s => s.ID))}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => {
            const { key, ...tagProps } = getTagProps({ index });
            return <Chip key={key} label={option.name} size="small" {...tagProps} />;
          })
        }
        renderInput={(params) => (
          <TextField {...params} variant="outlined" size="small" placeholder={selectedStreamNames.length === 0 ? 'No streams' : ''} sx={{ minWidth: 160 }} />
        )}
        sx={{ minWidth: 160 }}
      />
    );
  };

  // ─── Table cell helpers ─────────────────────────────────────────────────────
  const BoolCell = ({ auth, field, color }) => (
    <TableCell align="center">
      <Checkbox
        size="small"
        checked={!!auth[field]}
        onChange={(e) => handleTogglePermission(auth.ID, field, e.target.checked)}
        disabled={field !== 'isActive' && field !== 'isSuperAdmin' && !!auth.isSuperAdmin}
        sx={color ? { '&.Mui-checked': { color } } : undefined}
      />
    </TableCell>
  );

  const IdentityCell = ({ auth }) => (
    <>
      <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{auth.userId}</TableCell>
      <TableCell sx={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{auth.userName}</TableCell>
    </>
  );

  const emptyRow = (cols) => (
    <TableRow>
      <TableCell colSpan={cols} align="center" sx={{ py: 6, color: 'text.secondary' }}>
        No user authorizations defined.
      </TableCell>
    </TableRow>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Snackbar open={snackbar.open} autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>

      {/* Page header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
            Application Access Control
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage permission levels for administrators within the Auth Wizard.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setOpenAdd(true)}>
          Add User
        </Button>
      </Box>

      {/* Open Demo Mode banner */}
      {authorizations.length === 0 && !loading && (
        <Card sx={{ bgcolor: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
          <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <AlertTriangle size={24} color="#f59e0b" />
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, color: '#f59e0b' }}>Open Demo Mode Active</Typography>
              <Typography variant="caption" color="text.secondary">
                No authorizations defined. All simulated users have full access. Add a user to enable strict access control.
              </Typography>
            </Box>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress size={30} /></Box>
      ) : (
        <>
          {/* ── Area 1: Manage Application ─────────────────────────────────── */}
          <Card>
            <SectionHeading icon={Settings} title="Manage Application"
              subtitle="System configuration, settings, and monitoring access" />
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>User ID</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>User Name</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Active</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Super Admin</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Manage Users</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Manage Settings</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">View Audit Logs</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Manage Replications</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {authorizations.length === 0
                    ? emptyRow(9)
                    : authorizations.map(auth => !auth ? null : (
                      <TableRow key={auth.ID} hover>
                        <IdentityCell auth={auth} />
                        <BoolCell auth={auth} field="isActive" color="#ef4444" />
                        <BoolCell auth={auth} field="isSuperAdmin" color="#f43f5e" />
                        <BoolCell auth={auth} field="canManageAppUsers" />
                        <BoolCell auth={auth} field="canManageSettings" />
                        <BoolCell auth={auth} field="canViewAuditLogs" />
                        <BoolCell auth={auth} field="canManageReplications" color="#0ea5e9" />
                        <TableCell align="right">
                          <IconButton color="error" size="small"
                            onClick={() => handleDelete(auth.ID, auth.userName || auth.userId)}>
                            <Trash2 size={15} />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>

          {/* ── Area 2: Manage Roles ───────────────────────────────────────── */}
          <Card>
            <SectionHeading icon={Shield} title="Manage Roles"
              subtitle="Role creation, assignment, and stream-based scoping" color="#2563eb" />
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>User ID</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>User Name</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Org Roles</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Single Roles</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Derived Roles</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Assign Roles</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Environments</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Streams</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {authorizations.length === 0
                    ? emptyRow(8)
                    : authorizations.map(auth => !auth ? null : (
                      <TableRow key={auth.ID} hover>
                        <IdentityCell auth={auth} />
                        <BoolCell auth={auth} field="canManageOrgRoles" color="#3b82f6" />
                        <BoolCell auth={auth} field="canManageSingleRoles" color="#a78bfa" />
                        {/* Derived roles + scope selector */}
                        <TableCell align="center">
                          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                            <Checkbox
                              size="small"
                              checked={!!auth.canManageDerivedRoles}
                              onChange={(e) => handleTogglePermission(auth.ID, 'canManageDerivedRoles', e.target.checked)}
                              disabled={!!auth.isSuperAdmin}
                              sx={{ '&.Mui-checked': { color: '#f59e0b' } }}
                            />
                            {!auth.isSuperAdmin && auth.canManageDerivedRoles && (
                              <ScopeSelector
                                scopeStr={auth.managedDerivedRolesScope}
                                onChange={(val) => handleUpdateScope(auth.ID, val)}
                              />
                            )}
                          </Box>
                        </TableCell>
                        <BoolCell auth={auth} field="canAssignRoles" color="#10b981" />
                        {/* Environments */}
                        <TableCell align="center">
                          {auth.isSuperAdmin ? (
                            <Chip label="ALL" size="small" color="primary" variant="outlined" />
                          ) : (
                            <Select
                              multiple
                              value={parseEnvironments(auth.allowedEnvironments)}
                              onChange={(e) => handleUpdateEnvironments(auth.ID, e.target.value)}
                              input={<OutlinedInput size="small" style={{ width: 84, fontSize: '0.75rem' }} />}
                              renderValue={(selected) => (
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.2 }}>
                                  {selected.map(v => (
                                    <Typography key={v} style={{ fontSize: '0.75rem', fontWeight: 700 }}>{v}</Typography>
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
                        {/* Streams */}
                        <TableCell align="center">
                          <StreamCell auth={auth} />
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </>
      )}

      {/* ── Add User Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={openAdd} onClose={() => setOpenAdd(false)} maxWidth="xs" fullWidth
        PaperProps={{ sx: { bgcolor: 'background.paper', backgroundImage: 'none', border: '1px solid', borderColor: 'divider' } }}>
        <DialogTitle sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 2 }}>
          Add User Authorization
        </DialogTitle>
        <DialogContent sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* User search */}
          <Autocomplete
            value={selectedLdapUser}
            onChange={(e, v) => setSelectedLdapUser(v)}
            inputValue={ldapInput}
            onInputChange={(e, v) => setLdapInput(v)}
            options={ldapOptions}
            loading={ldapLoading}
            getOptionLabel={(o) => `${o.displayName} (${o.username})`}
            renderInput={(params) => (
              <TextField {...params} label="Search User (LDAP)" size="small" placeholder="Type username or name..."
                InputProps={{
                  ...(params.InputProps || {}),
                  endAdornment: <>{ldapLoading ? <CircularProgress color="inherit" size={20} /> : null}{params.InputProps?.endAdornment}</>
                }}
              />
            )}
            renderOption={(props, option) => {
              const { key, ...rest } = props;
              return (
                <li key={key || option.username} {...rest}>
                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{option.displayName} ({option.username})</Typography>
                    <Typography variant="caption" color="text.secondary">{option.department}</Typography>
                  </Box>
                </li>
              );
            }}
            fullWidth
          />

          {/* Account */}
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Account</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Checkbox id="perm-active" checked={newPermissions.isActive}
                onChange={(e) => setNewPermissions(p => ({ ...p, isActive: e.target.checked }))} />
              <Box component="label" htmlFor="perm-active" sx={{ cursor: 'pointer' }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>Active</Typography>
              </Box>
              <Checkbox id="perm-super" checked={newPermissions.isSuperAdmin}
                onChange={(e) => setNewPermissions(p => ({ ...p, isSuperAdmin: e.target.checked }))} />
              <Box component="label" htmlFor="perm-super" sx={{ cursor: 'pointer' }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>Super Admin</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Bypasses all checks</Typography>
              </Box>
            </Box>
          </Box>

          {!newPermissions.isSuperAdmin && (
            <>
              <Divider />
              {/* Application permissions */}
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Settings size={14} />
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>Application Permissions</Typography>
                </Box>
                {[
                  { id: 'perm-app-users', field: 'canManageAppUsers', label: 'Manage App Users', desc: 'Edit other users permissions' },
                  { id: 'perm-settings', field: 'canManageSettings', label: 'Manage Settings', desc: 'BDC, Streams, Restriction Fields' },
                  { id: 'perm-audit', field: 'canViewAuditLogs', label: 'View Audit Logs' },
                  { id: 'perm-repl', field: 'canManageReplications', label: 'Manage Replications', desc: 'Trigger and monitor replication runs' },
                ].map(({ id, field, label, desc }) => (
                  <Box key={id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                    <Checkbox id={id} size="small" checked={newPermissions[field]}
                      onChange={(e) => setNewPermissions(p => ({ ...p, [field]: e.target.checked }))} />
                    <Box component="label" htmlFor={id} sx={{ cursor: 'pointer' }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>{label}</Typography>
                      {desc && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{desc}</Typography>}
                    </Box>
                  </Box>
                ))}
              </Box>

              <Divider />
              {/* Role management permissions */}
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Shield size={14} />
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>Role Management Permissions</Typography>
                </Box>
                {[
                  { id: 'perm-org', field: 'canManageOrgRoles', label: 'Org-Based Roles' },
                  { id: 'perm-single', field: 'canManageSingleRoles', label: 'Single Roles' },
                  { id: 'perm-assign', field: 'canAssignRoles', label: 'Assign Roles' },
                ].map(({ id, field, label }) => (
                  <Box key={id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                    <Checkbox id={id} size="small" checked={newPermissions[field]}
                      onChange={(e) => setNewPermissions(p => ({ ...p, [field]: e.target.checked }))} />
                    <Box component="label" htmlFor={id} sx={{ cursor: 'pointer' }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>{label}</Typography>
                    </Box>
                  </Box>
                ))}

                {/* Derived roles */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                  <Checkbox id="perm-derived" size="small" checked={newPermissions.canManageDerivedRoles}
                    onChange={(e) => setNewPermissions(p => ({ ...p, canManageDerivedRoles: e.target.checked }))} />
                  <Box component="label" htmlFor="perm-derived" sx={{ cursor: 'pointer' }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>Derived Roles</Typography>
                  </Box>
                </Box>
                {newPermissions.canManageDerivedRoles && (
                  <Box sx={{ ml: 4, mt: 0.5 }}>
                    <ScopeSelector
                      scopeStr={newPermissions.managedDerivedRolesScope}
                      onChange={(val) => setNewPermissions(p => ({ ...p, managedDerivedRolesScope: val }))}
                    />
                  </Box>
                )}

                {/* Environments */}
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>Allowed Environments</Typography>
                  <Select
                    multiple
                    value={newPermissions.allowedEnvironments}
                    onChange={(e) => setNewPermissions(p => ({ ...p, allowedEnvironments: e.target.value }))}
                    input={<OutlinedInput size="small" />}
                    renderValue={(selected) => (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {selected.map(v => <Chip key={v} label={v} size="small" />)}
                      </Box>
                    )}
                    fullWidth
                  >
                    <MenuItem value="D">D (Dev)</MenuItem>
                    <MenuItem value="Q">Q (QA)</MenuItem>
                    <MenuItem value="P">P (Prod)</MenuItem>
                  </Select>
                </Box>

                {/* Streams */}
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>Allowed Streams</Typography>
                  {newPermissions.allowedStreams === null ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip label="All Streams" size="small" color="primary" variant="outlined" />
                      <Button size="small" variant="text" onClick={() => setNewPermissions(p => ({ ...p, allowedStreams: [] }))}>
                        Restrict
                      </Button>
                    </Box>
                  ) : (
                    <Autocomplete
                      multiple size="small"
                      options={streams}
                      getOptionLabel={(o) => o.name || o.ID}
                      value={streams.filter(s => (newPermissions.allowedStreams || []).includes(s.ID))}
                      onChange={(e, val) => setNewPermissions(p => ({ ...p, allowedStreams: val.map(s => s.ID) }))}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => {
                          const { key, ...tagProps } = getTagProps({ index });
                          return <Chip key={key} label={option.name} size="small" {...tagProps} />;
                        })
                      }
                      renderInput={(params) => <TextField {...params} placeholder="Select streams..." variant="outlined" />}
                    />
                  )}
                  {newPermissions.allowedStreams !== null && newPermissions.allowedStreams.length === 0 && (
                    <Button size="small" variant="text" sx={{ mt: 0.5 }}
                      onClick={() => setNewPermissions(p => ({ ...p, allowedStreams: null }))}>
                      ← Grant all streams
                    </Button>
                  )}
                </Box>
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid', borderColor: 'divider', px: 3, py: 2 }}>
          <Button onClick={() => setOpenAdd(false)} color="inherit">Cancel</Button>
          <Button variant="contained" onClick={handleAddAuthorization} disabled={!selectedLdapUser}>Add</Button>
        </DialogActions>
      </Dialog>

      {/* ── Confirm Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog(p => ({ ...p, open: false }))}>
        <DialogTitle>{confirmDialog.title}</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirmDialog.message}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(p => ({ ...p, open: false }))} color="inherit">Cancel</Button>
          <Button onClick={confirmDialog.onConfirm} color="primary" variant="contained" autoFocus>Confirm</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
