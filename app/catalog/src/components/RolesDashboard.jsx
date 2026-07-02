import { useState, useEffect } from 'react';
import { Box, Typography, Button, TextField, Alert, Snackbar, Dialog, DialogTitle, DialogContent, DialogActions, ToggleButton, ToggleButtonGroup, FormControlLabel, Checkbox } from '@mui/material';
import { Shield, Plus } from 'lucide-react';
import * as api from '../api';
import RoleCard from './RoleCard';
import { isCriticalRestriction } from '../utils/helpers';

// Helper recursively collecting all restrictions for a role
function getEffectiveRestrictionsFlat(role, allRoles) {
  let list = [];
  if (role.ownRestrictions && role.ownRestrictions.length > 0) {
    list.push(...role.ownRestrictions);
  }
  if (role.parentRoles && role.parentRoles.length > 0) {
    for (const pr of role.parentRoles) {
      const parentId = pr.parent_ID || (pr.parent && pr.parent.ID);
      if (parentId) {
        const parent = allRoles.find(r => r.ID === parentId);
        if (parent) {
          list.push(...getEffectiveRestrictionsFlat(parent, allRoles));
        }
      }
    }
  }
  return list;
}

// Helper recursively checking if a role is critical (all restrictions must be critical)
function isCriticalRole(role, allRoles, orgNodes) {
  const allRestrictions = getEffectiveRestrictionsFlat(role, allRoles);
  if (allRestrictions.length === 0) return false;
  return allRestrictions.every(r => isCriticalRestriction(r, orgNodes));
}

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

