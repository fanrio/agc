import { useState, memo } from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Chip, IconButton, Tooltip, Typography, Box, TableSortLabel, Button
} from '@mui/material';
import { Shield, GitBranch, Edit3, Trash2, Users, ChevronRight, ChevronDown, ChevronsUpDown, ChevronsDownUp, Eye } from 'lucide-react';
import { ENV_LABEL, ENV_COLOR, canDeriveFromRole, isRoleInScope } from '../utils/helpers';

export default function RoleTableView({
  roles,
  allRoles = [],
  orgNodes = [],
  onDerive,
  onEdit,
  onDelete,
  onRefresh,
  onError,
  onSuccess,
  permissions
}) {
  const [orderBy, setOrderBy] = useState('name');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [expandedMap, setExpandedMap] = useState({});

  const toggleExpand = (roleId) => {
    setExpandedMap(prev => ({ ...prev, [roleId]: !prev[roleId] }));
  };

  const handleExpandAll = () => {
    const nextMap = {};
    roles.forEach(r => { nextMap[r.ID] = true; });
    setExpandedMap(nextMap);
  };

  const handleCollapseAll = () => {
    setExpandedMap({});
  };

  const handleSort = (property) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const getOrgNodeName = (orgNodeId) => {
    if (!orgNodeId) return null;
    const node = orgNodes.find(n => n.ID === orgNodeId);
    return node ? node.name : orgNodeId;
  };

  const getParentRoleName = (role) => {
    if (!role.parentRoles || role.parentRoles.length === 0) return null;
    const parentObj = role.parentRoles[0].parent;
    if (parentObj && parentObj.name) {
      return parentObj.name;
    }
    const parentId = role.parentRoles[0].parent_ID || parentObj?.ID;
    if (!parentId) return null;
    const parent = allRoles.find(r => r.ID === parentId);
    return parent ? parent.name : parentId;
  };

  const getChildRoles = (parentId) => {
    return allRoles.filter(r =>
      r.parentRoles && r.parentRoles.some(pr => (pr.parent_ID || pr.parent?.ID) === parentId)
    );
  };

  // Top-level root roles (or all roles if a filter/search is active)
  const rootRoles = roles.filter(r => {
    if (!r.parentRoles || r.parentRoles.length === 0) return true;
    return !r.parentRoles.some(pr => {
      const parentId = pr.parent_ID || pr.parent?.ID;
      return roles.some(vr => vr.ID === parentId);
    });
  });

  const sortRolesList = (list) => {
    return [...list].sort((a, b) => {
      let aVal = a[orderBy] || '';
      let bVal = b[orderBy] || '';
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();

      if (aVal < bVal) return order === 'asc' ? -1 : 1;
      if (aVal > bVal) return order === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const sortedRoots = sortRolesList(rootRoles);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 0.5 }}>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          onClick={handleExpandAll}
          startIcon={<ChevronsUpDown size={14} />}
          sx={{ fontSize: '0.75rem' }}
        >
          Expand All
        </Button>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          onClick={handleCollapseAll}
          startIcon={<ChevronsDownUp size={14} />}
          sx={{ fontSize: '0.75rem' }}
        >
          Collapse All
        </Button>
      </Box>

      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>
                <TableSortLabel
                  active={orderBy === 'name'}
                  direction={orderBy === 'name' ? order : 'asc'}
                  onClick={() => handleSort('name')}
                >
                  Role Name
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ fontWeight: 700 }} >
                <TableSortLabel
                  active={orderBy === 'type'}
                  direction={orderBy === 'type' ? order : 'asc'}
                  onClick={() => handleSort('type')}
                >
                  Type
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ fontWeight: 700 }} >
                <TableSortLabel
                  active={orderBy === 'environment_ID'}
                  direction={orderBy === 'environment_ID' ? order : 'asc'}
                  onClick={() => handleSort('environment_ID')}
                >
                  Environment
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Parent / Org Unit</TableCell>
              <TableCell sx={{ fontWeight: 700 }} >Restrictions</TableCell>
              <TableCell sx={{ fontWeight: 700 }} >Direct Users</TableCell>
              <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedRoots.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  No roles match the selected filters.
                </TableCell>
              </TableRow>
            ) : (
              sortedRoots.map((role) => (
                <RoleRow
                  key={role.ID}
                  role={role}
                  depth={0}
                  allRoles={allRoles}
                  orgNodes={orgNodes}
                  expandedMap={expandedMap}
                  toggleExpand={toggleExpand}
                  onDerive={onDerive}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  permissions={permissions}
                  orderBy={orderBy}
                  order={order}
                />
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

const RoleRow = memo(({
  role,
  depth = 0,
  allRoles,
  orgNodes,
  expandedMap,
  toggleExpand,
  onDerive,
  onEdit,
  onDelete,
  permissions,
  orderBy,
  order
}) => {
  const children = allRoles.filter(r =>
    r.parentRoles && r.parentRoles.some(pr => (pr.parent_ID || pr.parent?.ID) === role.ID)
  );
  const hasChildren = children.length > 0;
  const isExpanded = !!expandedMap[role.ID];
  
  const orgName = (() => {
    if (!role.orgNode_ID) return null;
    const node = orgNodes.find(n => n.ID === role.orgNode_ID);
    return node ? node.name : role.orgNode_ID;
  })();

  const parentName = (() => {
    if (!role.parentRoles || role.parentRoles.length === 0) return null;
    const parentObj = role.parentRoles[0].parent;
    if (parentObj && parentObj.name) {
      return parentObj.name;
    }
    const parentId = role.parentRoles[0].parent_ID || parentObj?.ID;
    if (!parentId) return null;
    const parent = allRoles.find(r => r.ID === parentId);
    return parent ? parent.name : parentId;
  })();

  const isDerived = role.type === 'DERIVED';
  const isOrg = role.type === 'ORG_BASED';

  const canManageThisDerivedRole = (r) => {
    if (permissions?.isSuperAdmin) return true;
    if (!permissions?.canManageDerivedRoles) return false;
    if (r.type !== 'DERIVED') return false;
    if (!r.parentRoles || r.parentRoles.length === 0) return false;
    return r.parentRoles.every(pr => {
      const parentId = pr.parent_ID || pr.parent?.ID;
      if (!parentId) return false;
      const parent = allRoles.find(item => item.ID === parentId);
      if (!parent) return false;
      return isRoleInScope(parent.ID, parent.name, permissions?.managedDerivedRolesScope);
    });
  };

  const disableEdit = (() => {
    if (permissions?.isSuperAdmin) return false;
    if (role.type === 'DRAGE') return true;
    if (role.type === 'ORG_BASED') return !permissions?.canManageOrgRoles;
    if (role.type === 'DERIVED') return !canManageThisDerivedRole(role);
    return !permissions?.canManageSingleRoles;
  })();

  const disableDelete = disableEdit;
  const disableDerive = permissions?.isSuperAdmin ? false : !canDeriveFromRole(role, permissions);

  const sortedChildren = [...children].sort((a, b) => {
    let aVal = a[orderBy] || '';
    let bVal = b[orderBy] || '';
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();

    if (aVal < bVal) return order === 'asc' ? -1 : 1;
    if (aVal > bVal) return order === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <>
      <TableRow hover sx={{ bgcolor: depth > 0 ? 'action.hover' : 'inherit' }}>
        <TableCell sx={{ pl: depth * 3.5 + 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {hasChildren ? (
              <Tooltip title={isExpanded ? 'Collapse' : 'Expand'}>
                <IconButton
                  size="small"
                  onClick={() => toggleExpand(role.ID)}
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  sx={{ p: 0.25 }}
                >
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </IconButton>
              </Tooltip>
            ) : (
              <Box sx={{ width: 22 }} />
            )}

            <Shield size={16} color={role.critical ? '#ba1a1a' : '#000035'} />

            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: depth === 0 ? 700 : 600, color: 'text.primary' }}>
                {role.name}
              </Typography>
              {role.description && (
                <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 260, display: 'block' }}>
                  {role.description}
                </Typography>
              )}
            </Box>
          </Box>
        </TableCell>

        <TableCell>
          <Chip
            size="small"
            label={role.type}
            variant="outlined"
            color={isOrg ? 'primary' : isDerived ? 'secondary' : 'default'}
            sx={{ fontWeight: 700, height: 20, fontSize: '0.65rem' }}
          />
        </TableCell>

        <TableCell align="center">
          <Chip
            size="small"
            label={ENV_LABEL[role.environment_ID] || role.environment_ID}
            color={ENV_COLOR[role.environment_ID] || 'default'}
            variant="outlined"
            sx={{ fontWeight: 700 }}
          />
        </TableCell>

        <TableCell>
          {parentName ? (
            <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
              <GitBranch size={12} /> {parentName}
            </Typography>
          ) : orgName ? (
            <Typography variant="caption" color="text.secondary">
              Org: {orgName}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.disabled">—</Typography>
          )}
        </TableCell>

        <TableCell align="center">
          <Chip
            size="small"
            label={`${role.ownRestrictions?.length || 0} fields`}
            variant="outlined"
            sx={{ fontSize: '0.7rem' }}
          />
        </TableCell>

        <TableCell align="center">
          <Chip
            size="small"
            icon={<Users size={12} />}
            label={role.assignments?.length || 0}
            variant="outlined"
            sx={{ fontSize: '0.7rem' }}
          />
        </TableCell>

        <TableCell align="right">
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
            <Tooltip title={disableEdit ? 'View Role Settings' : 'Edit Role Settings'}>
              <span>
                <IconButton
                  size="small"
                  color="primary"
                  onClick={() => onEdit && onEdit(role)}
                  aria-label={disableEdit ? 'View Role Settings' : 'Edit Role Settings'}
                >
                  {disableEdit ? <Eye size={15} /> : <Edit3 size={15} />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={disableDerive ? 'Cannot derive role' : 'Derive Child Role'}>
              <span>
                <IconButton
                  size="small"
                  color="secondary"
                  onClick={() => onDerive && onDerive(role)}
                  disabled={disableDerive}
                  aria-label="Derive Child Role"
                >
                  <GitBranch size={15} />
                </IconButton>
              </span>
            </Tooltip>
            {onDelete && (
              <Tooltip title={disableDelete ? 'Cannot delete role' : 'Delete Role'}>
                <span>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => onDelete && onDelete(role)}
                    disabled={disableDelete}
                    aria-label="Delete Role"
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Box>
        </TableCell>
      </TableRow>

      {hasChildren && isExpanded && sortedChildren.map(child => (
        <RoleRow
          key={child.ID}
          role={child}
          depth={depth + 1}
          allRoles={allRoles}
          orgNodes={orgNodes}
          expandedMap={expandedMap}
          toggleExpand={toggleExpand}
          onDerive={onDerive}
          onEdit={onEdit}
          onDelete={onDelete}
          permissions={permissions}
          orderBy={orderBy}
          order={order}
        />
      ))}
    </>
  );
});
