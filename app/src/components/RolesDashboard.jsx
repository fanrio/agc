import { useState, useEffect } from 'react';
import { Box, Card, Typography, Button, IconButton, TextField, Collapse, Grid, Chip, CircularProgress, Alert, Snackbar, Dialog, DialogTitle, DialogContent, DialogActions, ToggleButton, ToggleButtonGroup, FormControlLabel, Checkbox } from '@mui/material';
import { Shield, GitBranch, Users, Trash2, ChevronRight, ChevronDown, Eye, Edit3, Plus } from 'lucide-react';
import * as api from '../api';
import { RestrictionDisplay } from './RestrictionBuilder';

// Helper to format ISO datetime strings
function formatDateTime(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  return date.toLocaleString(undefined, { 
    dateStyle: 'short', 
    timeStyle: 'short' 
  });
}

// Helper to determine if a specific restriction is critical
function isCriticalRestriction(r, orgNodes) {
  const type = r.filterType;
  const val = r.value || '';
  if (type === 'SINGLE_VALUE') {
    return val.toUpperCase() === 'ALL';
  }
  if (type === 'MULTI_VALUE') {
    try {
      const arr = JSON.parse(val);
      if (Array.isArray(arr) && arr.some(v => String(v).toUpperCase() === 'ALL')) {
        return true;
      }
    } catch (e) {
      if (val.toUpperCase() === 'ALL') return true;
    }
  }
  if (type === 'PATTERN') {
    return val.includes('*');
  }
  if (type === 'HIERARCHY') {
    const node = orgNodes.find(n => n.ID === val);
    if (node) {
      return !node.parent_ID && (!node.parent || !node.parent.ID);
    }
  }
  return false;
}

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

