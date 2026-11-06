import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Button,
  TextField,
  Card,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  CircularProgress,
  Alert,
  Snackbar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  InputAdornment,
  Tooltip,
  Skeleton,
  ToggleButton,
  ToggleButtonGroup,
  Chip,
  Avatar,
  Divider
} from '@mui/material';
import {
  Plus,
  Trash2,
  Shield,
  Users,
  Search,
  RefreshCw,
  ShieldCheck,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import * as api from '../api';
import { usePermissions } from '../context/PermissionsContext';
import UserRoleAssignment from './UserRoleAssignment';
import SearchableSelect from './SearchableSelect';

interface RoleAssignmentsViewProps {
  onInspectUser?: (uid: string) => void;
  onOpenAssign?: () => void;
}

export default function RoleAssignmentsView({ onInspectUser, onOpenAssign }: RoleAssignmentsViewProps) {
  const { permissions } = usePermissions();
  const [assignments, setAssignments] = useState<any[]>([]);

  // Confirm Dialog State
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: (() => Promise<void> | void) | null;
  }>({ open: false, title: 'Confirm', message: '', onConfirm: null });

  const [roles, setRoles] = useState<any[]>([]);
  const [allRoles, setAllRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAssigning, setIsAssigning] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'info' | 'warning' | 'error';
  }>({ open: false, message: '', severity: 'error' });

  // Grouping State: 'user' | 'role' (default is 'user')
  const [groupBy, setGroupBy] = useState<'user' | 'role'>('user');
  // Per default the group is collapsed: expandedGroups starts empty {}
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Filtering States
  const [filterUser, setFilterUser] = useState('');
  const [filterRole, setFilterRole] = useState('ALL');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterCreatedBy, setFilterCreatedBy] = useState('');

  // Extract unique roles present in current assignments
  const uniqueRoles = Array.from(new Set(assignments.map(a => a.role?.name).filter(Boolean))).sort();

  // Apply filtering in memory
  const filteredAssignments = assignments.filter(a => {
    if (filterUser.trim()) {
      const q = filterUser.toLowerCase();
      const match = (a.userId && a.userId.toLowerCase().includes(q)) ||
        (a.userName && a.userName.toLowerCase().includes(q));
      if (!match) return false;
    }
    if (filterRole !== 'ALL') {
      if (a.role?.name !== filterRole) return false;
    }
    if (filterStartDate) {
      if (!a.createdAt) return false;
      const start = new Date(filterStartDate + 'T00:00:00');
      const aDate = new Date(a.createdAt);
      if (aDate < start) return false;
    }
    if (filterEndDate) {
      if (!a.createdAt) return false;
      const end = new Date(filterEndDate + 'T23:59:59');
      const aDate = new Date(a.createdAt);
      if (aDate > end) return false;
    }
    if (filterCreatedBy.trim()) {
      const q = filterCreatedBy.toLowerCase();
      const match = a.createdBy && a.createdBy.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  // Grouped Data computation
  const groupedData = useMemo(() => {
    if (groupBy === 'user') {
      const groupsMap = new Map<string, {
        userId: string;
        userName: string;
        items: any[];
      }>();

      for (const a of filteredAssignments) {
        const uid = a.userId || 'Unknown User';
        const uname = a.userName || a.userId || 'Unknown User';
        if (!groupsMap.has(uid)) {
          groupsMap.set(uid, {
            userId: uid,
            userName: uname,
            items: []
          });
        }
        groupsMap.get(uid)!.items.push(a);
      }

      // Sort groups alphabetically by userName / userId
      const groups = Array.from(groupsMap.values()).sort((g1, g2) =>
        (g1.userName || g1.userId).localeCompare(g2.userName || g2.userId)
      );

      // Sort items within each user by role name
      groups.forEach(g => {
        g.items.sort((a, b) => (a.role?.name || '').localeCompare(b.role?.name || ''));
      });

      return { type: 'user' as const, groups };
    } else {
      const groupsMap = new Map<string, {
        roleId: string;
        roleName: string;
        role: any;
        items: any[];
      }>();

      for (const a of filteredAssignments) {
        const rid = a.role_ID || a.role?.ID || a.role?.name || 'Unknown Role';
        const rname = a.role?.name || 'Unknown Role';
        if (!groupsMap.has(rid)) {
          groupsMap.set(rid, {
            roleId: rid,
            roleName: rname,
            role: a.role,
            items: []
          });
        }
        groupsMap.get(rid)!.items.push(a);
      }

      // Sort groups alphabetically by roleName
      const groups = Array.from(groupsMap.values()).sort((g1, g2) =>
        g1.roleName.localeCompare(g2.roleName)
      );

      // Sort items within each role by userName / userId
      groups.forEach(g => {
        g.items.sort((a, b) => (a.userName || a.userId || '').localeCompare(b.userName || b.userId || ''));
      });

      return { type: 'role' as const, groups };
    }
  }, [filteredAssignments, groupBy]);

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleExpandAll = () => {
    const next: Record<string, boolean> = {};
    groupedData.groups.forEach(g => {
      const key = groupBy === 'user' ? (g as any).userId : (g as any).roleId;
      next[key] = true;
    });
    setExpandedGroups(next);
  };

  const handleCollapseAll = () => {
    setExpandedGroups({});
  };

  const handleResetFilters = () => {
    setFilterUser('');
    setFilterRole('ALL');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterCreatedBy('');
  };

  const handleCloseSnackbar = (event?: any, reason?: string) => {
    if (reason === 'clickaway') return;
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  async function load() {
    setLoading(true);
    try {
      const [assignData, roleData] = await Promise.all([
        api.getAssignments(),
        api.getRoles()
      ]);
      setAssignments(assignData || []);
      setRoles(roleData || []);
      setAllRoles(roleData || []);
    } catch (e: any) {
      setSnackbar({ open: true, message: `Failed to load data: ${e.message}`, severity: 'error' });
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function handleDelete(id: string, user: string, roleName: string) {
    setConfirmDialog({
      open: true,
      title: 'Remove Assignment',
      message: `Remove assignment of role "${roleName}" from user "${user}"?`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        setLoading(true);
        try {
          await api.deleteAssignment(id);
          await load();
        } catch (e: any) {
          setSnackbar({ open: true, message: e.message, severity: 'error' });
        }
        setLoading(false);
      }
    });
  }

  // If in-place assignment wizard is open
  if (isAssigning) {
    return (
      <UserRoleAssignment
        roles={roles}
        allRoles={allRoles}
        existingAssignments={assignments}
        onClose={() => setIsAssigning(false)}
        onSuccess={async (msg) => {
          setIsAssigning(false);
          setSnackbar({ open: true, message: msg, severity: 'success' });
          await load();
        }}
        onError={(msg) => {
          setSnackbar({ open: true, message: msg, severity: 'error' });
        }}
      />
    );
  }

  return (
    <Box sx={{ animation: 'fadeIn 0.3s' }}>
      {/* Top Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>Role Assignments</Typography>
          <Typography variant="body2" color="text.secondary">Assign authorization roles to users and groups</Typography>
        </Box>
        <Button
          variant="contained"
          onClick={() => {
            setSnackbar(prev => ({ ...prev, open: false }));
            if (onOpenAssign) {
              onOpenAssign();
            } else {
              setIsAssigning(true);
            }
          }}
          disabled={permissions?.isSuperAdmin ? false : (permissions && !permissions.canAssignRoles && roles.length === 0)}
          startIcon={<Plus size={15} />}
        >
          Assign Role
        </Button>
      </Box>

      {/* Snackbar Notifications */}
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

      {/* Grouping & Filter Card */}
      <Card sx={{ p: 2, mb: 3, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', backgroundImage: 'none' }}>
        {/* Top Bar: Group By Switcher & View Stats */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
              Group by:
            </Typography>
            <ToggleButtonGroup
              value={groupBy}
              exclusive
              onChange={(e, val) => {
                if (val) {
                  setGroupBy(val);
                  setExpandedGroups({});
                }
              }}
              size="small"
              sx={{ height: 34 }}
            >
              <ToggleButton
                value="user"
                sx={{
                  px: 1.75,
                  py: 0.5,
                  textTransform: 'none',
                  fontWeight: 600,
                  gap: 0.8,
                  fontSize: '0.8125rem'
                }}
              >
                <Users size={14} /> User
              </ToggleButton>
              <ToggleButton
                value="role"
                sx={{
                  px: 1.75,
                  py: 0.5,
                  textTransform: 'none',
                  fontWeight: 600,
                  gap: 0.8,
                  fontSize: '0.8125rem'
                }}
              >
                <Shield size={14} /> Role
              </ToggleButton>
            </ToggleButtonGroup>

            {groupedData.groups.length > 0 && (
              <Box sx={{ display: 'flex', gap: 0.5, ml: 1 }}>
                <Button
                  size="small"
                  variant="text"
                  color="inherit"
                  onClick={handleExpandAll}
                  sx={{ fontSize: '0.75rem', py: 0.2 }}
                >
                  Expand All
                </Button>
                <Button
                  size="small"
                  variant="text"
                  color="inherit"
                  onClick={handleCollapseAll}
                  sx={{ fontSize: '0.75rem', py: 0.2 }}
                >
                  Collapse All
                </Button>
              </Box>
            )}
          </Box>

          <Typography variant="caption" color="text.secondary">
            Showing <strong>{filteredAssignments.length}</strong> assignment{filteredAssignments.length !== 1 ? 's' : ''} grouped across <strong>{groupedData.groups.length}</strong> {groupBy === 'user' ? 'users' : 'roles'}
          </Typography>
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* Filters Bar */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          <TextField
            placeholder="Filter by User..."
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            size="small"
            sx={{ minWidth: 200, flexGrow: 1 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start" sx={{ color: 'text.secondary' }}>
                    <Search size={16} />
                  </InputAdornment>
                ),
              }
            }}
          />

          <SearchableSelect
            options={[
              { value: 'ALL', label: 'All Roles' },
              ...uniqueRoles.map(name => ({ value: name, label: name }))
            ]}
            value={filterRole}
            onChange={val => setFilterRole(val)}
            label="Role"
            sx={{ minWidth: 180 }}
          />

          <TextField
            label="Assigned On: Start"
            type="date"
            value={filterStartDate}
            onChange={(e) => setFilterStartDate(e.target.value)}
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ minWidth: 150 }}
          />

          <TextField
            label="Assigned On: End"
            type="date"
            value={filterEndDate}
            onChange={(e) => setFilterEndDate(e.target.value)}
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ minWidth: 150 }}
          />

          <TextField
            placeholder="Assigned By..."
            value={filterCreatedBy}
            onChange={(e) => setFilterCreatedBy(e.target.value)}
            size="small"
            sx={{ minWidth: 160 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start" sx={{ color: 'text.secondary' }}>
                    <Search size={16} />
                  </InputAdornment>
                ),
              }
            }}
          />

          {(filterUser || filterRole !== 'ALL' || filterStartDate || filterEndDate || filterCreatedBy) && (
            <Button
              variant="text"
              color="inherit"
              onClick={handleResetFilters}
              startIcon={<RefreshCw size={14} />}
              size="small"
            >
              Reset
            </Button>
          )}
        </Box>
      </Card>

      {/* Main Table Card */}
      <Card sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', backgroundImage: 'none' }}>
        {loading && assignments.length === 0 ? (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell style={{ width: 48 }} />
                  <TableCell style={{ fontWeight: 600 }}>Assigned Role</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Type &amp; Platform</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Assigned On</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Assigned By</TableCell>
                  <TableCell align="right" style={{ width: 120, fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[1, 2, 3, 4, 5].map((idx) => (
                  <TableRow key={idx}>
                    <TableCell><Skeleton variant="circular" width={24} height={24} /></TableCell>
                    <TableCell><Skeleton variant="text" width={140} /></TableCell>
                    <TableCell><Skeleton variant="text" width={110} /></TableCell>
                    <TableCell><Skeleton variant="text" width={100} /></TableCell>
                    <TableCell><Skeleton variant="text" width={90} /></TableCell>
                    <TableCell align="right"><Skeleton variant="circular" width={28} height={28} sx={{ ml: 'auto' }} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : assignments.length === 0 ? (
          <Box sx={{ py: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <Box sx={{ opacity: 0.5, mb: 2 }}><Users size={40} /></Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>No role assignments yet</Typography>
            <Typography variant="body2" color="text.secondary">Click "Assign Role" to link users to authorization roles.</Typography>
          </Box>
        ) : filteredAssignments.length === 0 ? (
          <Box sx={{ py: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <Box sx={{ opacity: 0.5, mb: 2 }}><Search size={40} /></Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>No matching assignments found</Typography>
            <Typography variant="body2" color="text.secondary">Try adjusting your filters or search query.</Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell style={{ width: 48 }} />
                  {groupBy === 'user' ? (
                    <>
                      <TableCell style={{ fontWeight: 600 }}>Assigned Role</TableCell>
                      <TableCell style={{ fontWeight: 600 }}>Type &amp; Platform</TableCell>
                      <TableCell style={{ fontWeight: 600 }}>Assigned On</TableCell>
                      <TableCell style={{ fontWeight: 600 }}>Assigned By</TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell style={{ fontWeight: 600 }}>User ID</TableCell>
                      <TableCell style={{ fontWeight: 600 }}>User Name</TableCell>
                      <TableCell style={{ fontWeight: 600 }}>Assigned On</TableCell>
                      <TableCell style={{ fontWeight: 600 }}>Assigned By</TableCell>
                    </>
                  )}
                  <TableCell align="right" style={{ width: 120, fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {groupedData.type === 'user' ? (
                  groupedData.groups.map(group => {
                    const isExpanded = !!expandedGroups[group.userId];
                    const isCollapsed = !isExpanded;
                    return (
                      <React.Fragment key={group.userId}>
                        {/* Group Header Row for User */}
                        <TableRow
                          hover
                          onClick={() => toggleGroup(group.userId)}
                          sx={{
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'action.selected' : '#f8fafc',
                            cursor: 'pointer',
                            borderTop: '1px solid',
                            borderBottom: isCollapsed ? '1px solid' : 'none',
                            borderColor: 'divider',
                            '&:hover': { bgcolor: 'action.hover' }
                          }}
                        >
                          <TableCell sx={{ py: 1.25, width: 48, textAlign: 'center' }}>
                            <IconButton
                              size="small"
                              sx={{ p: 0.25 }}
                              aria-label={isCollapsed ? 'Expand group' : 'Collapse group'}
                            >
                              {isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                            </IconButton>
                          </TableCell>
                          <TableCell colSpan={4} sx={{ py: 1.25 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                              <Avatar
                                sx={{
                                  bgcolor: 'primary.light',
                                  color: 'primary.dark',
                                  width: 28,
                                  height: 28,
                                  fontSize: '0.8rem',
                                  fontWeight: 700
                                }}
                              >
                                {(group.userName || group.userId).charAt(0).toUpperCase()}
                              </Avatar>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography
                                  variant="subtitle2"
                                  sx={{
                                    fontWeight: 700,
                                    color: 'text.primary'
                                  }}
                                >
                                  {group.userName}
                                </Typography>
                                {group.userName !== group.userId && (
                                  <Typography variant="caption" color="text.secondary">
                                    ({group.userId})
                                  </Typography>
                                )}
                              </Box>
                              <Chip
                                size="small"
                                label={`${group.items.length} role${group.items.length !== 1 ? 's' : ''}`}
                                sx={{
                                  fontWeight: 600,
                                  height: 22,
                                  fontSize: '0.75rem',
                                  bgcolor: 'background.paper',
                                  border: '1px solid',
                                  borderColor: 'divider'
                                }}
                              />
                            </Box>
                          </TableCell>
                          <TableCell align="right" sx={{ py: 1.25, width: 120 }}>
                            <Tooltip title="View User Authorization Card">
                              <IconButton
                                color="primary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onInspectUser) onInspectUser(group.userId);
                                }}
                                size="small"
                                aria-label="View User Authorization Card"
                              >
                                <ShieldCheck size={16} />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>

                        {/* Child Rows: Assigned Roles */}
                        {isExpanded && group.items.map(a => (
                          <TableRow key={a.ID} hover sx={{ '& td': { borderColor: 'rgba(0, 0, 0, 0.06)' } }}>
                            <TableCell sx={{ pl: 4, width: 48 }} />
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Shield size={14} color={a.role?.type === 'ORG_BASED' ? '#3b82f6' : '#a78bfa'} />
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                  {a.role?.name || 'Unknown Role'}
                                </Typography>
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                {a.role?.type && (
                                  <Chip
                                    size="small"
                                    label={a.role.type}
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: '0.6875rem', fontWeight: 600 }}
                                  />
                                )}
                              </Box>
                            </TableCell>
                            <TableCell sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
                              {a.createdAt ? new Date(a.createdAt).toLocaleString() : 'N/A'}
                            </TableCell>
                            <TableCell sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
                              {a.createdBy || 'System'}
                            </TableCell>
                            <TableCell align="right">
                              <Tooltip title="Remove assignment">
                                <IconButton
                                  color="error"
                                  onClick={() => handleDelete(a.ID, a.userName || a.userId, a.role?.name || 'Unknown')}
                                  disabled={loading || (permissions?.isSuperAdmin ? false : (permissions && !permissions.canAssignRoles && !roles.some(r => r.ID === a.role_ID)))}
                                  size="small"
                                  aria-label="Remove assignment"
                                >
                                  <Trash2 size={15} />
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        ))}
                      </React.Fragment>
                    );
                  })
                ) : (
                  groupedData.groups.map(group => {
                    const isExpanded = !!expandedGroups[group.roleId];
                    const isCollapsed = !isExpanded;
                    return (
                      <React.Fragment key={group.roleId}>
                        {/* Group Header Row for Role */}
                        <TableRow
                          hover
                          onClick={() => toggleGroup(group.roleId)}
                          sx={{
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'action.selected' : '#f8fafc',
                            cursor: 'pointer',
                            borderTop: '1px solid',
                            borderBottom: isCollapsed ? '1px solid' : 'none',
                            borderColor: 'divider',
                            '&:hover': { bgcolor: 'action.hover' }
                          }}
                        >
                          <TableCell sx={{ py: 1.25, width: 48, textAlign: 'center' }}>
                            <IconButton
                              size="small"
                              sx={{ p: 0.25 }}
                              aria-label={isCollapsed ? 'Expand group' : 'Collapse group'}
                            >
                              {isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                            </IconButton>
                          </TableCell>
                          <TableCell colSpan={4} sx={{ py: 1.25 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                              <Box
                                sx={{
                                  p: 0.6,
                                  borderRadius: 1.5,
                                  bgcolor: group.role?.type === 'ORG_BASED' ? 'info.light' : 'secondary.light',
                                  color: group.role?.type === 'ORG_BASED' ? 'info.dark' : 'secondary.dark',
                                  display: 'flex',
                                  alignItems: 'center'
                                }}
                              >
                                <Shield size={16} />
                              </Box>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                {group.roleName}
                              </Typography>
                              {group.role?.type && (
                                <Chip
                                  size="small"
                                  label={group.role.type}
                                  variant="outlined"
                                  sx={{ height: 20, fontSize: '0.6875rem', fontWeight: 600 }}
                                />
                              )}
                              
                              <Chip
                                size="small"
                                label={`${group.items.length} user${group.items.length !== 1 ? 's' : ''}`}
                                sx={{
                                  fontWeight: 600,
                                  height: 22,
                                  fontSize: '0.75rem',
                                  bgcolor: 'background.paper',
                                  border: '1px solid',
                                  borderColor: 'divider'
                                }}
                              />
                            </Box>
                          </TableCell>
                          <TableCell align="right" sx={{ py: 1.25, width: 120 }}>
                            {/* Actions column on role header */}
                          </TableCell>
                        </TableRow>

                        {/* Child Rows: Assigned Users */}
                        {isExpanded && group.items.map(a => (
                          <TableRow key={a.ID} hover sx={{ '& td': { borderColor: 'rgba(0, 0, 0, 0.06)' } }}>
                            <TableCell sx={{ pl: 4, width: 48 }} />
                            <TableCell sx={{ fontWeight: 600 }}>
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 600,
                                  color: 'primary.main',
                                  cursor: 'pointer',
                                  '&:hover': { textDecoration: 'underline' }
                                }}
                                onClick={() => onInspectUser && onInspectUser(a.userId)}
                              >
                                {a.userId}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ fontWeight: 500 }}>
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 500,
                                  cursor: 'pointer',
                                  '&:hover': { color: 'primary.main' }
                                }}
                                onClick={() => onInspectUser && onInspectUser(a.userId)}
                              >
                                {a.userName || a.userId}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
                              {a.createdAt ? new Date(a.createdAt).toLocaleString() : 'N/A'}
                            </TableCell>
                            <TableCell sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
                              {a.createdBy || 'System'}
                            </TableCell>
                            <TableCell align="right">
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                                <Tooltip title="View User Authorization Card">
                                  <IconButton
                                    color="primary"
                                    onClick={() => onInspectUser && onInspectUser(a.userId)}
                                    size="small"
                                    aria-label="View User Authorization Card"
                                  >
                                    <ShieldCheck size={16} />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="Remove assignment">
                                  <IconButton
                                    color="error"
                                    onClick={() => handleDelete(a.ID, a.userName || a.userId, a.role?.name || 'Unknown')}
                                    disabled={loading || (permissions?.isSuperAdmin ? false : (permissions && !permissions.canAssignRoles && !roles.some(r => r.ID === a.role_ID)))}
                                    size="small"
                                    aria-label="Remove assignment"
                                  >
                                    <Trash2 size={15} />
                                  </IconButton>
                                </Tooltip>
                              </Box>
                            </TableCell>
                          </TableRow>
                        ))}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      {/* Confirm Dialog */}
      <Dialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog(prev => ({ ...prev, open: false }))}
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
      >
        <DialogTitle id="confirm-dialog-title">
          {confirmDialog.title}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="confirm-dialog-description">
            {confirmDialog.message}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(prev => ({ ...prev, open: false }))} color="inherit">
            Cancel
          </Button>
          <Button onClick={confirmDialog.onConfirm} color="primary" variant="contained" autoFocus>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
