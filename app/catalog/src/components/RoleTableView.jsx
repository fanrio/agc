import { useState } from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Chip, IconButton, Tooltip, Typography, Box, TableSortLabel, CircularProgress
} from '@mui/material';
import PrivateConnectivityIcon from '@mui/icons-material/PrivateConnectivity';
import { Shield, GitBranch, Eye, Edit3, Trash2, Users } from 'lucide-react';
import { ENV_LABEL, ENV_COLOR, formatDateTime, canDeriveFromRole } from '../utils/helpers';

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
  const [order, setOrder] = useState('asc');
  const [loadingRoleId, setLoadingRoleId] = useState(null);

  const handleSort = (property) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const sortedRoles = [...roles].sort((a, b) => {
    let aVal = a[orderBy] || '';
    let bVal = b[orderBy] || '';
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();

    if (aVal < bVal) return order === 'asc' ? -1 : 1;
    if (aVal > bVal) return order === 'asc' ? 1 : -1;
    return 0;
  });

  const getOrgNodeName = (orgNodeId) => {
    if (!orgNodeId) return null;
    const node = orgNodes.find(n => n.ID === orgNodeId);
    return node ? node.name : orgNodeId;
  };

  const getParentRoleName = (role) => {
    if (!role.parentRoles || role.parentRoles.length === 0) return null;
    const parentId = role.parentRoles[0].parent_ID || role.parentRoles[0].parent?.ID;
    if (!parentId) return null;
    const parent = allRoles.find(r => r.ID === parentId);
    return parent ? parent.name : parentId;
  };

  return (
    <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Table size="small">
        <TableHead sx={{ bgcolor: 'action.hover' }}>
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
            <TableCell sx={{ fontWeight: 700 }}>
              <TableSortLabel
                active={orderBy === 'type'}
                direction={orderBy === 'type' ? order : 'asc'}
                onClick={() => handleSort('type')}
              >
                Type
              </TableSortLabel>
            </TableCell>
            <TableCell sx={{ fontWeight: 700 }} align="center">
              <TableSortLabel
                active={orderBy === 'environment_ID'}
                direction={orderBy === 'environment_ID' ? order : 'asc'}
                onClick={() => handleSort('environment_ID')}
              >
                Environment
              </TableSortLabel>
            </TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Parent / Org Unit</TableCell>
            <TableCell sx={{ fontWeight: 700 }} align="center">Restrictions</TableCell>
            <TableCell sx={{ fontWeight: 700 }} align="center">Direct Users</TableCell>
            <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedRoles.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                No roles match the selected filters.
              </TableCell>
            </TableRow>
          ) : (
            sortedRoles.map((role) => {
              const orgName = getOrgNodeName(role.orgNode_ID);
              const parentName = getParentRoleName(role);
              const isDerived = role.type === 'DERIVED';
              const isOrg = role.type === 'ORG_BASED';
              const disableDerive = permissions?.isSuperAdmin ? false : !canDeriveFromRole(role, permissions);

              return (
                <TableRow key={role.ID} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Shield size={16} color={role.critical ? '#ba1a1a' : '#000035'} />
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
                          {role.name}
                        </Typography>
                        {role.description && (
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 280, display: 'block' }}>
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
                      <Tooltip title="Edit Role Settings">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => onEdit && onEdit(role)}
                          aria-label="Edit Role Settings"
                        >
                          <Edit3 size={15} />
                        </IconButton>
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
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
