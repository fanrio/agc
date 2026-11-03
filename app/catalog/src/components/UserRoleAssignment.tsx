import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  TextField,
  InputAdornment,
  Chip,
  Checkbox,
  Card,
  Divider,
  Avatar,
  Tooltip,
  CircularProgress,
  IconButton,
  Alert
} from '@mui/material';
import {
  Shield,
  UserPlus,
  Users,
  Search,
  X,
  Check,
  Cloud,
  Flame,
  Layers,
  AlertCircle,
  Zap,
  CheckCircle2,
  Lock
} from 'lucide-react';
import UserSelection from './UserSelection';
import * as api from '../api';

// Helper to recursively check if a role or any of its parents has restrictions
function hasAnyRestrictions(role: any, allRoles: any[] = []): boolean {
  if (role.ownRestrictions && role.ownRestrictions.length > 0) return true;
  if (role.restrictions && role.restrictions.length > 0) return true;
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

interface UserRoleAssignmentProps {
  open: boolean;
  role?: any;
  roles?: any[];
  allRoles?: any[];
  existingAssignments?: any[];
  onClose: () => void;
  onSuccess?: (msg: string) => void | Promise<void>;
  onError?: (msg: string) => void;
}

export default function UserRoleAssignment({
  open,
  role,
  roles = [],
  allRoles = roles,
  existingAssignments,
  onClose,
  onSuccess,
  onError
}: UserRoleAssignmentProps) {
  const [selectedScimUser, setSelectedScimUser] = useState<any>(null);
  const [assignForm, setAssignForm] = useState({ userId: '', userName: '' });
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [roleSearchQuery, setRoleSearchQuery] = useState('');
  const [filterPlatform, setFilterPlatform] = useState<'ALL' | 'DATASPHERE' | 'DATABRICKS' | 'BOTH'>('ALL');
  const [filterType, setFilterType] = useState<'ALL' | 'SINGLE' | 'DERIVED' | 'ORG_BASED'>('ALL');
  const [loading, setLoading] = useState(false);

  // Existing assignments for the selected user
  const [userExistingAssignments, setUserExistingAssignments] = useState<any[]>([]);
  const [existingUserRoleIds, setExistingUserRoleIds] = useState<Set<string>>(new Set());

  // Reset state on open/close
  useEffect(() => {
    if (!open) {
      setSelectedScimUser(null);
      setAssignForm({ userId: '', userName: '' });
      setSelectedRoleIds(role ? [role.ID] : []);
      setRoleSearchQuery('');
      setFilterPlatform('ALL');
      setFilterType('ALL');
      setUserExistingAssignments([]);
      setExistingUserRoleIds(new Set());
      setLoading(false);
    } else if (role) {
      setSelectedRoleIds([role.ID]);
    }
  }, [open, role]);

  // Load existing assignments for the selected user to prevent duplicate assignments
  useEffect(() => {
    if (!assignForm.userId.trim()) {
      setUserExistingAssignments([]);
      setExistingUserRoleIds(new Set());
      return;
    }

    if (existingAssignments && existingAssignments.length > 0) {
      const userAss = existingAssignments.filter(a => a.userId === assignForm.userId.trim());
      setUserExistingAssignments(userAss);
      setExistingUserRoleIds(new Set(userAss.map(a => a.role_ID || a.role?.ID).filter(Boolean)));
    } else {
      api.getAssignments()
        .then((res: any) => {
          const list = Array.isArray(res) ? res : (res?.value || []);
          const userAss = list.filter((a: any) => a.userId === assignForm.userId.trim());
          setUserExistingAssignments(userAss);
          setExistingUserRoleIds(new Set(userAss.map((a: any) => a.role_ID || a.role?.ID).filter(Boolean)));
        })
        .catch(() => {});
    }
  }, [assignForm.userId, existingAssignments]);

  // Filtered roles list based on search, platform, and type filters
  const filteredRoles = useMemo(() => {
    return roles.filter(r => {
      // Platform filter
      if (filterPlatform !== 'ALL') {
        const plat = r.targetPlatform || 'DATASPHERE';
        if (filterPlatform === 'BOTH') {
          if (plat !== 'BOTH') return false;
        } else if (filterPlatform === 'DATASPHERE') {
          if (plat !== 'DATASPHERE' && plat !== 'BOTH') return false;
        } else if (filterPlatform === 'DATABRICKS') {
          if (plat !== 'DATABRICKS' && plat !== 'BOTH') return false;
        }
      }

      // Type filter
      if (filterType !== 'ALL') {
        const isOrg = r.type === 'ORG_BASED';
        const isDerived = r.type === 'DERIVED' || (r.parentRoles && r.parentRoles.length > 0);
        const actualType = isOrg ? 'ORG_BASED' : isDerived ? 'DERIVED' : 'SINGLE';
        if (filterType !== actualType) return false;
      }

      // Search query filter
      if (roleSearchQuery.trim()) {
        const q = roleSearchQuery.toLowerCase().trim();
        const matchesName = (r.name || '').toLowerCase().includes(q);
        const matchesDesc = (r.description || '').toLowerCase().includes(q);
        if (!matchesName && !matchesDesc) return false;
      }

      return true;
    });
  }, [roles, filterPlatform, filterType, roleSearchQuery]);

  // Selected roles objects and target platforms impact
  const selectedRoles = useMemo(() => {
    if (role) return [role];
    return roles.filter(r => selectedRoleIds.includes(r.ID));
  }, [role, roles, selectedRoleIds]);

  const targetImpact = useMemo(() => {
    let hasDatasphere = false;
    let hasDatabricks = false;
    for (const r of selectedRoles) {
      const plat = r.targetPlatform || 'DATASPHERE';
      if (plat === 'DATASPHERE' || plat === 'BOTH') hasDatasphere = true;
      if (plat === 'DATABRICKS' || plat === 'BOTH') hasDatabricks = true;
    }
    return { hasDatasphere, hasDatabricks, count: selectedRoles.length };
  }, [selectedRoles]);

  const handleToggleRole = (roleId: string) => {
    setSelectedRoleIds(prev =>
      prev.includes(roleId) ? prev.filter(id => id !== roleId) : [...prev, roleId]
    );
  };

  const handleSelectAllFiltered = () => {
    const selectableIds = filteredRoles
      .filter(r => hasAnyRestrictions(r, allRoles) && !existingUserRoleIds.has(r.ID))
      .map(r => r.ID);
    setSelectedRoleIds(prev => Array.from(new Set([...prev, ...selectableIds])));
  };

  const handleClearSelection = () => {
    setSelectedRoleIds([]);
  };

  const handleSubmit = async () => {
    if (!assignForm.userId.trim()) return;

    setLoading(true);
    try {
      if (role) {
        // Single role assignment flow
        await api.createAssignment({
          userId: assignForm.userId.trim(),
          userName: assignForm.userName.trim() || assignForm.userId.trim(),
          role_ID: role.ID
        });
        if (onSuccess) {
          onSuccess(`Successfully assigned role "${role.name}" to ${assignForm.userId}`);
        }
      } else {
        // Multiple roles assignment flow
        const rolesToAssign = roles.filter(r => selectedRoleIds.includes(r.ID));
        if (rolesToAssign.length === 0) return;

        await Promise.all(rolesToAssign.map(r =>
          api.createAssignment({
            userId: assignForm.userId.trim(),
            userName: assignForm.userName.trim() || assignForm.userId.trim(),
            role_ID: r.ID
          })
        ));

        if (onSuccess) {
          const names = rolesToAssign.map(r => r.name).join(', ');
          onSuccess(`Successfully assigned ${rolesToAssign.length} roles to ${assignForm.userId}`);
        }
      }
    } catch (e: any) {
      if (onError) {
        onError(e.message || 'Failed to assign roles');
      }
    } finally {
      setLoading(false);
    }
  };

  const isSubmitDisabled = !assignForm.userId.trim() || (role ? false : selectedRoleIds.length === 0) || loading;

  return (
    <Dialog
      open={open}
      onClose={() => { if (!loading) onClose(); }}
      fullWidth
      maxWidth="md"
      PaperProps={{
        sx: {
          borderRadius: 2.5,
          minHeight: 620,
          backgroundImage: 'none'
        }
      }}
    >
      {/* Header */}
      <DialogTitle
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pb: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ bgcolor: 'primary.main', width: 38, height: 38 }}>
            <UserPlus size={20} />
          </Avatar>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {role ? `Assign Role: ${role.name}` : 'Assign Authorization Roles'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {role
                ? 'Assign this authorization role to a user or group.'
                : 'Select a user and choose authorization roles for real-time synchronization.'}
            </Typography>
          </Box>
        </Box>
        <IconButton size="small" onClick={onClose} disabled={loading} aria-label="Close dialog">
          <X size={18} />
        </IconButton>
      </DialogTitle>

      {/* 2-Column Content Body */}
      <DialogContent sx={{ p: 3, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
        
        {/* LEFT COLUMN: User Selection & Assignment Summary (38% width) */}
        <Box sx={{ width: { xs: '100%', md: '38%' }, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, display: 'flex', alignItems: 'center', gap: 0.8 }}>
              <Users size={16} /> 1. Select User
            </Typography>
            <UserSelection
              value={selectedScimUser}
              onChange={(e, v) => {
                setSelectedScimUser(v);
                if (v) {
                  setAssignForm({
                    userId: v.username,
                    userName: v.displayName || v.username
                  });
                } else {
                  setAssignForm({ userId: '', userName: '' });
                }
              }}
              label="Search User (SCIM)"
              placeholder="Type name, email, or username..."
              disabled={loading}
            />
          </Box>

          {/* User Profile Card */}
          {assignForm.userId ? (
            <Card
              sx={{
                p: 2,
                bgcolor: 'background.default',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                <Avatar sx={{ bgcolor: 'primary.dark', width: 34, height: 34, fontSize: '0.9rem', fontWeight: 700 }}>
                  {(assignForm.userName || assignForm.userId).charAt(0).toUpperCase()}
                </Avatar>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {assignForm.userName || assignForm.userId}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {assignForm.userId}
                  </Typography>
                </Box>
              </Box>

              {/* Already Assigned Roles */}
              <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 1 }}>
                  Currently Assigned Roles ({userExistingAssignments.length}):
                </Typography>
                {userExistingAssignments.length > 0 ? (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, maxHeight: 110, overflowY: 'auto' }}>
                    {userExistingAssignments.map(a => (
                      <Chip
                        key={a.ID}
                        size="small"
                        icon={<Shield size={12} />}
                        label={a.role?.name || a.role_ID || 'Assigned'}
                        sx={{ fontSize: '0.75rem', height: 24 }}
                      />
                    ))}
                  </Box>
                ) : (
                  <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    No roles assigned yet.
                  </Typography>
                )}
              </Box>
            </Card>
          ) : (
            <Box
              sx={{
                p: 2.5,
                border: '1px dashed',
                borderColor: 'divider',
                borderRadius: 2,
                textAlign: 'center',
                color: 'text.secondary'
              }}
            >
              <Users size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                No user selected
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Search and pick a user above to see their details and existing role assignments.
              </Typography>
            </Box>
          )}

          {/* Real-Time Sync & Impact Summary */}
          <Card
            sx={{
              p: 2,
              bgcolor: 'background.default',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              mt: 'auto'
            }}
          >
            <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
              <Zap size={13} color="#f59e0b" /> Real-Time Direct Sync
            </Typography>

            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
              {targetImpact.count === 0 ? 'No roles selected' : `${targetImpact.count} role(s) to assign`}
            </Typography>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8, mb: 1 }}>
              {targetImpact.hasDatasphere && (
                <Chip
                  size="small"
                  icon={<Cloud size={12} />}
                  label="SAP Datasphere (HANA)"
                  color="info"
                  variant="outlined"
                  sx={{ fontSize: '0.75rem', height: 24 }}
                />
              )}
              {targetImpact.hasDatabricks && (
                <Chip
                  size="small"
                  icon={<Flame size={12} />}
                  label="Databricks (Unity Catalog)"
                  color="warning"
                  variant="outlined"
                  sx={{ fontSize: '0.75rem', height: 24 }}
                />
              )}
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.75rem' }}>
              Assignments write directly to target authorization platforms without background batch delays.
            </Typography>
          </Card>
        </Box>

        {/* VERTICAL DIVIDER */}
        <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />
        <Divider sx={{ display: { xs: 'block', md: 'none' } }} />

        {/* RIGHT COLUMN: Roles Selection & Catalog (62% width) */}
        <Box sx={{ width: { xs: '100%', md: '62%' }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {role ? (
            /* Single Role View (when opened from RoleCard) */
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.8 }}>
                <Shield size={16} /> Role Details
              </Typography>
              <Card sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {role.name}
                    </Typography>
                    {role.description && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {role.description}
                      </Typography>
                    )}
                  </Box>
                  <Chip
                    size="small"
                    label={role.environment_ID || 'D'}
                    sx={{ fontWeight: 700, height: 22 }}
                  />
                </Box>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
                  <Chip
                    size="small"
                    label={role.type === 'ORG_BASED' ? 'Org-Based' : (role.parentRoles && role.parentRoles.length > 0 ? 'Derived Role' : 'Single Role')}
                    color="primary"
                    variant="outlined"
                  />
                  <Chip
                    size="small"
                    label={role.targetPlatform === 'BOTH' ? 'Both Platforms' : role.targetPlatform === 'DATABRICKS' ? 'Databricks' : 'Datasphere'}
                    color={role.targetPlatform === 'BOTH' ? 'secondary' : role.targetPlatform === 'DATABRICKS' ? 'warning' : 'info'}
                  />
                  {role.critical && (
                    <Chip size="small" label="Critical" color="error" />
                  )}
                </Box>

                {existingUserRoleIds.has(role.ID) && (
                  <Alert severity="warning" sx={{ mt: 2, py: 0.5, fontSize: '0.8125rem' }}>
                    This user is already assigned to role <strong>{role.name}</strong>.
                  </Alert>
                )}
              </Card>
            </Box>
          ) : (
            /* Multi-Role Catalog Selection */
            <>
              {/* Header & Counters */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.8 }}>
                  <Layers size={16} /> 2. Select Roles
                  <Chip
                    size="small"
                    color={selectedRoleIds.length > 0 ? 'primary' : 'default'}
                    label={`${selectedRoleIds.length} selected`}
                    sx={{ fontWeight: 700, height: 22, ml: 1 }}
                  />
                </Typography>

                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    variant="text"
                    onClick={handleSelectAllFiltered}
                    disabled={filteredRoles.length === 0}
                    sx={{ fontSize: '0.75rem', py: 0.2 }}
                  >
                    Select Filtered
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    color="inherit"
                    onClick={handleClearSelection}
                    disabled={selectedRoleIds.length === 0}
                    sx={{ fontSize: '0.75rem', py: 0.2 }}
                  >
                    Clear
                  </Button>
                </Box>
              </Box>

              {/* Search Bar */}
              <TextField
                size="small"
                fullWidth
                placeholder="Search roles by name or description..."
                value={roleSearchQuery}
                onChange={e => setRoleSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search size={16} style={{ opacity: 0.6 }} />
                    </InputAdornment>
                  ),
                  endAdornment: roleSearchQuery ? (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setRoleSearchQuery('')}>
                        <X size={14} />
                      </IconButton>
                    </InputAdornment>
                  ) : null
                }}
              />

              {/* Filter Chips Bar */}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8, alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                  Platform:
                </Typography>
                {(['ALL', 'DATASPHERE', 'DATABRICKS', 'BOTH'] as const).map(p => (
                  <Chip
                    key={p}
                    size="small"
                    clickable
                    label={p === 'ALL' ? 'All' : p === 'DATASPHERE' ? 'Datasphere' : p === 'DATABRICKS' ? 'Databricks' : 'Both'}
                    color={filterPlatform === p ? (p === 'DATABRICKS' ? 'warning' : p === 'BOTH' ? 'secondary' : 'info') : 'default'}
                    variant={filterPlatform === p ? 'filled' : 'outlined'}
                    onClick={() => setFilterPlatform(p)}
                    sx={{ height: 24, fontSize: '0.75rem' }}
                  />
                ))}

                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, ml: 1 }}>
                  Type:
                </Typography>
                {(['ALL', 'SINGLE', 'DERIVED', 'ORG_BASED'] as const).map(t => (
                  <Chip
                    key={t}
                    size="small"
                    clickable
                    label={t === 'ALL' ? 'All' : t === 'SINGLE' ? 'Single' : t === 'DERIVED' ? 'Derived' : 'Org'}
                    color={filterType === t ? 'primary' : 'default'}
                    variant={filterType === t ? 'filled' : 'outlined'}
                    onClick={() => setFilterType(t)}
                    sx={{ height: 24, fontSize: '0.75rem' }}
                  />
                ))}
              </Box>

              {/* Scrollable Role Cards List */}
              <Box
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  maxHeight: 360,
                  overflowY: 'auto',
                  p: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1
                }}
              >
                {filteredRoles.length === 0 ? (
                  <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
                    <Search size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      No matching roles found
                    </Typography>
                    <Typography variant="caption">
                      Try clearing or adjusting your search and filter criteria.
                    </Typography>
                  </Box>
                ) : (
                  filteredRoles.map(r => {
                    const isSelected = selectedRoleIds.includes(r.ID);
                    const isAlreadyAssigned = existingUserRoleIds.has(r.ID);
                    const hasRestrictions = hasAnyRestrictions(r, allRoles);
                    const isDisabled = isAlreadyAssigned || !hasRestrictions || loading;

                    return (
                      <Card
                        key={r.ID}
                        onClick={() => {
                          if (!isDisabled) handleToggleRole(r.ID);
                        }}
                        sx={{
                          p: 1.5,
                          cursor: isDisabled ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.5,
                          borderRadius: 1.5,
                          border: '1px solid',
                          borderColor: isSelected ? 'primary.main' : 'divider',
                          bgcolor: isSelected ? 'action.selected' : 'background.paper',
                          opacity: isDisabled ? 0.6 : 1,
                          transition: 'all 0.15s ease',
                          '&:hover': {
                            borderColor: isDisabled ? 'divider' : 'primary.main',
                            bgcolor: isDisabled ? 'background.paper' : 'action.hover'
                          }
                        }}
                      >
                        <Checkbox
                          size="small"
                          checked={isSelected}
                          disabled={isDisabled}
                          onChange={() => handleToggleRole(r.ID)}
                          onClick={e => e.stopPropagation()}
                          sx={{ p: 0.5 }}
                        />

                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.3 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {r.name}
                            </Typography>
                            <Chip
                              size="small"
                              label={r.environment_ID || 'D'}
                              sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700 }}
                            />
                          </Box>

                          {r.description && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{
                                display: '-webkit-box',
                                WebkitLineClamp: 1,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden'
                              }}
                            >
                              {r.description}
                            </Typography>
                          )}
                        </Box>

                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexShrink: 0 }}>
                          <Chip
                            size="small"
                            label={r.type === 'ORG_BASED' ? 'Org' : (r.parentRoles && r.parentRoles.length > 0 ? 'Derived' : 'Single')}
                            variant="outlined"
                            sx={{ height: 22, fontSize: '0.7rem' }}
                          />

                          <Chip
                            size="small"
                            label={r.targetPlatform === 'BOTH' ? 'Both' : r.targetPlatform === 'DATABRICKS' ? 'Databricks' : 'Datasphere'}
                            color={r.targetPlatform === 'BOTH' ? 'secondary' : r.targetPlatform === 'DATABRICKS' ? 'warning' : 'info'}
                            sx={{ height: 22, fontSize: '0.7rem' }}
                          />

                          {isAlreadyAssigned && (
                            <Tooltip title="This role is already assigned to the selected user">
                              <Chip
                                size="small"
                                icon={<CheckCircle2 size={12} />}
                                label="Already Assigned"
                                color="default"
                                sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }}
                              />
                            </Tooltip>
                          )}

                          {!hasRestrictions && (
                            <Tooltip title="Cannot assign: role has no restrictions configured">
                              <Chip
                                size="small"
                                icon={<Lock size={12} />}
                                label="No Restrictions"
                                color="error"
                                variant="outlined"
                                sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }}
                              />
                            </Tooltip>
                          )}
                        </Box>
                      </Card>
                    );
                  })
                )}
              </Box>
            </>
          )}
        </Box>
      </DialogContent>

      {/* Footer / Actions */}
      <DialogActions
        sx={{
          p: 2,
          px: 3,
          borderTop: '1px solid',
          borderColor: 'divider',
          justifyContent: 'space-between'
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {assignForm.userId ? (
            <>Assigning to <strong>{assignForm.userName || assignForm.userId}</strong></>
          ) : (
            'Select a user to proceed'
          )}
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button onClick={onClose} disabled={loading} color="inherit">
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <UserPlus size={16} />}
            sx={{ px: 2.5 }}
          >
            {loading
              ? 'Assigning...'
              : role
              ? 'Assign Role'
              : selectedRoleIds.length > 0
              ? `Assign ${selectedRoleIds.length} Role${selectedRoleIds.length > 1 ? 's' : ''}`
              : 'Assign Roles'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}