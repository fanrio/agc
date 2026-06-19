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
  DialogActions, 
  TextField, 
  Autocomplete, 
  CircularProgress,
  Alert,
  Snackbar
} from '@mui/material';
import { Plus, Trash2, Shield, Users, HelpCircle, AlertTriangle } from 'lucide-react';
import * as api from '../api';

export default function AppAuthorizationsView() {
  const [authorizations, setAuthorizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ldapOptions, setLdapOptions] = useState([]);
  const [ldapLoading, setLdapLoading] = useState(false);
  const [ldapInput, setLdapInput] = useState('');
  
  // Dialog state
  const [openAdd, setOpenAdd] = useState(false);
  const [selectedLdapUser, setSelectedLdapUser] = useState(null);
  const [newPermissions, setNewPermissions] = useState({
    canManageOrgRoles: true,
    canManageSingleRoles: true,
    canManageDerivedRoles: true,
    canAssignRoles: true
  });
  
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await api.getAppAuthorizations();
      setAuthorizations(data || []);
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

  const handleAddAuthorization = async () => {
    if (!selectedLdapUser) {
      setSnackbar({ open: true, message: 'Please select a user from LDAP', severity: 'error' });
      return;
    }

    // Check if user already exists
    const exists = authorizations.some(a => a.userId.toLowerCase() === selectedLdapUser.username.toLowerCase());
    if (exists) {
      setSnackbar({ open: true, message: `User "${selectedLdapUser.displayName}" is already configured`, severity: 'error' });
      return;
    }

    try {
      const newAuth = await api.createAppAuthorization({
        userId: selectedLdapUser.username,
        userName: selectedLdapUser.displayName,
        canManageOrgRoles: newPermissions.canManageOrgRoles,
        canManageSingleRoles: newPermissions.canManageSingleRoles,
        canManageDerivedRoles: newPermissions.canManageDerivedRoles,
        canAssignRoles: newPermissions.canAssignRoles
      });
      setAuthorizations(prev => [...prev, newAuth]);
      setOpenAdd(false);
      setSelectedLdapUser(null);
      setNewPermissions({ canManageOrgRoles: true, canManageSingleRoles: true, canManageDerivedRoles: true, canAssignRoles: true });
      setSnackbar({ open: true, message: 'User authorization added successfully', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Failed to add authorization', severity: 'error' });
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Remove application authorizations for user "${name}"?`)) return;
    try {
      await api.deleteAppAuthorization(id);
      setAuthorizations(prev => prev.filter(item => item.ID !== id));
      setSnackbar({ open: true, message: 'Authorization removed successfully', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Deletion failed', severity: 'error' });
    }
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
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell style={{ fontWeight: 600 }}>User ID</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>User Name</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="center">Manage Org Roles</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="center">Manage Single Roles</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="center">Manage Derived Roles</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="center">Assign Roles</TableCell>
                  <TableCell style={{ fontWeight: 600 }} align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {authorizations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                      No administrator authorization definitions set.
                    </TableCell>
                  </TableRow>
                ) : (
                  authorizations.map(auth => (
                    <TableRow key={auth.ID} hover>
                      <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{auth.userId}</TableCell>
                      <TableCell sx={{ fontWeight: 500 }}>{auth.userName}</TableCell>
                      <TableCell align="center">
                        <Checkbox 
                          checked={auth.canManageOrgRoles}
                          onChange={(e) => handleTogglePermission(auth.ID, 'canManageOrgRoles', e.target.checked)}
                          sx={{ '&.Mui-checked': { color: '#3b82f6' } }}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Checkbox 
                          checked={auth.canManageSingleRoles}
                          onChange={(e) => handleTogglePermission(auth.ID, 'canManageSingleRoles', e.target.checked)}
                          sx={{ '&.Mui-checked': { color: '#a78bfa' } }}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Checkbox 
                          checked={auth.canManageDerivedRoles}
                          onChange={(e) => handleTogglePermission(auth.ID, 'canManageDerivedRoles', e.target.checked)}
                          sx={{ '&.Mui-checked': { color: '#f59e0b' } }}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Checkbox 
                          checked={auth.canAssignRoles}
                          onChange={(e) => handleTogglePermission(auth.ID, 'canAssignRoles', e.target.checked)}
                          sx={{ '&.Mui-checked': { color: '#10b981' } }}
                        />
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
                  ))
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
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 2
          }
        }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid rgba(255,255,255,0.08)', pb: 2 }}>
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
                checked={newPermissions.canManageOrgRoles}
                onChange={(e) => setNewPermissions(prev => ({ ...prev, canManageOrgRoles: e.target.checked }))}
                id="perm-org-roles"
              />
              <Box component="label" htmlFor="perm-org-roles" sx={{ cursor: 'pointer' }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>Manage Org-Based Roles</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Add, change, delete org-based roles</Typography>
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
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Add, change, delete custom single roles</Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
              <Checkbox 
                checked={newPermissions.canManageDerivedRoles}
                onChange={(e) => setNewPermissions(prev => ({ ...prev, canManageDerivedRoles: e.target.checked }))}
                id="perm-derived-roles"
              />
              <Box component="label" htmlFor="perm-derived-roles" sx={{ cursor: 'pointer' }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>Manage Derived Roles</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Add, change, delete child roles containing parents</Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
              <Checkbox 
                checked={newPermissions.canAssignRoles}
                onChange={(e) => setNewPermissions(prev => ({ ...prev, canAssignRoles: e.target.checked }))}
                id="perm-assign"
              />
              <Box component="label" htmlFor="perm-assign" sx={{ cursor: 'pointer' }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>Assign Roles</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Link and assign roles to users</Typography>
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid rgba(255,255,255,0.08)', px: 3, py: 2 }}>
          <Button onClick={() => setOpenAdd(false)} color="inherit">Cancel</Button>
          <Button variant="contained" onClick={handleAddAuthorization} disabled={!selectedLdapUser}>Add</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
