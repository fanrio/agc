import { useState, useEffect } from 'react';
import { Box, Card, Typography, Button, IconButton, TextField, Collapse, Grid, Chip, CircularProgress, Alert, Snackbar, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, ToggleButton, ToggleButtonGroup, FormControlLabel, Checkbox } from '@mui/material';
import { Shield, GitBranch, Users, Trash2, ChevronRight, ChevronDown, Eye, Edit3, Plus, AlertTriangle } from 'lucide-react';
import * as api from '../api';
import { RestrictionDisplay } from './RestrictionBuilder';

const ENV_LABEL = {
  P: 'Production',
  Q: 'Quality Assurance',
  D: 'Development'
};

const ENV_COLOR = {
  P: 'error',
  Q: 'warning',
  D: 'info'
};

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

function RoleCard({ role, allRoles, orgNodes = [], depth = 0, onDerive, onEdit, onDelete, onRefresh, isSearchActive = false, onError, onAssign, isCompact, permissions }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [showEffective, setShowEffective] = useState(false);
  const [effective, setEffective] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const getDescendantsAndUsers = (roleId, rolesList) => {
    const descendantRoles = [];
    const queue = [roleId];
    const visited = new Set([roleId]);
    while (queue.length > 0) {
      const currId = queue.shift();
      const children = rolesList.filter(r => r.parentRoles && r.parentRoles.some(pr => pr.parent_ID === currId));
      for (const child of children) {
        if (!visited.has(child.ID)) {
          visited.add(child.ID);
          descendantRoles.push(child);
          queue.push(child.ID);
        }
      }
    }

    const allRoleIds = [roleId, ...descendantRoles.map(r => r.ID)];
    const affectedUsers = [];
    const userVisited = new Set();
    rolesList.forEach(r => {
      if (allRoleIds.includes(r.ID) && r.assignments) {
        r.assignments.forEach(a => {
          const userKey = `${a.userId}-${r.ID}`;
          if (!userVisited.has(userKey)) {
            userVisited.add(userKey);
            affectedUsers.push({
              userId: a.userId,
              userName: a.userName,
              roleName: r.name
            });
          }
        });
      }
    });

    return { descendantRoles, affectedUsers };
  };

  const { descendantRoles, affectedUsers } = getDescendantsAndUsers(role.ID, allRoles);

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
    setConfirmDeleteOpen(true);
  }

  async function executeDelete() {
    setConfirmDeleteOpen(false);
    setLoading(true);
    try {
      await api.deleteRole(role.ID);
      await onRefresh();
    } catch(e) { onError(e.message); }
    setLoading(false);
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Card sx={{ ml: { xs: Math.min(depth, 1) * 1.5, sm: depth * 3 }, p: 2.5, position: 'relative' }}>
        {/* Card Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: isCompact ? 1.5 : 1.5 }}>
          {children.length > 0 && !isSearchActive && (
            <IconButton onClick={() => setExpanded(e => !e)} size="small" sx={{ p: 0, color: 'text.secondary' }}>
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </IconButton>
          )}
          <Shield size={16} color={role.type === 'ORG_BASED' ? '#1d4ed8' : '#7c3aed'} />
          <Typography variant="body1" sx={{ fontWeight: 700, fontFamily: 'monospace', flexGrow: 1 }} noWrap>
            {role.name}
          </Typography>
          <Chip
            label={role.type === 'ORG_BASED' ? 'Org Role' : (role.parentRoles && role.parentRoles.length > 0 ? 'Derived' : 'Single')}
            size="small"
            color={role.type === 'ORG_BASED' ? 'primary' : 'secondary'}
            variant="outlined"
            sx={{ height: 20, fontSize: 12 }}
          />
          {role.environment && (
            <Chip
              label={role.environment.name || role.environment_ID}
              size="small"
              color={ENV_COLOR[role.environment_ID] || "default"}
              sx={{ height: 20, fontSize: 12 }}
            />
          )}
          {role.critical && (
            <Chip
              label="Critical"
              size="small"
              color="error"
              sx={{ height: 20, fontSize: 12, fontWeight: 600 }}
            />
          )}
          {depth > 0 && (
            <Chip
              label={`L${depth}`}
              size="small"
              sx={{ height: 20, fontSize: 12, bgcolor: 'action.hover', color: 'text.secondary' }}
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
            <Users size={14} color="#64748b" />
            <Typography variant="caption" color="text.secondary">
              Assigned: {role.assignments.map(a => a.userName || a.userId).join(', ')}
            </Typography>
          </Box>
        )}

        {/* Approvers */}
        {!isCompact && role.approvers && role.approvers.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Shield size={14} color="#7c3aed" />
            <Typography variant="caption" sx={{ color: '#7c3aed' }}>
              Approvers: {role.approvers.map(a => a.userName || a.userId).join(', ')}
            </Typography>
          </Box>
        )}

        {/* Managed Metadata */}
        {!isCompact && (
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2, fontSize: 12, color: 'text.secondary', opacity: 0.8 }}>
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
              (role.parentRoles && role.parentRoles.length > 0) ? !canManageThisDerivedRole(role, permissions, allRoles) : !permissions.canManageSingleRoles
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
            disabled={permissions && !canDeriveFromRole(role, permissions)}
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
              (role.parentRoles && role.parentRoles.length > 0) ? !canManageThisDerivedRole(role, permissions, allRoles) : !permissions.canManageSingleRoles
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

      {/* Confirm Delete Dialog */}
      <Dialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        aria-labelledby="confirm-delete-dialog-title"
        aria-describedby="confirm-delete-dialog-description"
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
          <AlertTriangle color="#d32f2f" size={24} />
          <Typography component="span" variant="h6" sx={{ fontWeight: 700 }}>
            Confirm Deletion & Analyze Impact
          </Typography>
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 3 }}>
            Are you sure you want to delete role <strong>{role.name}</strong>? This action cannot be undone.
            {(descendantRoles.length > 0 || affectedUsers.length > 0) && (
              <Box component="span" sx={{ display: 'block', mt: 1, color: 'error.main', fontWeight: 600 }}>
                Warning: Deleting this role will also delete all of its derived roles and active user assignments.
              </Box>
            )}
          </DialogContentText>

          {(descendantRoles.length > 0 || affectedUsers.length > 0) && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3, mt: 1 }}>
              {/* Derived Roles Panel */}
              <Card variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <GitBranch size={18} color="#0288d1" />
                    Derived Roles to Delete
                  </Typography>
                  <Chip
                    label={descendantRoles.length}
                    size="small"
                    color="info"
                    sx={{ fontWeight: 600 }}
                  />
                </Box>
                {descendantRoles.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', py: 1 }}>
                    No derived roles will be affected.
                  </Typography>
                ) : (
                  <Box sx={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {descendantRoles.map(r => (
                      <Card key={r.ID} sx={{ p: 1.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{r.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{r.description || 'No description'}</Typography>
                      </Card>
                    ))}
                  </Box>
                )}
              </Card>

              {/* Affected Users Panel */}
              <Card variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Users size={18} color="#2e7d32" />
                    Assigned Users Affected
                  </Typography>
                  <Chip
                    label={affectedUsers.length}
                    size="small"
                    color="success"
                    sx={{ fontWeight: 600 }}
                  />
                </Box>
                {affectedUsers.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', py: 1 }}>
                    No assigned users will be affected.
                  </Typography>
                ) : (
                  <Box sx={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {affectedUsers.map(u => (
                      <Card key={`${u.userId}-${u.roleName}`} sx={{ p: 1.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{u.userName}</Typography>
                          <Chip label={u.userId} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 20 }} />
                        </Box>
                        <Typography variant="caption" color="text.secondary">
                          Assigned Role: <Box component="span" sx={{ fontFamily: 'monospace' }}>{u.roleName}</Box>
                        </Typography>
                      </Card>
                    ))}
                  </Box>
                )}
              </Card>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteOpen(false)} color="inherit">
            Cancel
          </Button>
          <Button onClick={executeDelete} color="error" variant="contained" autoFocus>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
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