function RoleCard({ role, allRoles, orgNodes = [], depth = 0, onDerive, onEdit, onDelete, onRefresh, isSearchActive = false, onError, onAssign, isCompact, permissions }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [showEffective, setShowEffective] = useState(false);
  const [effective, setEffective] = useState(null);
  const [loading, setLoading] = useState(false);

  const children = allRoles.filter(r => r.parentRoles && r.parentRoles.some(pr => pr.parent_ID === role.ID));

  async function loadEffective() {
    if (effective) { setShowEffective(s => !s); return; }
    setLoading(true);
    try {
      const data = await api.resolveEffective(role.ID);
      setEffective(data);
      setShowEffective(true);
    } catch(e) { onError(e.message); }
    setLoading(false);
  }

  async function handleDelete() {
    if (children.length > 0) { onError('Cannot delete a role that has child roles. Delete children first.'); return; }
    if (!confirm(`Delete role "${role.name}"?`)) return;
    setLoading(true);
    try {
      await api.deleteRole(role.ID);
      await onRefresh();
    } catch(e) { onError(e.message); }
    setLoading(false);
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Card sx={{ ml: depth * 3, p: 2.5, position: 'relative' }}>
        {/* Card Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: isCompact ? 1.5 : 1.5 }}>
          {children.length > 0 && !isSearchActive && (
            <IconButton onClick={() => setExpanded(e => !e)} size="small" sx={{ p: 0, color: 'text.secondary' }}>
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </IconButton>
          )}
          <Shield size={16} color={role.type === 'ORG_BASED' ? '#3b82f6' : '#a78bfa'} />
          <Typography variant="body1" sx={{ fontWeight: 700, fontFamily: 'monospace', flexGrow: 1 }} noWrap>
            {role.name}
          </Typography>
          <Chip
            label={role.type === 'ORG_BASED' ? 'Org Role' : (role.parentRoles && role.parentRoles.length > 0 ? 'Derived' : 'Single')}
            size="small"
            color={role.type === 'ORG_BASED' ? 'primary' : 'secondary'}
            variant="outlined"
            sx={{ height: 20, fontSize: 10 }}
          />
          {role.critical && (
            <Chip
              label="Critical"
              size="small"
              color="error"
              sx={{ height: 20, fontSize: 10, fontWeight: 600 }}
            />
          )}
          {depth > 0 && (
            <Chip
              label={`L${depth}`}
              size="small"
              sx={{ height: 20, fontSize: 10, bgcolor: 'rgba(255,255,255,0.05)', color: 'text.secondary' }}
            />
          )}
        </Box>

        {!isCompact && role.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {role.description}
          </Typography>
        )}

        {/* Own restrictions */}
        {!isCompact && role.ownRestrictions && role.ownRestrictions.length > 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 2 }}>
            {role.ownRestrictions.map(r => (
              <RestrictionDisplay key={r.ID} restriction={r} isOwn={true} />
            ))}
          </Box>
        )}

        {/* Assigned users */}
        {!isCompact && role.assignments && role.assignments.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Users size={14} color="#94a3b8" />
            <Typography variant="caption" color="text.secondary">
              Assigned: {role.assignments.map(a => a.userName || a.userId).join(', ')}
            </Typography>
          </Box>
        )}

        {/* Approvers */}
        {!isCompact && role.approvers && role.approvers.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Shield size={14} color="#a78bfa" />
            <Typography variant="caption" sx={{ color: '#a78bfa' }}>
              Approvers: {role.approvers.map(a => a.userName || a.userId).join(', ')}
            </Typography>
          </Box>
        )}

        {/* Managed Metadata */}
        {!isCompact && (
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2, fontSize: 10, color: 'text.secondary', opacity: 0.8 }}>
            <Box>
              Created: <Box component="span" sx={{ color: 'text.primary' }}>{formatDateTime(role.createdAt)}</Box> by <Box component="span" sx={{ color: 'text.primary' }}>{role.createdBy || 'seed'}</Box>
            </Box>
            {role.modifiedAt && role.modifiedAt !== role.createdAt && (
              <Box>
                · Modified: <Box component="span" sx={{ color: 'text.primary' }}>{formatDateTime(role.modifiedAt)}</Box> by <Box component="span" sx={{ color: 'text.primary' }}>{role.modifiedBy || 'seed'}</Box>
              </Box>
            )}
          </Box>
        )}

        {/* Action Buttons */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button size="small" variant="text" color="inherit" onClick={loadEffective} disabled={loading} startIcon={<Eye size={13} />}>
            {showEffective ? 'Hide' : 'View'} Effective
          </Button>
          <Button 
            size="small" 
            variant="text" 
            color="primary" 
            onClick={() => onEdit(role.ID)} 
            disabled={permissions && (
              role.type === 'ORG_BASED' ? !permissions.canManageOrgRoles :
              (role.parentRoles && role.parentRoles.length > 0) ? !permissions.canManageDerivedRoles : !permissions.canManageSingleRoles
            )}
            startIcon={<Edit3 size={13} />}
          >
            Edit
          </Button>
          <Button 
            size="small" 
            variant="outlined" 
            color="secondary" 
            onClick={() => onDerive(role.ID)} 
            disabled={permissions && !permissions.canManageDerivedRoles}
            startIcon={<GitBranch size={13} />}
          >
            Derive Child Role
          </Button>
          <Button
            size="small"
            variant="contained"
            color="primary"
            onClick={() => onAssign(role)}
            disabled={(permissions && !permissions.canAssignRoles) || !hasAnyRestrictions(role, allRoles)}
            startIcon={<Users size={13} />}
          >
            Assign User
          </Button>
          <IconButton 
            size="small" 
            color="error" 
            onClick={handleDelete} 
            disabled={loading || (permissions && (
              role.type === 'ORG_BASED' ? !permissions.canManageOrgRoles :
              (role.parentRoles && role.parentRoles.length > 0) ? !permissions.canManageDerivedRoles : !permissions.canManageSingleRoles
            ))} 
            sx={{ ml: 'auto' }}
          >
            <Trash2 size={15} />
          </IconButton>
        </Box>

        {/* Effective Restrictions Collapse */}
        <Collapse in={showEffective}>
          {effective && (
            <Box sx={{ mt: 2.5, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', mb: 1.5, color: 'text.secondary' }}>
                Effective Restriction Chain ({effective.length} total)
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {effective.map((r, i) => (
                  <RestrictionDisplay
                    key={i}
                    restriction={{ ...r, field: r.field, filterType: r.filterType, value: r.value, sourceRoleName: r.sourceRoleName }}
                    isOwn={r.isOwn}
                  />
                ))}
              </Box>
            </Box>
          )}
        </Collapse>
      </Card>

      {/* Children */}
      {expanded && !isSearchActive && children.map(child => (
        <RoleCard
          key={child.ID}
          role={child}
          allRoles={allRoles}
          orgNodes={orgNodes}
          depth={depth + 1}
          onDerive={onDerive}
          onEdit={onEdit}
          onDelete={onDelete}
          onRefresh={onRefresh}
          isSearchActive={isSearchActive}
          onError={onError}
          onAssign={onAssign}
          isCompact={isCompact}
          permissions={permissions}
        />
      ))}
    </Box>
  );
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
            sx={{ width: 260 }}
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
