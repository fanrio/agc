import { useState, useEffect } from 'react';
import { Box, Button, TextField, Card, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton, CircularProgress, Alert, Collapse, Select, MenuItem, FormControl, InputLabel, Snackbar, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import { Plus, Trash2, X, Check, Shield, Users } from 'lucide-react';
import * as api from '../api';

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

export default function RoleAssignmentsView({ permissions }) {
  const [assignments, setAssignments] = useState([]);
  
  // Confirm Dialog State
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: 'Confirm', message: '', onConfirm: null });
  const [roles, setRoles]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showAdd, setShowAdd]         = useState(false);
  const [error, setError]             = useState(''); // Kept for reference but using snackbar instead
  const [snackbar, setSnackbar]       = useState({ open: false, message: '', severity: 'error' });

  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  // Form states
  const [form, setForm] = useState({ userId: '', userName: '', roleId: '' });

  async function load() {
    setLoading(true);
    try {
      const [assignData, roleData] = await Promise.all([
        api.getAssignments(),
        api.getRoles()
      ]);
      setAssignments(assignData);
      setRoles(roleData);
    } catch (e) {
      setError(`Failed to load data: ${e.message}`);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    if (!form.userId.trim() || !form.roleId) {
      setSnackbar({ open: true, message: 'User ID and Role selection are required.', severity: 'error' });
      return;
    }

    const payload = {
      userId: form.userId.trim(),
      userName: form.userName.trim() || form.userId.trim(),
      role_ID: form.roleId
    };

    setLoading(true);
    try {
      await api.createAssignment(payload);
      setForm({ userId: '', userName: '', roleId: '' });
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
          disabled={permissions && !permissions.canAssignRoles}
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
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1.5fr auto' }, gap: 2, alignItems: 'end' }}>
            <TextField
              label="User ID / Group ID"
              size="small"
              placeholder="e.g. US12345"
              value={form.userId}
              onChange={e => setForm(f => ({ ...f, userId: e.target.value }))}
            />
            <TextField
              label="User Name (Optional)"
              size="small"
              placeholder="e.g. John Doe"
              value={form.userName}
              onChange={e => setForm(f => ({ ...f, userName: e.target.value }))}
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
              <IconButton onClick={() => setShowAdd(false)} size="small"><X size={16} /></IconButton>
            </Box>
          </Box>
        </Card>
      </Collapse>

      <Card>
        {loading && assignments.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress size={30} /></Box>
        ) : assignments.length === 0 ? (
          <Box sx={{ py: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <Box sx={{ opacity: 0.5, mb: 2 }}><Users size={40} /></Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>No role assignments yet</Typography>
            <Typography variant="body2" color="text.secondary">Click "Assign Role" to link a user or group to an authorization role.</Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell style={{ fontWeight: 600 }}>User ID</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>User Name</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Assigned Role</TableCell>
                  <TableCell align="right" style={{ width: 120, fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {assignments.map(a => (
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
                    <TableCell align="right">
                      <IconButton 
                        color="error" 
                        onClick={() => handleDelete(a.ID, a.userName || a.userId, a.role?.name || 'Unknown')} 
                        disabled={loading || (permissions && !permissions.canAssignRoles)} 
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
