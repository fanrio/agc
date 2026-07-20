import { useState, useEffect } from 'react';
import { Box, Button, TextField, Card, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton, CircularProgress, Alert, Collapse, Select, MenuItem, FormControl, InputLabel, Snackbar, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Autocomplete, InputAdornment, Tooltip, Skeleton } from '@mui/material';
import { Plus, Trash2, X, Check, Shield, Users, Search, RefreshCw } from 'lucide-react';
import * as api from '../api';
import { usePermissions } from '../context/PermissionsContext';
import { filterRolesByPermissions, isRoleInScope } from '../utils/helpers';
import UserRoleAssignment from './UserRoleAssignment';

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
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
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

  async function load() {
    setLoading(true);
    try {
      const [assignData, roleData] = await Promise.all([
        api.getAssignments(),
        api.getRoles()
      ]);
      const filteredRoles = filterRolesByPermissions(roleData, permissions);
      const allowedRoles = (permissions?.isSuperAdmin || permissions?.canAssignRoles) 
        ? filteredRoles 
        : filteredRoles.filter(r => {
            const isApprover = Array.isArray(r.approvers) && r.approvers.some(a => String(a.userId).toLowerCase() === permissions?.userId?.toLowerCase());
            if (isApprover) return true;
            if (permissions?.canManageDerivedRoles && r.type === 'DERIVED') {
              return isRoleInScope(r.ID, r.name, permissions.managedDerivedRolesScope);
            }
            return false;
          });
      const allowedRoleIds = new Set(allowedRoles.map(r => r.ID));
      setAssignments(assignData.filter(a => allowedRoleIds.has(a.role_ID)));
      setRoles(allowedRoles);
    } catch (e) {
      setSnackbar({ open: true, message: `Failed to load data: ${e.message}`, severity: 'error' });
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

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
          onClick={() => { setAssignDialogOpen(true); setSnackbar(prev => ({ ...prev, open: false })); }} 
          disabled={permissions?.isSuperAdmin ? false : (permissions && !permissions.canAssignRoles && roles.length === 0)}
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
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ minWidth: 150 }}
          />

          <TextField
            label="Assigned On: End"
            type="date"
            value={filterEndDate}
            onChange={(e) => setFilterEndDate(e.target.value)}
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
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
                {[1, 2, 3, 4, 5].map((idx) => (
                  <TableRow key={idx}>
                    <TableCell><Skeleton variant="text" width={80} /></TableCell>
                    <TableCell><Skeleton variant="text" width={120} /></TableCell>
                    <TableCell><Skeleton variant="text" width={140} /></TableCell>
                    <TableCell><Skeleton variant="text" width={100} /></TableCell>
                    <TableCell><Skeleton variant="text" width={90} /></TableCell>
                    <TableCell align="right"><Skeleton variant="circular" width={28} height={28} sx={{ ml: 'auto' }} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
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
                    <TableCell sx={{ fontWeight: 600 }}>
                      {a.userId}
                    </TableCell>
                    <TableCell sx={{ fontWeight: 500 }}>
                      {a.userName || a.userId}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Shield size={14} color={a.role?.type === 'ORG_BASED' ? '#3b82f6' : '#a78bfa'} />
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {a.role?.name || 'Unknown Role'}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
                      {a.createdAt ? new Date(a.createdAt).toLocaleString() : 'N/A'}
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
                      {a.createdBy || 'System'}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Remove assignment">
                        <IconButton 
                          color="error" 
                          onClick={() => handleDelete(a.ID, a.userName || a.userId, a.role?.name || 'Unknown')} 
                          disabled={loading || (permissions?.isSuperAdmin ? false : (permissions && !permissions.canAssignRoles && !roles.some(r => r.ID === a.role_ID)))} 
                          size="small"
                          aria-label="Remove assignment"
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </Tooltip>
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

      <UserRoleAssignment
        open={assignDialogOpen}
        roles={roles}
        onClose={() => setAssignDialogOpen(false)}
        onSuccess={async (msg) => {
          setAssignDialogOpen(false);
          setSnackbar({ open: true, message: msg, severity: 'success' });
          await load();
        }}
        onError={(msg) => {
          setSnackbar({ open: true, message: msg, severity: 'error' });
        }}
      />
    </Box>
  );
}
