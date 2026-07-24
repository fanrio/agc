import { useState, useEffect } from 'react';
import { Box, Typography, Button, TextField, Alert, Snackbar, ToggleButton, ToggleButtonGroup, Card, Skeleton, Chip, MenuItem, Select, FormControl, InputLabel, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { Shield, Plus, GitBranch, LayoutGrid, Table as TableIcon } from 'lucide-react';
import * as api from '../api';
import RoleCard from './RoleCard';
import RoleTableView from './RoleTableView';
import RoleTreeView from './RoleTreeView';
import { isCriticalRestriction, isRoleInScope, filterRolesByPermissions } from '../utils/helpers';
import { usePermissions } from '../context/PermissionsContext';
import EnvironmentSelection from './EnvironmentSelection';

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

export default function RolesDashboard({ onDeriveRole, onEditRole, onCreateRole, initialFilter, setInitialFilter }) {
  const { permissions } = usePermissions();
  const [roles, setRoles] = useState([]);
  const [orgNodes, setOrgNodes] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [healthFilter, setHealthFilter] = useState(initialFilter || null);
  const [envFilter, setEnvFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState('ALL');
  console.log(initialFilter);
  useEffect(() => {
    if (initialFilter) {
      setHealthFilter(initialFilter);
    }
  }, [initialFilter]);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'error' });
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, role: null });

  // Toggle representation states ('tree', 'grid', 'table')
  const [viewMode, setViewMode] = useState('table');

  const handleDeleteClick = (role) => {
    setDeleteConfirm({ open: true, role });
  };

  const handleDeleteConfirm = async () => {
    const roleId = deleteConfirm.role?.ID;
    if (!roleId) return;
    try {
      await api.deleteRole(roleId);
      setSnackbar({ open: true, message: 'Role deleted successfully', severity: 'success' });
      load();
    } catch (e) {
      setSnackbar({ open: true, message: e.message || 'Failed to delete role', severity: 'error' });
    } finally {
      setDeleteConfirm({ open: false, role: null });
    }
  };

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
      setRoles(filterRolesByPermissions(rolesData, permissions));
      setOrgNodes(nodesData);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const parseEnvironments = (val) => {
    if (!val || val === 'ALL' || val === '*') return 'ALL';
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      return val.split(',').map(s => s.trim().toUpperCase());
    }
    return [];
  };

  const visibleRoles = roles;

  // Apply environment & type filters
  const envFilteredRoles = visibleRoles.filter(role => {
    if (envFilter.length > 0 && !envFilter.includes(role.environment_ID)) return false;
    if (typeFilter !== 'ALL' && role.type !== typeFilter) return false;
    return true;
  });

  // Apply health filters
  const healthFilteredRoles = envFilteredRoles.filter(role => {
    console.log(role);
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

  const isFilterActive = Boolean(searchQuery.trim() || healthFilter || envFilter.length > 0 || typeFilter !== 'ALL');

  return (
    <Box sx={{ animation: 'fadeIn 0.3s' }}>
      {/* Page Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>Roles & Governance Catalog</Typography>
          <Typography variant="body2" color="text.secondary">Manage authorizations across Tree Hierarchy, Card Grid, and Data Table views</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* View mode switcher */}
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(e, val) => { if (val !== null) setViewMode(val); }}
            size="small"
            sx={{ height: 38 }}
          >
            <ToggleButton value="tree" sx={{ textTransform: 'none', fontWeight: 600, px: 1.5, gap: 0.8 }}>
              <GitBranch size={15} /> Tree
            </ToggleButton>
            <ToggleButton value="grid" sx={{ textTransform: 'none', fontWeight: 600, px: 1.5, gap: 0.8 }}>
              <LayoutGrid size={15} /> Grid
            </ToggleButton>
            <ToggleButton value="table" sx={{ textTransform: 'none', fontWeight: 600, px: 1.5, gap: 0.8 }}>
              <TableIcon size={15} /> Table
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

      {/* Filter Toolbar */}
      <Card variant="outlined" sx={{ p: 1.5, mb: 3, borderRadius: 2, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', bgcolor: 'background.paper' }}>
        <TextField
          size="small"
          placeholder="Search roles or restrictions…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          sx={{ width: { xs: '100%', sm: 260 } }}
        />

        <EnvironmentSelection
          value={envFilter}
          onChange={setEnvFilter}
          multiple={true}
          sx={{ minWidth: 160 }}
          fullWidth={false}
        />

        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Role Type</InputLabel>
          <Select value={typeFilter} label="Role Type" onChange={e => setTypeFilter(e.target.value)}>
            <MenuItem value="ALL">All Types</MenuItem>
            <MenuItem value="SINGLE">Single Role</MenuItem>
            <MenuItem value="DERIVED">Derived Role</MenuItem>
            <MenuItem value="ORG_BASED">Org-Based Role</MenuItem>
          </Select>
        </FormControl>

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
            color="warning"
            variant="outlined"
          />
        )}

        {isFilterActive && (
          <Button
            size="small"
            color="secondary"
            onClick={() => {
              setSearchQuery('');
              setEnvFilter([]);
              setTypeFilter('ALL');
              setHealthFilter(null);
              if (setInitialFilter) setInitialFilter(null);
            }}
          >
            Reset Filters
          </Button>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', fontWeight: 600 }}>
          Showing {filteredRoles.length} of {visibleRoles.length} roles
        </Typography>
      </Card>

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
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[1, 2, 3, 4].map(idx => (
            <Card key={idx} variant="outlined" sx={{ p: 2.5, borderRadius: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Skeleton variant="circular" width={40} height={40} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton variant="text" width="40%" height={24} />
                  <Skeleton variant="text" width="60%" height={18} />
                </Box>
                <Skeleton variant="rectangular" width={100} height={32} sx={{ borderRadius: 1.5 }} />
              </Box>
            </Card>
          ))}
        </Box>
      ) : visibleRoles.length === 0 ? (
        <Card sx={{ py: 8, textAlign: 'center' }}>
          <Box sx={{ opacity: 0.5, mb: 2 }}><Shield size={40} /></Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>No roles yet</Typography>
          <Typography variant="body2" color="text.secondary">Generate an Org Role from the Org Structure view, or create a new role in the wizard.</Typography>
        </Card>
      ) : (
        <>
          {viewMode === 'table' && (
            <RoleTableView
              roles={filteredRoles}
              allRoles={roles}
              orgNodes={orgNodes}
              onDerive={onDeriveRole}
              onEdit={onEditRole}
              onDelete={handleDeleteClick}
              onRefresh={load}
              onError={msg => setSnackbar({ open: true, message: msg, severity: 'error' })}
              onSuccess={msg => setSnackbar({ open: true, message: msg, severity: 'success' })}
              permissions={permissions}
            />
          )}

          {viewMode === 'tree' && (
            <RoleTreeView
              roles={filteredRoles}
              allRoles={roles}
              orgNodes={orgNodes}
              onDeriveRole={onDeriveRole}
              onEditRole={onEditRole}
              onRefresh={load}
              onError={msg => setSnackbar({ open: true, message: msg, severity: 'error' })}
              onSuccess={msg => setSnackbar({ open: true, message: msg, severity: 'success' })}
              permissions={permissions}
            />
          )}

          {viewMode === 'grid' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)' }, gap: 2 }}>
              {filteredRoles.map(r => (
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
                  onSuccess={msg => setSnackbar({ open: true, message: msg, severity: 'success' })}
                  isCompact={true}
                  permissions={permissions}
                />
              ))}
            </Box>
          )}
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, role: null })}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Delete Role</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Are you sure you want to delete role "{deleteConfirm.role?.name}"? This action cannot be undone and will remove all assignments.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteConfirm({ open: false, role: null })} color="inherit">Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