function canManageThisDerivedRole(role, permissions, allRoles) {
  if (!permissions) return false;
  if (!permissions.canManageDerivedRoles) return false;
  const scope = permissions.managedDerivedRolesScope;
  if (!scope || scope.trim() === '' || scope.trim().toUpperCase() === 'ALL' || scope.trim() === '*') {
    return true;
  }

  try {
    const scopeList = JSON.parse(scope);
    if (Array.isArray(scopeList)) {
      const matches = (id, name) => scopeList.some(s => s.roleId === id || (name && s.roleId === name));
      if (matches(role.ID, role.name)) return true;
      if (role.parentRoles && role.parentRoles.length > 0) {
        for (const pr of role.parentRoles) {
          const parentId = pr.parent_ID || (pr.parent && pr.parent.ID);
          if (parentId) {
            const parent = allRoles.find(r => r.ID === parentId);
            if (parent && matches(parent.ID, parent.name)) {
              return true;
            }
          }
        }
      }
      return false;
    }
  } catch (e) {
    const terms = scope.split(',').map(s => s.trim().toLowerCase());
    if (terms.includes(role.name.toLowerCase()) || terms.includes(role.ID.toLowerCase())) {
      return true;
    }
    if (role.parentRoles && role.parentRoles.length > 0) {
      for (const pr of role.parentRoles) {
        const parentId = pr.parent_ID || (pr.parent && pr.parent.ID);
        if (parentId) {
          const parent = allRoles.find(r => r.ID === parentId);
          if (parent) {
            if (terms.includes(parent.name.toLowerCase()) || terms.includes(parent.ID.toLowerCase())) {
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

function canDeriveFromRole(parentRole, permissions) {
  if (!permissions) return false;
  if (!permissions.canManageDerivedRoles) return false;
  const scope = permissions.managedDerivedRolesScope;
  if (!scope || scope.trim() === '' || scope.trim().toUpperCase() === 'ALL' || scope.trim() === '*') {
    return true;
  }

  try {
    const scopeList = JSON.parse(scope);
    if (Array.isArray(scopeList)) {
      return scopeList.some(s => s.roleId === parentRole.ID || s.roleId === parentRole.name);
    }
  } catch (e) {
    const terms = scope.split(',').map(s => s.trim().toLowerCase());
    return terms.includes(parentRole.name.toLowerCase()) || terms.includes(parentRole.ID.toLowerCase());
  }
  return false;
}

export default function RolesDashboard({ onDeriveRole, onEditRole, onCreateRole, initialFilter, setInitialFilter, permissions }) {
  const [roles, setRoles]     = useState([]);
  const [orgNodes, setOrgNodes] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [healthFilter, setHealthFilter] = useState(initialFilter || null);

  useEffect(() => {
    if (initialFilter) {
      setHealthFilter(initialFilter);
    }
  }, [initialFilter]);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'error' });

  // Toggle representation states ('compact' or 'detailed')
  const [viewMode, setViewMode] = useState('detailed');

  // Assignment dialog states
  const [assigningRole, setAssigningRole] = useState(null);
  const [assignForm, setAssignForm] = useState({ userId: '', userName: '' });
  const [assigningLoading, setAssigningLoading] = useState(false);

  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  async function load() {
    setLoading(true);
    try {
      const [rolesData, nodesData] = await Promise.all([
        api.getRoles(),
        api.getAllOrgNodesFlat()
      ]);
      setRoles(rolesData);
      setOrgNodes(nodesData);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAssignSubmit() {
    if (!assignForm.userId.trim()) return;
    setAssigningLoading(true);
    try {
      await api.createAssignment({
        userId: assignForm.userId.trim(),
        userName: assignForm.userName.trim() || assignForm.userId.trim(),
        role_ID: assigningRole.ID
      });
      setSnackbar({ open: true, message: `Successfully assigned role "${assigningRole.name}" to ${assignForm.userId}`, severity: 'success' });
      setAssigningRole(null);
      setAssignForm({ userId: '', userName: '' });
      await load();
    } catch (e) {
      setSnackbar({ open: true, message: e.message, severity: 'error' });
    }
    setAssigningLoading(false);
  }

  // Apply health filters
  const healthFilteredRoles = roles.filter(role => {
    if (!healthFilter) return true;
    if (healthFilter === 'unrestricted') {
      return !role.ownRestrictions || role.ownRestrictions.length === 0;
    }
    if (healthFilter === 'no-users') {
      return !role.assignments || role.assignments.length === 0;
    }
    if (healthFilter === 'no-approver') {
      return !role.approvers || role.approvers.length === 0;
    }
    if (healthFilter === 'critical') {
      return !!role.critical;
    }
    return true;
  });

  // Filter roles based on name, description, and restrictions
  const filteredRoles = healthFilteredRoles.filter(role => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const nameMatch = role.name.toLowerCase().includes(q);
    const descMatch = role.description && role.description.toLowerCase().includes(q);
    const restMatch = role.ownRestrictions && role.ownRestrictions.some(r => 
      r.field.toLowerCase().includes(q) || 
      r.value.toLowerCase().includes(q)
    );
    return nameMatch || descMatch || restMatch;
  });

  const isFilterActive = Boolean(searchQuery.trim() || healthFilter);
  const rootRoles = roles.filter(r => !r.parentRoles || r.parentRoles.length === 0);

  return (
    <Box sx={{ animation: 'fadeIn 0.3s' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>Roles & Authorizations</Typography>
          <Typography variant="body2" color="text.secondary">Visual inheritance tree of all Org-Based, Single, and Derived roles</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          {healthFilter && (
            <Chip
              label={
                healthFilter === 'unrestricted' ? 'Unrestricted Roles' :
                healthFilter === 'no-users' ? 'Roles with No Users' :
                healthFilter === 'no-approver' ? 'Roles with No Approver' : 
                healthFilter === 'critical' ? 'Critical Roles' : 'Filtered'
              }
              onDelete={() => {
                setHealthFilter(null);
                if (setInitialFilter) setInitialFilter(null);
              }}
              color="primary"
              variant="outlined"
            />
          )}
          <TextField
            size="small"
            placeholder="Search roles or restrictions…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            sx={{ width: { xs: '100%', sm: 260 } }}
          />
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(e, val) => { if (val !== null) setViewMode(val); }}
            size="small"
            sx={{ height: 38 }}
          >
            <ToggleButton value="compact" sx={{ textTransform: 'none', fontWeight: 600, px: 2 }}>
              Compact
            </ToggleButton>
            <ToggleButton value="detailed" sx={{ textTransform: 'none', fontWeight: 600, px: 2 }}>
              Detailed
            </ToggleButton>
          </ToggleButtonGroup>
          <Button 
            variant="contained" 
            color="primary" 
            onClick={onCreateRole} 
            disabled={permissions && !permissions.canManageSingleRoles && !permissions.canManageOrgRoles}
            startIcon={<Plus size={15} />}
          >
            Create Role
          </Button>
        </Box>
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

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress size={40} /></Box>
      ) : rootRoles.length === 0 ? (
        <Card sx={{ py: 8, textAlign: 'center' }}>
          <Box sx={{ opacity: 0.5, mb: 2 }}><Shield size={40} /></Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>No roles yet</Typography>
          <Typography variant="body2" color="text.secondary">Generate an Org Role from the Org Structure view, or create a new role in the wizard.</Typography>
        </Card>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {isFilterActive ? (
            filteredRoles.length === 0 ? (
              <Card sx={{ p: 4, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">No matching roles or restrictions found.</Typography>
              </Card>
            ) : (
              filteredRoles.map(r => (
                <RoleCard
                  key={r.ID}
                  role={r}
                  allRoles={roles}
                  orgNodes={orgNodes}
                  depth={0}
                  onDerive={onDeriveRole}
                  onEdit={onEditRole}
                  onRefresh={load}
                  isSearchActive={true}
                  onError={msg => setSnackbar({ open: true, message: msg, severity: 'error' })}
                  onAssign={setAssigningRole}
                  isCompact={viewMode === 'compact'}
                  permissions={permissions}
                />
              ))
            )
          ) : (
            rootRoles.map(r => (
              <RoleCard
                key={r.ID}
                role={r}
                allRoles={roles}
                orgNodes={orgNodes}
                depth={0}
                onDerive={onDeriveRole}
                onEdit={onEditRole}
                onRefresh={load}
                onError={msg => setSnackbar({ open: true, message: msg, severity: 'error' })}
                onAssign={setAssigningRole}
                isCompact={viewMode === 'compact'}
                permissions={permissions}
              />
            ))
          )}
        </Box>
      )}

      {/* Assign User Dialog */}
      <Dialog open={Boolean(assigningRole)} onClose={() => { if (!assigningLoading) setAssigningRole(null); }} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 700 }}>Assign User to Role</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Assign role <strong>{assigningRole?.name}</strong> to a user or group.
          </Typography>
          <TextField
            label="User ID / Group ID"
            fullWidth
            required
            size="small"
            placeholder="e.g. US12345"
            value={assignForm.userId}
            onChange={e => setAssignForm(prev => ({ ...prev, userId: e.target.value }))}
            disabled={assigningLoading}
            sx={{ mt: 1 }}
          />
          <TextField
            label="User Name"
            fullWidth
            size="small"
            placeholder="e.g. John Doe"
            value={assignForm.userName}
            onChange={e => setAssignForm(prev => ({ ...prev, userName: e.target.value }))}
            disabled={assigningLoading}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 1 }}>
          <Button onClick={() => setAssigningRole(null)} disabled={assigningLoading} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleAssignSubmit} disabled={assigningLoading || !assignForm.userId.trim()} variant="contained" color="primary">
            {assigningLoading ? 'Assigning...' : 'Assign'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
