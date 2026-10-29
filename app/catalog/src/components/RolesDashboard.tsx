import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Alert,
  Snackbar,
  ToggleButton,
  ToggleButtonGroup,
  Card,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TablePagination
} from '@mui/material';
import { Shield, Plus, GitBranch, LayoutGrid, Table as TableIcon } from 'lucide-react';
import * as api from '../api';
import RoleCard from './RoleCard';
import RoleTableView from './RoleTableView';
import RoleTreeView from './RoleTreeView';
import { usePermissions } from '../context/PermissionsContext';
import EnvironmentSelection from './EnvironmentSelection';
import SearchableSelect from './SearchableSelect';

const ROLE_TYPE_OPTIONS = [
  { value: 'ALL', label: 'All Types' },
  { value: 'SINGLE', label: 'Single Role' },
  { value: 'DERIVED', label: 'Derived Role' },
  { value: 'ORG_BASED', label: 'Org-Based Role' }
];

export default function RolesDashboard({ onDeriveRole, onEditRole, onCreateRole, initialFilter, setInitialFilter }: any) {
  const { permissions } = usePermissions();
  const [allRoles, setAllRoles] = useState<any[]>(() => {
    const cached = api.peekCachedGet(api.ROLES_EXPAND_PATH);
    return Array.isArray(cached) ? cached : [];
  });
  const [hasLoaded, setHasLoaded] = useState<boolean>(() => Array.isArray(api.peekCachedGet(api.ROLES_EXPAND_PATH)));
  const [searchQuery, setSearchQuery] = useState('');
  const [healthFilter, setHealthFilter] = useState<string | null>(initialFilter || null);
  const [envFilter, setEnvFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  useEffect(() => {
    if (initialFilter) {
      setHealthFilter(initialFilter);
      setPage(0);
    }
  }, [initialFilter]);

  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'info' | 'warning' | 'error';
  }>({ open: false, message: '', severity: 'error' });
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; role: any }>({ open: false, role: null });

  // Toggle representation states ('tree', 'grid', 'table')
  const [viewMode, setViewMode] = useState<'tree' | 'grid' | 'table'>('table');

  const handleDeleteClick = useCallback((role: any) => {
    setDeleteConfirm({ open: true, role });
  }, []);

  const handleError = useCallback((msg: string) => {
    setSnackbar({ open: true, message: msg, severity: 'error' });
  }, []);

  const handleSuccess = useCallback((msg: string) => {
    setSnackbar({ open: true, message: msg, severity: 'success' });
  }, []);

  const handleCloseSnackbar = (_event?: any, reason?: string) => {
    if (reason === 'clickaway') return;
    setSnackbar((prev) => ({ ...prev, open: false }));
  };

  const load = useCallback(async () => {
    try {
      const rolesRes = await api.getRoles();
      if (Array.isArray(rolesRes)) {
        setAllRoles(rolesRes);
      } else if (rolesRes && typeof rolesRes === 'object' && 'value' in rolesRes) {
        setAllRoles(rolesRes.value || []);
      }
    } catch (e) {
      console.error('Failed to load roles from OData service:', e);
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDeleteConfirm = async () => {
    const roleId = deleteConfirm.role?.ID;
    if (!roleId) return;
    try {
      await api.deleteRole(roleId);
      setAllRoles((prev) => prev.filter((r) => r.ID !== roleId));
      setSnackbar({ open: true, message: 'Role deleted successfully', severity: 'success' });
      load();
    } catch (e: any) {
      setSnackbar({ open: true, message: e.message || 'Failed to delete role', severity: 'error' });
    } finally {
      setDeleteConfirm({ open: false, role: null });
    }
  };

  // Instant 0ms in-memory filtering across all roles
  const filteredRoles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const hasEnv = envFilter.length > 0;
    const hasType = typeFilter !== 'ALL';

    return allRoles.filter((r) => {
      if (!r) return false;
      if (hasType && r.type !== typeFilter) return false;
      if (hasEnv && !envFilter.includes(r.environment_ID)) return false;

      if (healthFilter) {
        if (healthFilter === 'unrestricted') {
          if (r.ownRestrictions && r.ownRestrictions.length > 0) return false;
        } else if (healthFilter === 'no-users') {
          const count = r.assignmentsCount ?? r.assignments?.length ?? 0;
          if (count > 0) return false;
        } else if (healthFilter === 'no-approver') {
          if (r.approvers && r.approvers.length > 0) return false;
        } else if (healthFilter === 'critical') {
          if (!r.critical) return false;
        }
      }

      if (q) {
        const nameMatch = r.name && r.name.toLowerCase().includes(q);
        const descMatch = r.description && r.description.toLowerCase().includes(q);
        if (!nameMatch && !descMatch) return false;
      }

      return true;
    });
  }, [allRoles, searchQuery, envFilter, typeFilter, healthFilter]);

  const pagedRoles = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredRoles.slice(start, start + rowsPerPage);
  }, [filteredRoles, page, rowsPerPage]);

  // O(N) root role detection via Set
  const rootRoles = useMemo(() => {
    const roleIdSet = new Set<string>();
    for (let i = 0; i < pagedRoles.length; i++) {
      roleIdSet.add(pagedRoles[i].ID);
    }
    return pagedRoles.filter((r) => {
      if (!r.parentRoles || r.parentRoles.length === 0) return true;
      return !r.parentRoles.some((pr: any) => {
        const parentId = pr.parent_ID || pr.parent?.ID;
        return parentId && roleIdSet.has(parentId);
      });
    });
  }, [pagedRoles]);

  const paginatedRoots = viewMode === 'table' || viewMode === 'tree' ? rootRoles : pagedRoles;

  const handlePageChange = (_event: any, newPage: number) => {
    setPage(newPage);
  };

  const handleRowsPerPageChange = (event: any) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const isFilterActive = Boolean(searchQuery.trim() || healthFilter || envFilter.length > 0 || typeFilter !== 'ALL');

  return (
    <Box>
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
            onChange={(_e, val) => { if (val !== null) setViewMode(val); }}
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
            disabled={Boolean(permissions && !permissions.canManageSingleRoles && !permissions.canManageOrgRoles)}
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
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(0);
          }}
          sx={{ width: { xs: '100%', sm: 260 } }}
        />

        <EnvironmentSelection
          value={envFilter}
          onChange={(val) => {
            setEnvFilter(val);
            setPage(0);
          }}
          multiple={true}
          sx={{ minWidth: 160 }}
          fullWidth={false}
        />

        <SearchableSelect
          options={ROLE_TYPE_OPTIONS}
          value={typeFilter}
          onChange={(val) => {
            setTypeFilter(val);
            setPage(0);
          }}
          label="Role Type"
          sx={{ minWidth: 160 }}
        />

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
              setPage(0);
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
              setPage(0);
              if (setInitialFilter) setInitialFilter(null);
            }}
          >
            Reset Filters
          </Button>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', fontWeight: 600 }}>
          Showing {pagedRoles.length} of {filteredRoles.length} roles
        </Typography>
      </Card>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>

      {hasLoaded && allRoles.length === 0 ? (
        <Card sx={{ py: 8, textAlign: 'center' }}>
          <Box sx={{ opacity: 0.5, mb: 2 }}><Shield size={40} /></Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>No roles yet</Typography>
          <Typography variant="body2" color="text.secondary">Generate an Org Role from the Org Structure view, or create a new role in the wizard.</Typography>
        </Card>
      ) : (
        <>
          {viewMode === 'table' && (
            <RoleTableView
              roles={paginatedRoots}
              allRoles={filteredRoles}
              onDerive={onDeriveRole}
              onEdit={onEditRole}
              onDelete={handleDeleteClick}
              onRefresh={load}
              onError={handleError}
              onSuccess={handleSuccess}
              permissions={permissions}
            />
          )}

          {viewMode === 'tree' && (
            <RoleTreeView
              roles={paginatedRoots}
              allRoles={filteredRoles}
              onDeriveRole={onDeriveRole}
              onEditRole={onEditRole}
              onRefresh={load}
              onError={handleError}
              onSuccess={handleSuccess}
              permissions={permissions}
            />
          )}

          {viewMode === 'grid' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)' }, gap: 2 }}>
              {pagedRoles.map((r) => (
                <RoleCard
                  key={r.ID}
                  role={r}
                  allRoles={filteredRoles}
                  depth={0}
                  onDerive={onDeriveRole}
                  onEdit={onEditRole}
                  onRefresh={load}
                  onError={handleError}
                  onSuccess={handleSuccess}
                  isCompact={true}
                  permissions={permissions}
                />
              ))}
            </Box>
          )}
        </>
      )}

      {filteredRoles.length > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
          <TablePagination
            rowsPerPageOptions={[10, 25, 50, 100]}
            component="div"
            count={filteredRoles.length}
            rowsPerPage={rowsPerPage}
            page={page}
            onPageChange={handlePageChange}
            onRowsPerPageChange={handleRowsPerPageChange}
            sx={{ borderTop: 'none', color: 'text.secondary' }}
          />
        </Box>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm.open && (
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
      )}
    </Box>
  );
}
