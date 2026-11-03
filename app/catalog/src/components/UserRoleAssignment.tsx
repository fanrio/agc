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
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel
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
  Lock,
  UserCheck
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
  accessDomains?: any[];
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
  accessDomains: propAccessDomains,
  onClose,
  onSuccess,
  onError
}: UserRoleAssignmentProps) {
  // M:N state: multiple users (M) and multiple roles (N)
  const [selectedUsers, setSelectedUsers] = useState<any[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [roleSearchQuery, setRoleSearchQuery] = useState('');
  const [filterPlatform, setFilterPlatform] = useState<'ALL' | 'DATASPHERE' | 'DATABRICKS' | 'BOTH'>('ALL');
  const [filterType, setFilterType] = useState<'ALL' | 'SINGLE' | 'DERIVED' | 'ORG_BASED'>('ALL');
  const [filterAccessDomain, setFilterAccessDomain] = useState<string>('ALL');
  const [accessDomains, setAccessDomains] = useState<any[]>(propAccessDomains || []);
  const [loading, setLoading] = useState(false);

  // Existing assignments for all selected users
  const [allExistingAssignments, setAllExistingAssignments] = useState<any[]>([]);

  // Fetch access domains when dialog opens
  useEffect(() => {
    if (open) {
      if (propAccessDomains && propAccessDomains.length > 0) {
        setAccessDomains(propAccessDomains);
      } else {
        api.getAccessDomainsFlat()
          .then((res: any) => {
            const list = Array.isArray(res) ? res : (res?.value || []);
            setAccessDomains(list);
          })
          .catch(() => {});
      }
    }
  }, [open, propAccessDomains]);

  // Reset state on open/close
  useEffect(() => {
    if (!open) {
      setSelectedUsers([]);
      setSelectedRoleIds(role ? [role.ID] : []);
      setRoleSearchQuery('');
      setFilterPlatform('ALL');
      setFilterType('ALL');
      setFilterAccessDomain('ALL');
      setAllExistingAssignments([]);
      setLoading(false);
    } else if (role) {
      setSelectedRoleIds([role.ID]);
    }
  }, [open, role]);

  // Load existing assignments for all selected users to detect duplicates in M:N matrix
  useEffect(() => {
    if (selectedUsers.length === 0) {
      setAllExistingAssignments([]);
      return;
    }

    const selectedUserIds = new Set(selectedUsers.map(u => (u.username || '').trim()).filter(Boolean));
    if (selectedUserIds.size === 0) {
      setAllExistingAssignments([]);
      return;
    }

    if (existingAssignments && existingAssignments.length > 0) {
      const userAss = existingAssignments.filter(a => selectedUserIds.has((a.userId || '').trim()));
      setAllExistingAssignments(userAss);
    } else {
      api.getAssignments()
        .then((res: any) => {
          const list = Array.isArray(res) ? res : (res?.value || []);
          const userAss = list.filter((a: any) => selectedUserIds.has((a.userId || '').trim()));
          setAllExistingAssignments(userAss);
        })
        .catch(() => {});
    }
  }, [selectedUsers, existingAssignments]);

  // Map of userId -> Set of assigned role IDs
  const existingAssignmentsByUser = useMemo(() => {
    const map = new Map<string, Set<string>>();
    allExistingAssignments.forEach(a => {
      const uid = (a.userId || '').trim();
      const rid = a.role_ID || a.role?.ID;
      if (uid && rid) {
        if (!map.has(uid)) map.set(uid, new Set());
        map.get(uid)!.add(rid);
      }
    });
    return map;
  }, [allExistingAssignments]);

  // Map of access domains for name lookup and dropdown options
  const accessDomainMap = useMemo(() => {
    const map = new Map<string, string>();
    accessDomains.forEach(d => {
      if (d.ID) map.set(d.ID, d.name || d.description || d.ID);
    });
    roles.forEach(r => {
      const dId = r.accessDomain_ID || r.accessDomain?.ID;
      const dName = r.accessDomain?.name || (dId ? map.get(dId) : undefined);
      if (dId && !map.has(dId)) {
        map.set(dId, dName || dId);
      }
    });
    return map;
  }, [accessDomains, roles]);

  const accessDomainOptions = useMemo(() => {
    return Array.from(accessDomainMap.entries()).map(([id, label]) => ({ id, label }));
  }, [accessDomainMap]);

  // Filtered roles list based on search, platform, type, and access domain filters
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

      // Access Domain filter
      if (filterAccessDomain !== 'ALL') {
        const roleDomainId = r.accessDomain_ID || r.accessDomain?.ID;
        if (roleDomainId !== filterAccessDomain) return false;
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
  }, [roles, filterPlatform, filterType, filterAccessDomain, roleSearchQuery]);

  // Selected roles objects
  const rolesToAssign = useMemo(() => {
    if (role) return [role];
    return roles.filter(r => selectedRoleIds.includes(r.ID));
  }, [role, roles, selectedRoleIds]);

  // Compute all M:N (user, role) pairs to create, automatically skipping existing assignments
  const pairsToCreate = useMemo(() => {
    const pairs: { userId: string; userName: string; role_ID: string }[] = [];
    for (const u of selectedUsers) {
      const uid = (u.username || '').trim();
      if (!uid) continue;
      const uname = (u.displayName || u.username || '').trim();
      const userAssigned = existingAssignmentsByUser.get(uid) || new Set();

      for (const r of rolesToAssign) {
        if (!userAssigned.has(r.ID)) {
          pairs.push({
            userId: uid,
            userName: uname,
            role_ID: r.ID
          });
        }
      }
    }
    return pairs;
  }, [selectedUsers, rolesToAssign, existingAssignmentsByUser]);

  // Target platforms impact
  const targetImpact = useMemo(() => {
    let hasDatasphere = false;
    let hasDatabricks = false;
    for (const r of rolesToAssign) {
      const plat = r.targetPlatform || 'DATASPHERE';
      if (plat === 'DATASPHERE' || plat === 'BOTH') hasDatasphere = true;
      if (plat === 'DATABRICKS' || plat === 'BOTH') hasDatabricks = true;
    }
    return { hasDatasphere, hasDatabricks, count: rolesToAssign.length };
  }, [rolesToAssign]);

  const handleToggleRole = (roleId: string) => {
    setSelectedRoleIds(prev =>
      prev.includes(roleId) ? prev.filter(id => id !== roleId) : [...prev, roleId]
    );
  };

  const handleSelectAllFiltered = () => {
    // Select all filtered roles that have restrictions and are not already assigned to all selected users
    const selectableIds = filteredRoles
      .filter(r => {
        if (!hasAnyRestrictions(r, allRoles)) return false;
        if (selectedUsers.length > 0) {
          const assignedCount = selectedUsers.filter(u => existingAssignmentsByUser.get(u.username)?.has(r.ID)).length;
          if (assignedCount === selectedUsers.length) return false;
        }
        return true;
      })
      .map(r => r.ID);
    setSelectedRoleIds(prev => Array.from(new Set([...prev, ...selectableIds])));
  };

  const handleClearSelection = () => {
    setSelectedRoleIds([]);
  };

  const handleRemoveUser = (username: string) => {
    setSelectedUsers(prev => prev.filter(u => u.username !== username));
  };

  const handleSubmit = async () => {
    if (selectedUsers.length === 0 || rolesToAssign.length === 0) return;
    if (pairsToCreate.length === 0) {
      if (onSuccess) {
        onSuccess('All selected users already have the chosen roles assigned.');
      }
      onClose();
      return;
    }

    setLoading(true);
    try {
      await Promise.all(pairsToCreate.map(pair => api.createAssignment(pair)));

      if (onSuccess) {
        const uCount = selectedUsers.length;
        const rCount = rolesToAssign.length;
        const pCount = pairsToCreate.length;
        onSuccess(`Successfully created ${pCount} assignment${pCount > 1 ? 's' : ''} (${uCount} user${uCount > 1 ? 's' : ''} × ${rCount} role${rCount > 1 ? 's' : ''})`);
      }
      onClose();
    } catch (e: any) {
      if (onError) {
        onError(e.message || 'Failed to assign roles');
      }
    } finally {
      setLoading(false);
    }
  };

  const isSubmitDisabled = selectedUsers.length === 0 || rolesToAssign.length === 0 || pairsToCreate.length === 0 || loading;

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
          backgroundImage: 'none',
          overflowX: 'hidden'
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
              {role ? `Assign Role: ${role.name}` : 'M:N Role Assignment'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {role
                ? 'Assign this authorization role to one or multiple users simultaneously.'
                : 'Select multiple users (M) and multiple authorization roles (N) for direct real-time synchronization.'}
            </Typography>
          </Box>
        </Box>
        <IconButton size="small" onClick={onClose} disabled={loading} aria-label="Close dialog">
          <X size={18} />
        </IconButton>
      </DialogTitle>

      {/* 2-Column Content Body */}
      <DialogContent sx={{ p: 3, overflowX: 'hidden', display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
        
        {/* LEFT COLUMN: M Users Selection & Overview (330px fixed width on desktop) */}
        <Box sx={{ width: { xs: '100%', md: 330 }, flexShrink: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.8 }}>
              <Users size={16} /> 1. Select Users
              <Chip
                size="small"
                color={selectedUsers.length > 0 ? 'primary' : 'default'}
                label={`${selectedUsers.length} selected`}
                sx={{ fontWeight: 700, height: 22, ml: 1 }}
              />
            </Typography>
            {selectedUsers.length > 0 && (
              <Button
                size="small"
                variant="text"
                color="inherit"
                onClick={() => setSelectedUsers([])}
                sx={{ fontSize: '0.75rem', py: 0.2 }}
              >
                Clear
              </Button>
            )}
          </Box>

          {/* UserSelection Autocomplete with multi-select (M:N) */}
          <UserSelection
            multiple
            value={selectedUsers}
            onChange={(e, v) => {
              setSelectedUsers(Array.isArray(v) ? v : v ? [v] : []);
            }}
            label="Search & Add Users (SCIM)"
            placeholder="Type name, email, or username..."
            disabled={loading}
          />

          {/* Selected Users Cards / List */}
          {selectedUsers.length === 0 ? (
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
                No users selected
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Search and add one or multiple users (M:N) above to assign roles simultaneously.
              </Typography>
            </Box>
          ) : selectedUsers.length === 1 ? (
            /* Single User Detail View */
            <Card
              sx={{
                p: 2,
                bgcolor: 'background.default',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                  <Avatar sx={{ bgcolor: 'primary.dark', width: 34, height: 34, fontSize: '0.9rem', fontWeight: 700 }}>
                    {(selectedUsers[0].displayName || selectedUsers[0].username).charAt(0).toUpperCase()}
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {selectedUsers[0].displayName || selectedUsers[0].username}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {selectedUsers[0].username}
                    </Typography>
                  </Box>
                </Box>
                <IconButton size="small" onClick={() => setSelectedUsers([])} aria-label="Remove user">
                  <X size={14} />
                </IconButton>
              </Box>

              {/* Already Assigned Roles */}
              <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 1 }}>
                  Currently Assigned Roles ({allExistingAssignments.length}):
                </Typography>
                {allExistingAssignments.length > 0 ? (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, maxHeight: 110, overflowY: 'auto' }}>
                    {allExistingAssignments.map(a => (
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
            /* Multiple Users List View */
            <Card
              sx={{
                p: 1.5,
                bgcolor: 'background.default',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 1
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>
                  Selected Users ({selectedUsers.length})
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {allExistingAssignments.length} total existing roles
                </Typography>
              </Box>

              <Box sx={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.8, pr: 0.5 }}>
                {selectedUsers.map(u => {
                  const userRolesCount = existingAssignmentsByUser.get(u.username)?.size || 0;
                  return (
                    <Box
                      key={u.username}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        p: 0.8,
                        px: 1,
                        borderRadius: 1.5,
                        bgcolor: 'background.paper',
                        border: '1px solid',
                        borderColor: 'divider'
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
                        <Avatar sx={{ bgcolor: 'primary.dark', width: 26, height: 26, fontSize: '0.75rem', fontWeight: 700 }}>
                          {(u.displayName || u.username).charAt(0).toUpperCase()}
                        </Avatar>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8125rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {u.displayName || u.username}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {u.username}{userRolesCount > 0 ? ` • ${userRolesCount} role${userRolesCount > 1 ? 's' : ''}` : ''}
                          </Typography>
                        </Box>
                      </Box>
                      <IconButton
                        size="small"
                        onClick={() => handleRemoveUser(u.username)}
                        aria-label={`Remove ${u.displayName || u.username}`}
                        sx={{ p: 0.4, ml: 0.5 }}
                      >
                        <X size={13} />
                      </IconButton>
                    </Box>
                  );
                })}
              </Box>
            </Card>
          )}

          {/* Real-Time Sync & M:N Impact Summary */}
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
              <Zap size={13} color="#f59e0b" /> M:N Direct Sync Impact
            </Typography>

            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
              {selectedUsers.length === 0 || rolesToAssign.length === 0
                ? 'Select users and roles'
                : `${selectedUsers.length} User${selectedUsers.length > 1 ? 's' : ''} × ${rolesToAssign.length} Role${rolesToAssign.length > 1 ? 's' : ''}`}
            </Typography>

            <Typography variant="caption" sx={{ color: pairsToCreate.length > 0 ? 'primary.main' : 'text.secondary', fontWeight: 600, display: 'block', mb: 1 }}>
              {pairsToCreate.length === 0
                ? '0 new assignments to create'
                : `${pairsToCreate.length} new assignment${pairsToCreate.length > 1 ? 's' : ''} will be created`}
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
              Assignments write directly to target authorization platforms in real-time.
            </Typography>
          </Card>
        </Box>

        {/* VERTICAL DIVIDER */}
        <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />
        <Divider sx={{ display: { xs: 'block', md: 'none' } }} />

        {/* RIGHT COLUMN: Roles Selection & Catalog */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
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
              </Card>
            </Box>
          ) : (
            /* Multi-Role Catalog Selection (N) */
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

              {/* Filter Dropdowns Bar: Platform, Type, Access Domain */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 1 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel id="filter-platform-label">Platform</InputLabel>
                  <Select
                    labelId="filter-platform-label"
                    id="filter-platform-select"
                    value={filterPlatform}
                    label="Platform"
                    onChange={e => setFilterPlatform(e.target.value as any)}
                    sx={{ fontSize: '0.8125rem' }}
                  >
                    <MenuItem value="ALL">All Platforms</MenuItem>
                    <MenuItem value="DATASPHERE">Datasphere</MenuItem>
                    <MenuItem value="DATABRICKS">Databricks</MenuItem>
                    <MenuItem value="BOTH">Both</MenuItem>
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth>
                  <InputLabel id="filter-type-label">Type</InputLabel>
                  <Select
                    labelId="filter-type-label"
                    id="filter-type-select"
                    value={filterType}
                    label="Type"
                    onChange={e => setFilterType(e.target.value as any)}
                    sx={{ fontSize: '0.8125rem' }}
                  >
                    <MenuItem value="ALL">All Types</MenuItem>
                    <MenuItem value="SINGLE">Single</MenuItem>
                    <MenuItem value="DERIVED">Derived</MenuItem>
                    <MenuItem value="ORG_BASED">Org-Based</MenuItem>
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth>
                  <InputLabel id="filter-domain-label">Access Domain</InputLabel>
                  <Select
                    labelId="filter-domain-label"
                    id="filter-domain-select"
                    value={filterAccessDomain}
                    label="Access Domain"
                    onChange={e => setFilterAccessDomain(e.target.value)}
                    sx={{ fontSize: '0.8125rem' }}
                  >
                    <MenuItem value="ALL">All Access Domains</MenuItem>
                    {accessDomainOptions.map(dom => (
                      <MenuItem key={dom.id} value={dom.id}>
                        {dom.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              {/* Scrollable Role Cards List */}
              <Box
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  maxHeight: 360,
                  overflowY: 'auto',
                  overflowX: 'hidden',
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
                    const assignedUsersCount = selectedUsers.filter(u =>
                      existingAssignmentsByUser.get(u.username)?.has(r.ID)
                    ).length;
                    const isAssignedToAll = selectedUsers.length > 0 && assignedUsersCount === selectedUsers.length;
                    const isPartiallyAssigned = assignedUsersCount > 0 && !isAssignedToAll;
                    const hasRestrictions = hasAnyRestrictions(r, allRoles);
                    const isDisabled = isAssignedToAll || !hasRestrictions || loading;
                    const domainId = r.accessDomain_ID || r.accessDomain?.ID;
                    const domainLabel = domainId ? accessDomainMap.get(domainId) || domainId : null;

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
                          overflow: 'hidden',
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
                          sx={{ p: 0.5, flexShrink: 0 }}
                        />

                        <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.3 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.name}
                            </Typography>
                            <Chip
                              size="small"
                              label={r.environment_ID || 'D'}
                              sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 }}
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

                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: { xs: '100%', sm: '50%' } }}>
                          {domainLabel && (
                            <Chip
                              size="small"
                              label={domainLabel}
                              variant="outlined"
                              sx={{ height: 22, fontSize: '0.7rem' }}
                            />
                          )}

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

                          {isAssignedToAll && (
                            <Tooltip title="This role is already assigned to all selected users">
                              <Chip
                                size="small"
                                icon={<CheckCircle2 size={12} />}
                                label={selectedUsers.length > 1 ? `Assigned to all (${assignedUsersCount})` : 'Assigned'}
                                color="default"
                                sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }}
                              />
                            </Tooltip>
                          )}

                          {isPartiallyAssigned && (
                            <Tooltip title={`Already assigned to ${assignedUsersCount} of ${selectedUsers.length} selected users. Selecting this role will assign it to the remaining ${selectedUsers.length - assignedUsersCount} user(s).`}>
                              <Chip
                                size="small"
                                icon={<UserCheck size={12} />}
                                label={`Assigned ${assignedUsersCount}/${selectedUsers.length}`}
                                color="warning"
                                variant="outlined"
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
          {selectedUsers.length === 0 ? (
            'Select users and roles to proceed'
          ) : (
            <>
              <strong>{selectedUsers.length}</strong> user{selectedUsers.length > 1 ? 's' : ''} &bull;{' '}
              <strong>{rolesToAssign.length}</strong> role{rolesToAssign.length > 1 ? 's' : ''} &bull;{' '}
              <strong style={{ color: pairsToCreate.length > 0 ? '#1976d2' : undefined }}>{pairsToCreate.length}</strong> new assignment{pairsToCreate.length > 1 ? 's' : ''}
            </>
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
              : pairsToCreate.length > 0
              ? `Assign ${pairsToCreate.length} Role Assignment${pairsToCreate.length > 1 ? 's' : ''}`
              : 'Assign Roles'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
