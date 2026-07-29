import { useState, useMemo } from 'react';
import { 
  Box, Card, Typography, Button, IconButton, TextField, Collapse, Chip, 
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Alert, Grid, Tooltip
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import PrivateConnectivityIcon from '@mui/icons-material/PrivateConnectivity';
import { Shield, GitBranch, Users, Trash2, ChevronRight, ChevronDown, Eye, Edit3, Plus, AlertTriangle } from 'lucide-react';
import * as api from '../api';
import { RestrictionDisplay } from './RestrictionBuilder';
import { ENV_LABEL, ENV_COLOR, formatDateTime, isCriticalRestriction, isRoleInScope } from '../utils/helpers';
import { usePermissions } from '../context/PermissionsContext';
import UserRoleAssignment from './UserRoleAssignment';

export default function RoleCard({ role, allRoles, orgNodes = [], depth = 0, onDerive, onEdit, onDelete = undefined, onRefresh, isSearchActive = false, onError, onSuccess, onAssign = undefined, isCompact, permissions: propPermissions }) {
  const { permissions: contextPermissions } = usePermissions();
  const permissions = propPermissions || contextPermissions;
  if (depth > 10) {
    return (
      <Box sx={{ pl: depth * 2, mb: 1 }}>
        <Alert severity="error">
          Circular dependency or excessive nesting detected.
        </Alert>
      </Box>
    );
  }
  const [expanded, setExpanded] = useState(depth < 1);
  const [showEffective, setShowEffective] = useState(false);
  const [effective, setEffective] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);

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
      if (allRoleIds.includes(r.ID) && Array.isArray(r.assignments)) {
        r.assignments.forEach(a => {
          if (!userVisited.has(a.userId)) {
            userVisited.add(a.userId);
            affectedUsers.push(a.userId);
          }
        });
      }
    });

    return {
      descendants: descendantRoles,
      users: affectedUsers
    };
  };

  const getRoleDirectChildren = (roleId, rolesList) => {
    return rolesList.filter(r => r.parentRoles && r.parentRoles.some(pr => pr.parent_ID === roleId));
  };

  const fetchEffective = async () => {
    if (showEffective) {
      setShowEffective(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api.resolveEffective(role.ID);
      setEffective(data || []);
      setShowEffective(true);
    } catch (err) {
      if (onError) onError(err.message);
    }
    setLoading(false);
  };

  const childrenRoles = useMemo(() => getRoleDirectChildren(role.ID, allRoles), [role.ID, allRoles]);
  const { descendants, users } = useMemo(() => {
    if (!confirmDeleteOpen) return { descendants: [], users: [] };
    return getDescendantsAndUsers(role.ID, allRoles);
  }, [confirmDeleteOpen, role.ID, allRoles]);

  // Check if role is critical
  const isCritical = useMemo(() => {
    const directCritical = Array.isArray(role.ownRestrictions) && role.ownRestrictions.some(r => isCriticalRestriction(r, orgNodes));
    return role.critical || directCritical;
  }, [role.critical, role.ownRestrictions, orgNodes]);

  const executeDelete = async () => {
    try {
      await api.deleteRole(role.ID);
      setConfirmDeleteOpen(false);
      if (onRefresh) onRefresh();
    } catch (err) {
      if (onError) onError(err.message);
    }
  };

  const orgNodeName = role.orgNode ? (role.orgNode.name || role.orgNode.ID) : null;
  const assignmentsCount = Array.isArray(role.assignments) ? role.assignments.length : 0;

  // Authorization checks
  const canManageOrgRoles = permissions?.canManageOrgRoles;
  const canManageSingleRoles = permissions?.canManageSingleRoles;
  const canManageDerivedRoles = permissions?.canManageDerivedRoles;
  const canAssignRoles = permissions?.canAssignRoles;

  const isOrgRole = role.type === 'ORG_BASED';
  const isDerived = role.type === 'DERIVED';
  const isDrageRole = role.type === 'DRAGE';

  // Wizard derive scopes checks
  const canDeriveFromRole = (role) => {
    if (permissions?.isSuperAdmin) return true;
    if (!canManageDerivedRoles) return false;
    return isRoleInScope(role.ID, role.name, permissions?.managedDerivedRolesScope);
  };

  const canManageThisDerivedRole = (role) => {
    if (permissions?.isSuperAdmin) return true;
    if (!canManageDerivedRoles) return false;
    if (role.type !== 'DERIVED') return false;
    
    if (!role.parentRoles || role.parentRoles.length === 0) return false;
    return role.parentRoles.every(pr => {
      const parentId = pr.parent_ID || pr.parent?.ID;
      if (!parentId) return false;
      const parent = allRoles.find(r => r.ID === parentId);
      if (!parent) return false;
      return isRoleInScope(parent.ID, parent.name, permissions?.managedDerivedRolesScope);
    });
  };

  const isUserApprover = Array.isArray(role.approvers) && role.approvers.some(a => String(a.userId).toLowerCase() === permissions?.userId?.toLowerCase());
  const disableEdit = (() => {
    if (permissions?.isSuperAdmin) return false;
    if (isDrageRole) return true;
    if (isOrgRole) return !canManageOrgRoles;
    if (isDerived) return !canManageThisDerivedRole(role);
    return !canManageSingleRoles;
  })();
  const disableDelete = disableEdit;
  const disableDerive = permissions?.isSuperAdmin ? false : !canDeriveFromRole(role);
  const disableAssign = (() => {
    if (permissions?.isSuperAdmin) return false;
    if (isUserApprover) return false;
    if (canAssignRoles) {
      if (isOrgRole) return !canManageOrgRoles;
      if (isDerived) return !canManageThisDerivedRole(role);
      return !canManageSingleRoles;
    }
    if (isDerived && permissions?.canManageDerivedRoles && canManageThisDerivedRole(role)) {
      return false;
    }
    return true;
  })();

  if (isCompact) {
    return (
      <Box sx={{ pl: depth * 3, mb: 1 }}>
        <Card variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 2, borderColor: isCritical ? 'error.light' : 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Tooltip title={expanded ? "Collapse child roles" : "Expand child roles"}>
              <IconButton size="small" onClick={() => setExpanded(!expanded)} disabled={childrenRoles.length === 0} aria-label={expanded ? "Collapse child roles" : "Expand child roles"}>
                {childrenRoles.length > 0 ? (expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <Box sx={{ width: 28 }} />}
              </IconButton>
            </Tooltip>
            <Shield size={16} color={isCritical ? 'error.main' : 'primary.main'} />
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: isCritical ? 'error.main' : 'text.primary' }}>{role.name}</Typography>
              <Typography variant="caption" color="text.secondary">{role.description || 'No description'}</Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip size="small" label={ENV_LABEL[role.environment_ID] || role.environment_ID} color={ENV_COLOR[role.environment_ID] || 'default'} variant="outlined" />
            {isCritical && <Chip size="small" icon={<AlertTriangle size={12} />} label="Critical" color="error" />}
          </Box>
        </Card>
        {expanded && childrenRoles.map(child => (
          <RoleCard key={child.ID} role={child} allRoles={allRoles} orgNodes={orgNodes} depth={depth + 1} onDerive={onDerive} onEdit={onEdit} onDelete={onDelete} onRefresh={onRefresh} isSearchActive={isSearchActive} onError={onError} onSuccess={onSuccess} onAssign={onAssign} isCompact={isCompact} permissions={permissions} />
        ))}
      </Box>
    );
  }

  return (
    <Box sx={{ pl: depth * 4, mb: 2 }}>
      <Card variant="outlined" sx={{ borderRadius: 3, boxShadow: '0 4px 12px 0 rgba(0,0,0,0.03)', overflow: 'visible' }}>
        <Box sx={{ p: 2.5 }}>
          {/* Card header row — full-width flex */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>

            {/* Collapse toggle */}
            <Tooltip title={expanded ? "Collapse role" : "Expand role"}>
              <IconButton size="small" onClick={() => setExpanded(!expanded)} disabled={childrenRoles.length === 0 && !isSearchActive} color="primary" sx={{ flexShrink: 0 }} aria-label={expanded ? "Collapse role" : "Expand role"}>
                {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
              </IconButton>
            </Tooltip>

            {/* Shield icon */}
            <Box sx={{ flexShrink: 0, p: 1.2, borderRadius: 2, bgcolor: (t) => isCritical ? 'error.light' : alpha(t.palette.primary.main, 0.08), color: isCritical ? 'error.main' : 'primary.main', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield size={22} />
            </Box>

            {/* Name + description — grows to fill space */}
            <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>{role.name}</Typography>
                <Chip size="small" label={role.type} color="primary" variant="outlined" sx={{ fontWeight: 700, height: 20, fontSize: '0.65rem' }} />
                {role.critical && <Chip size="small" label="Critical (Manual)" color="error" sx={{ fontWeight: 700, height: 20, fontSize: '0.65rem' }} />}
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} noWrap>{role.description || 'No description provided.'}</Typography>
            </Box>

            {/* Context details — fixed width */}
            <Box sx={{ flexShrink: 0, width: 200, display: { xs: 'none', md: 'flex' }, flexDirection: 'column', gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <strong>Env:</strong> {ENV_LABEL[role.environment_ID] || role.environment_ID}
              </Typography>
              {orgNodeName && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <strong>Org Unit:</strong> {orgNodeName}
                </Typography>
              )}
              {role.type === 'DERIVED' && role.parentRoles?.[0]?.parent && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <strong>Derived from:</strong> {role.parentRoles[0].parent.name}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                <strong>Modified:</strong> {formatDateTime(role.modifiedAt)}
              </Typography>
            </Box>

            {/* Metrics chips — fixed width */}
            <Box sx={{ flexShrink: 0, display: { xs: 'none', sm: 'flex' }, gap: 0.8, flexWrap: 'wrap', width: 140, justifyContent: 'flex-start' }}>
              <Chip size="small" icon={<Users size={12} />} label={`${assignmentsCount} Direct`} variant="outlined" sx={{ borderRadius: 1.5 }} />
              {childrenRoles.length > 0 && <Chip size="small" icon={<GitBranch size={12} />} label={`${childrenRoles.length} Children`} variant="outlined" sx={{ borderRadius: 1.5 }} />}
            </Box>

            {/* Actions — fixed width, right-aligned */}
            <Box sx={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Tooltip title="View Effective Access">
                  <IconButton size="small" onClick={fetchEffective} color="info" aria-label="View Effective Access">
                    {loading ? <CircularProgress size={16} /> : <PrivateConnectivityIcon style={{ fontSize: 18 }} />}
                  </IconButton>
                </Tooltip>
                <Tooltip title={disableEdit ? "View Role Settings" : "Edit Role Settings"}>
                  <IconButton size="small" onClick={() => onEdit(role)} color="primary" aria-label={disableEdit ? "View Role Settings" : "Edit Role Settings"}>
                    {disableEdit ? <Eye size={16} /> : <Edit3 size={16} />}
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete Role">
                  <IconButton size="small" onClick={() => setConfirmDeleteOpen(true)} disabled={disableDelete} color="error" aria-label="Delete Role">
                    <Trash2 size={16} />
                  </IconButton>
                </Tooltip>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button size="small" variant="outlined" startIcon={<GitBranch size={12} />} onClick={() => onDerive(role)} disabled={disableDerive} sx={{ fontSize: '0.68rem', py: 0.2, px: 1, borderRadius: 1.5 }}>
                  Derive
                </Button>
                <Button size="small" variant="contained" startIcon={<Users size={12} />} onClick={() => setAssignDialogOpen(true)} disabled={disableAssign} sx={{ fontSize: '0.68rem', py: 0.2, px: 1, borderRadius: 1.5 }}>
                  Assign
                </Button>
              </Box>
            </Box>

          </Box>

        </Box>

        {/* Expandable Children Roles Section */}
        {expanded && childrenRoles.length > 0 && (
          <Box sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: 'action.hover', p: 2, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 1.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Child Derived Roles ({childrenRoles.length})</Typography>
            {childrenRoles.map(child => (
              <RoleCard key={child.ID} role={child} allRoles={allRoles} orgNodes={orgNodes} depth={depth + 1} onDerive={onDerive} onEdit={onEdit} onDelete={onDelete} onRefresh={onRefresh} isSearchActive={isSearchActive} onError={onError} onSuccess={onSuccess} onAssign={onAssign} isCompact={isCompact} permissions={permissions} />
            ))}
          </Box>
        )}

        {/* Expandable Effective Access Restrictions Display */}
        {showEffective && (
          <Box sx={{ borderTop: '1px solid', borderColor: 'divider', p: 2.5, bgcolor: 'background.paper', borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PrivateConnectivityIcon sx={{ fontSize: 18, color: 'info.main' }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Resolved Effective Restrictions</Typography>
              </Box>
            </Box>
            {effective && effective.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No active restriction values found.</Typography>
            ) : (
              <Grid container spacing={2}>
                {effective && effective.map((eff, index) => (
                  <Grid size={{ xs: 12, sm: 4 }} key={index}>
                    <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'action.hover' }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>Field: {eff.field}</Typography>
                      <Box sx={{ mt: 1 }}>
                        <RestrictionDisplay restriction={eff} />
                      </Box>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            )}
          </Box>
        )}
      </Card>

      {/* Confirm Cascading Deletion Dialog */}
      <Dialog open={confirmDeleteOpen} onClose={() => setConfirmDeleteOpen(false)}>
        <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
          <AlertTriangle color="#d32f2f" /> Confirm Cascading Deletion
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Are you sure you want to delete the role <strong>{role.name}</strong>?
          </DialogContentText>
          {descendants.length > 0 && (
            <Box sx={{ mb: 2, p: 1.5, bgcolor: 'error.light', color: 'error.main', borderRadius: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Warning: Cascading derived roles will also be deleted:</Typography>
              <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
                {descendants.map(d => <li key={d.ID}><strong style={{ color: '#d32f2f' }}>{d.name}</strong></li>)}
              </ul>
            </Box>
          )}
          {users.length > 0 && (
            <Box sx={{ p: 1.5, bgcolor: 'warning.light', color: 'warning.main', borderRadius: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Impact Warning: {users.length} user assignment(s) will be affected:</Typography>
              <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
                {users.map(u => <li key={u}><strong>{u}</strong></li>)}
              </ul>
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

      <UserRoleAssignment
        open={assignDialogOpen}
        role={role}
        allRoles={allRoles}
        onClose={() => setAssignDialogOpen(false)}
        onSuccess={(msg) => {
          setAssignDialogOpen(false);
          if (onSuccess) onSuccess(msg);
          if (onRefresh) onRefresh();
        }}
        onError={(msg) => {
          if (onError) onError(msg);
        }}
      />
    </Box>
  );
}
