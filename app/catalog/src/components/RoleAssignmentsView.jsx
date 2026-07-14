import { useState, useEffect } from 'react';
import { Box, Button, TextField, Card, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton, CircularProgress, Alert, Collapse, Select, MenuItem, FormControl, InputLabel, Snackbar, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Autocomplete, InputAdornment } from '@mui/material';
import { Plus, Trash2, X, Check, Shield, Users, Search, RefreshCw } from 'lucide-react';
import * as api from '../api';
import { usePermissions } from '../context/PermissionsContext';
import { filterRolesByPermissions } from '../utils/helpers';

// Helper to recursively check if a role or any of its parents has restrictions
function hasAnyRestrictions(role, allRoles) {
  if (role.ownRestrictions && role.ownRestrictions.length > 0) return true;
  if (role.parentRoles && role.parentRoles.length > 0) {
    for (const pr of role.parentRoles) {
      const parentId = pr.parent_ID || (pr.parent && pr.parent.ID);
      if (parentId) {
        const parent = allRoles.find(r => r.ID === parentId);
        if (parent && hasAnyRestrictions(parent, allRoles)) {
          return true;
        }
      }
    }
  }
  return false;
}

export default function RoleAssignmentsView() {
  const { permissions } = usePermissions();
  const [assignments, setAssignments] = useState([]);
  
  // Confirm Dialog State
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: 'Confirm', message: '', onConfirm: null });
  const [roles, setRoles]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showAdd, setShowAdd]         = useState(false);
  const [error, setError]             = useState(''); // Kept for reference but using snackbar instead
  const [snackbar, setSnackbar]       = useState({ open: false, message: '', severity: 'error' });

  // Filtering States
  const [filterUser, setFilterUser]           = useState('');
  const [filterRole, setFilterRole]           = useState('ALL');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate]     = useState('');
  const [filterCreatedBy, setFilterCreatedBy] = useState('');

  // Extract unique roles present in current assignments
  const uniqueRoles = Array.from(new Set(assignments.map(a => a.role?.name).filter(Boolean))).sort();

  // Apply filtering in memory
  const filteredAssignments = assignments.filter(a => {
    if (filterUser.trim()) {
      const q = filterUser.toLowerCase();
      const match = (a.userId && a.userId.toLowerCase().includes(q)) || 
                    (a.userName && a.userName.toLowerCase().includes(q));
      if (!match) return false;
    }
    if (filterRole !== 'ALL') {
      if (a.role?.name !== filterRole) return false;
    }
    if (filterStartDate) {
      if (!a.createdAt) return false;
      const start = new Date(filterStartDate + 'T00:00:00');
      const aDate = new Date(a.createdAt);
      if (aDate < start) return false;
    }
    if (filterEndDate) {
      if (!a.createdAt) return false;
      const end = new Date(filterEndDate + 'T23:59:59');
      const aDate = new Date(a.createdAt);
      if (aDate > end) return false;
    }
    if (filterCreatedBy.trim()) {
      const q = filterCreatedBy.toLowerCase();
      const match = a.createdBy && a.createdBy.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const handleResetFilters = () => {
    setFilterUser('');
    setFilterRole('ALL');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterCreatedBy('');
  };

  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  // Form states
  const [form, setForm] = useState({ roleId: '' });

  // SCIM User Search States
  const [scimOptions, setScimOptions]       = useState([]);
  const [scimLoading, setScimLoading]       = useState(false);
  const [scimInput, setScimInput]           = useState('');
  const [selectedScimUser, setSelectedScimUser] = useState(null);

  // Debounced SCIM user search calling API when input has >= 3 characters
  useEffect(() => {
    const trimmed = scimInput.trim();
    if (trimmed.length < 3) {
      setScimOptions([]);
      return;
    }
    const handler = setTimeout(() => {
      setScimLoading(true);
      api.searchScimUsers(trimmed)
        .then(res => {
          setScimOptions(res || []);
          setScimLoading(false);
        })
        .catch(() => setScimLoading(false));
    }, 300);
    return () => clearTimeout(handler);
  }, [scimInput]);

  async function load() {
    setLoading(true);
    try {
      const [assignData, roleData] = await Promise.all([
        api.getAssignments(),
        api.getRoles()
      ]);
      const filteredRoles = filterRolesByPermissions(roleData, permissions);
      const allowedRoleIds = new Set(filteredRoles.map(r => r.ID));
      setAssignments(assignData.filter(a => allowedRoleIds.has(a.role_ID)));
      setRoles(filteredRoles);
    } catch (e) {
      setError(`Failed to load data: ${e.message}`);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    if (!selectedScimUser || !form.roleId) {
      setSnackbar({ open: true, message: 'User selection and Role selection are required.', severity: 'error' });
      return;
    }

    const payload = {
      userId: selectedScimUser.username,
      userName: selectedScimUser.displayName || selectedScimUser.username,
      role_ID: form.roleId
    };

    setLoading(true);
    try {
      await api.createAssignment(payload);
      setForm({ roleId: '' });
      setSelectedScimUser(null);
      setScimInput('');
      setShowAdd(false);
      await load();
    } catch (e) {
      setSnackbar({ open: true, message: e.message, severity: 'error' });
    }
    setLoading(false);
  }

  function handleDelete(id, user, roleName) {
    setConfirmDialog({
      open: true,
      title: 'Remove Assignment',
      message: `Remove assignment of role "${roleName}" from user "${user}"?`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        setLoading(true);
        try {
          await api.deleteAssignment(id);
          await load();
        } catch (e) {
          setSnackbar({ open: true, message: e.message, severity: 'error' });
        }
        setLoading(false);
      }
    });
  }

  return (
    <Box sx={{ animation: 'fadeIn 0.3s' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>Role Assignments</Typography>
          <Typography variant="body2" color="text.secondary">Assign authorization roles to users and groups</Typography>
        </Box>
        <Button 
          variant="contained" 
          onClick={() => { setShowAdd(s => !s); setSnackbar(prev => ({ ...prev, open: false })); }} 
          disabled={permissions?.isSuperAdmin ? false : (permissions && !permissions.canAssignRoles)}
          startIcon={<Plus size={15} />}
        >
          Assign Role
        </Button>
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>

      <Collapse in={showAdd}>
        <Card sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1.5fr auto' }, gap: 2, alignItems: 'end' }}>
            <Autocomplete
              value={selectedScimUser}
              onChange={(e, v) => setSelectedScimUser(v)}
              inputValue={scimInput}
              onInputChange={(e, v) => setScimInput(v)}
              options={scimOptions}
              loading={scimLoading}
              getOptionLabel={(option) => `${option.displayName} (${option.username})`}
              renderInput={(params) => (
                <TextField 
                  {...params} 
                  label="Search User (SCIM)" 
                  size="small" 
                  placeholder="Type username or email..."
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {scimLoading ? <CircularProgress color="inherit" size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
            <FormControl size="small" fullWidth>
              <InputLabel id="role-select-label">Role</InputLabel>
              <Select
                labelId="role-select-label"
                label="Role"
                value={form.roleId}
                onChange={e => setForm(f => ({ ...f, roleId: e.target.value }))}
              >
                <MenuItem value=""><em>Select Role</em></MenuItem>
                {roles.map(r => {
                  const allowed = hasAnyRestrictions(r, roles);
                  return (
                    <MenuItem key={r.ID} value={r.ID} disabled={!allowed}>
                      {r.name} ({r.type === 'ORG_BASED' ? 'Org' : (r.parentRoles && r.parentRoles.length > 0 ? 'Derived' : 'Single')}){!allowed ? ' - No Restrictions' : ''}
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="contained" onClick={handleCreate} disabled={loading} startIcon={<Check size={14} />}>
                Assign
              </Button>
              <IconButton onClick={() => { setShowAdd(false); setSelectedScimUser(null); setScimInput(''); }} size="small"><X size={16} /></IconButton>
            </Box>
          </Box>
        </Card>
      </Collapse>

      {/* Filter Toolbar Card */}
      <Card sx={{ p: 2, mb: 3, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', backgroundImage: 'none' }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          <TextField
            placeholder="Filter by User..."
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            size="small"
            sx={{ minWidth: 200, flexGrow: 1 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start" sx={{ color: 'text.secondary' }}>
                    <Search size={16} />
                  </InputAdornment>
                ),
              }
            }}
          />

          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="filter-role-label">Role</InputLabel>
            <Select
              labelId="filter-role-label"
              label="Role"
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
            >
              <MenuItem value="ALL">All Roles</MenuItem>
              {uniqueRoles.map(roleName => (
                <MenuItem key={roleName} value={roleName}>{roleName}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Assigned On: Start"
            type="date"
            value={filterStartDate}
            onChange={(e) => setFilterStartDate(e.target.value)}
            size="small"
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 150 }}
          />

          <TextField
            label="Assigned On: End"
            type="date"
            value={filterEndDate}
            onChange={(e) => setFilterEndDate(e.target.value)}
            size="small"
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 150 }}
          />

          <TextField
            placeholder="Assigned By..."
            value={filterCreatedBy}
            onChange={(e) => setFilterCreatedBy(e.target.value)}
            size="small"
            sx={{ minWidth: 160 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start" sx={{ color: 'text.secondary' }}>
                    <Search size={16} />
                  </InputAdornment>
                ),
              }
            }}
          />

          {(filterUser || filterRole !== 'ALL' || filterStartDate || filterEndDate || filterCreatedBy) && (
            <Button
              variant="text"
              color="inherit"
              onClick={handleResetFilters}
              startIcon={<RefreshCw size={14} />}
              size="small"
            >
              Reset
            </Button>
          )}
        </Box>
      </Card>

      <Card>
        {loading && assignments.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress size={30} /></Box>
        ) : assignments.length === 0 ? (
          <Box sx={{ py: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <Box sx={{ opacity: 0.5, mb: 2 }}><Users size={40} /></Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>No role assignments yet</Typography>
            <Typography variant="body2" color="text.secondary">Click "Assign Role" to link a user or group to an authorization role.</Typography>
          </Box>
        ) : filteredAssignments.length === 0 ? (
          <Box sx={{ py: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <Box sx={{ opacity: 0.5, mb: 2 }}><Search size={40} /></Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>No matching assignments found</Typography>
            <Typography variant="body2" color="text.secondary">Try adjusting your filters or search query.</Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell style={{ fontWeight: 600 }}>User ID</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>User Name</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Assigned Role</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Assigned On</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Assigned By</TableCell>
                  <TableCell align="right" style={{ width: 120, fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredAssignments.map(a => (
                  <TableRow key={a.ID} hover>
                    <TableCell sx={{ fontWeight: 600, fontFamily: 'monospace' }}>
                      {a.userId}
                    </TableCell>
                    <TableCell sx={{ fontWeight: 500 }}>
                      {a.userName || a.userId}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Shield size={14} color={a.role?.type === 'ORG_BASED' ? '#3b82f6' : '#a78bfa'} />
                        <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace' }}>
                          {a.role?.name || 'Unknown Role'}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
                      {a.createdAt ? new Date(a.createdAt).toLocaleString() : 'N/A'}
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: '0.875rem', fontFamily: 'monospace' }}>
                      {a.createdBy || 'System'}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton 
                        color="error" 
                        onClick={() => handleDelete(a.ID, a.userName || a.userId, a.role?.name || 'Unknown')} 
                        disabled={loading || (permissions?.isSuperAdmin ? false : (permissions && !permissions.canAssignRoles))} 
                        size="small"
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

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
