import { useState } from 'react';
import { 
  Box, Card, Typography, Button, IconButton, TextField, Collapse, Grid, Chip, 
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Alert 
} from '@mui/material';
import { Shield, GitBranch, Users, Trash2, ChevronRight, ChevronDown, Eye, Edit3, Plus, AlertTriangle } from 'lucide-react';
import * as api from '../api';
import { RestrictionDisplay } from './RestrictionBuilder';
import { ENV_LABEL, ENV_COLOR, formatDateTime, isCriticalRestriction } from '../utils/helpers';

export default function RoleCard({ role, allRoles, orgNodes = [], depth = 0, onDerive, onEdit, onDelete, onRefresh, isSearchActive = false, onError, onAssign, isCompact, permissions }) {
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

  const childrenRoles = getRoleDirectChildren(role.ID, allRoles);
  const { descendants, users } = getDescendantsAndUsers(role.ID, allRoles);

  // Check if role is critical
  const directCritical = Array.isArray(role.ownRestrictions) && role.ownRestrictions.some(r => isCriticalRestriction(r, orgNodes));
  const isCritical = role.isCriticalManual || directCritical;

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

  const isOrgRole = !!role.orgNode_ID;
  const isDerived = role.roleType === 'DERIVED';

  // Wizard derive scopes checks
  const canDeriveFromRole = (role) => {
    if (!canManageDerivedRoles) return false;
    const scope = permissions?.derivedRolesScope;
    if (!scope) return false;
    if (scope === '*') return true;
    try {
      const scopeList = JSON.parse(scope);
      if (Array.isArray(scopeList)) {
        return scopeList.some(s => s.roleId === role.ID || s.roleId === role.name);
      }
    } catch (e) {
      const terms = scope.split(',').map(s => s.trim().toLowerCase());
      return terms.includes(role.name.toLowerCase()) || terms.includes(role.ID.toLowerCase());
    }
    return false;
  };

  const canManageThisDerivedRole = (role) => {
    if (!canManageDerivedRoles) return false;
    if (role.roleType !== 'DERIVED') return false;
    const scope = permissions?.derivedRolesScope;
    if (!scope) return false;
    if (scope === '*') return true;
    
    const parentRole = role.parentRoles?.[0]?.parent;
    if (!parentRole) return false;
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
  };

  const disableEdit = isOrgRole ? !canManageOrgRoles : (isDerived ? !canManageThisDerivedRole(role) : !canManageSingleRoles);
  const disableDelete = isOrgRole ? !canManageOrgRoles : (isDerived ? !canManageThisDerivedRole(role) : !canManageSingleRoles);
  const disableDerive = !canDeriveFromRole(role);
  const disableAssign = !canAssignRoles;

  if (isCompact) {
    return (
      <Box sx={{ pl: depth * 3, mb: 1 }}>
        <Card variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 2, borderColor: isCritical ? 'error.light' : 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <IconButton size="small" onClick={() => setExpanded(!expanded)} disabled={childrenRoles.length === 0}>
              {childrenRoles.length > 0 ? (expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <Box sx={{ width: 28 }} />}
            </IconButton>
            <Shield size={16} color={isCritical ? '#d32f2f' : '#1976d2'} />
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
          <RoleCard key={child.ID} role={child} allRoles={allRoles} orgNodes={orgNodes} depth={depth + 1} onDerive={onDerive} onEdit={onEdit} onDelete={onDelete} onRefresh={onRefresh} isSearchActive={isSearchActive} onError={onError} onAssign={onAssign} isCompact={isCompact} permissions={permissions} />
        ))}
      </Box>
    );
  }

  return (
    <Box sx={{ pl: depth * 4, mb: 2 }}>
      <Card variant="outlined" sx={{ borderRadius: 3, borderLeft: 5, borderLeftColor: isCritical ? 'error.main' : 'primary.main', boxShadow: '0 4px 12px 0 rgba(0,0,0,0.03)', overflow: 'visible' }}>
        <Box sx={{ p: 2.5 }}>
          <Grid container spacing={2} alignItems="center">
            {/* Collapse/Expand toggle */}
            <Grid item sx={{ display: 'flex', alignItems: 'center' }}>
              <IconButton size="small" onClick={() => setExpanded(!expanded)} disabled={childrenRoles.length === 0 && !isSearchActive} color="primary">
                {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
              </IconButton>
            </Grid>

            {/* Shield and basic details */}
            <Grid item sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ p: 1.2, borderRadius: 2, bgcolor: isCritical ? 'error.light' : 'primary.light', color: isCritical ? 'error.main' : 'primary.main', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Shield size={22} />
              </Box>
            </Grid>

            <Grid item xs={12} sm={4}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>{role.name}</Typography>
                <Chip size="small" label={role.roleType} color="primary" variant="outlined" sx={{ fontWeight: 700, height: 20, fontSize: '0.65rem' }} />
                {role.isCriticalManual && <Chip size="small" label="Critical (Manual)" color="error" sx={{ fontWeight: 700, height: 20, fontSize: '0.65rem' }} />}
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{role.description || 'No description provided.'}</Typography>
            </Grid>

            {/* Context Details */}
            <Grid item xs={12} sm={3}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <strong>Env:</strong> {ENV_LABEL[role.environment_ID] || role.environment_ID}
                </Typography>
                {orgNodeName && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <strong>Org Unit:</strong> {orgNodeName}
                  </Typography>
                )}
                {role.roleType === 'DERIVED' && role.parentRoles?.[0]?.parent && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <strong>Derived from:</strong> {role.parentRoles[0].parent.name}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary">
                  <strong>Modified:</strong> {formatDateTime(role.modifiedAt)}
                </Typography>
              </Box>
            </Grid>

            {/* Metrics Chips */}
            <Grid item xs={12} sm={2}>
              <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap' }}>
                <Chip size="small" icon={<Users size={12} />} label={`${assignmentsCount} Direct`} variant="outlined" sx={{ borderRadius: 1.5 }} />
                {childrenRoles.length > 0 && <Chip size="small" icon={<GitBranch size={12} />} label={`${childrenRoles.length} Children`} variant="outlined" sx={{ borderRadius: 1.5 }} />}
              </Box>
            </Grid>

            {/* Actions Panel */}
            <Grid item xs={12} sm={2} align="right">
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                <IconButton size="small" onClick={fetchEffective} title="View Effective Access" color="info">
                  {loading ? <CircularProgress size={16} /> : <Eye size={16} />}
                </IconButton>
                <IconButton size="small" onClick={() => onEdit(role)} title="Edit Role Settings" disabled={disableEdit} color="primary">
                  <Edit3 size={16} />
                </IconButton>
                <IconButton size="small" onClick={() => setConfirmDeleteOpen(true)} title="Delete Role" disabled={disableDelete} color="error">
                  <Trash2 size={16} />
                </IconButton>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5, mt: 1 }}>
                <Button size="small" variant="outlined" startIcon={<GitBranch size={12} />} onClick={() => onDerive(role)} disabled={disableDerive} sx={{ fontSize: '0.68rem', py: 0.2, px: 1, borderRadius: 1.5 }}>
                  Derive
                </Button>
                <Button size="small" variant="contained" startIcon={<Users size={12} />} onClick={() => onAssign(role)} disabled={disableAssign} sx={{ fontSize: '0.68rem', py: 0.2, px: 1, borderRadius: 1.5 }}>
                  Assign
                </Button>
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Expandable Children Roles Section */}
        {expanded && childrenRoles.length > 0 && (
          <Box sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: 'action.hover', p: 2, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 1.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Child Derived Roles ({childrenRoles.length})</Typography>
            {childrenRoles.map(child => (
              <RoleCard key={child.ID} role={child} allRoles={allRoles} orgNodes={orgNodes} depth={depth + 1} onDerive={onDerive} onEdit={onEdit} onDelete={onDelete} onRefresh={onRefresh} isSearchActive={isSearchActive} onError={onError} onAssign={onAssign} isCompact={isCompact} permissions={permissions} />
            ))}
          </Box>
        )}

        {/* Expandable Effective Access Restrictions Display */}
        {showEffective && (
          <Box sx={{ borderTop: '1px solid', borderColor: 'divider', p: 2.5, bgcolor: 'background.paper', borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Resolved Effective Restrictions</Typography>
              <Button size="small" onClick={() => setShowEffective(false)}>Hide Details</Button>
            </Box>
            {effective && effective.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No active restriction values found.</Typography>
            ) : (
              <Grid container spacing={2}>
                {effective && effective.map((eff, index) => (
                  <Grid item xs={12} sm={4} key={index}>
                    <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'action.hover' }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>Field: {eff.field}</Typography>
                      <Box sx={{ mt: 1 }}>
                        <RestrictionDisplay restriction={eff} />
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, fontSize: '0.65rem' }}>Inherited from: <strong>{eff.inheritedFromRoleName}</strong></Typography>
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
    </Box>
  );
}
