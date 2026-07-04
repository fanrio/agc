import { useState, useEffect } from 'react';
import { Box, Card, Typography, Stepper, Step, StepLabel, Button, TextField, FormControl, FormGroup, FormControlLabel, Checkbox, CircularProgress, Alert, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, IconButton, InputLabel, Select, MenuItem, OutlinedInput, ListItemText, Snackbar, Autocomplete, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import { Check, ChevronRight, ChevronLeft, Shield, Building2, PlayCircle, Zap, GitBranch, X, Users, AlertTriangle } from 'lucide-react';
import * as api from '../api';
import RestrictionBuilder from './RestrictionBuilder';
import { RestrictionDisplay } from './RestrictionBuilder';

const STEPS = [
  { id: 'origin',       label: 'Origin & Parent' },
  { id: 'restrictions', label: 'Restrictions' },
  { id: 'identity',     label: 'Approvers' },
  { id: 'review',       label: 'Review & Deploy' },
];

import { ENV_LABEL, ENV_COLOR, isCriticalRestriction, isRoleInScope } from '../utils/helpers';

export default function Wizard({ context = {}, onDone, permissions, allowFreeNavigation = false }) {
  const [step, setStep]                   = useState(0);
  const [roleType, setRoleType]           = useState(context.orgNodeId ? 'ORG_BASED' : 'SINGLE');
  const [selectedOrgNodeId, setOrgNode]   = useState(context.orgNodeId || '');
  const [selectedParentIds, setSelectedParentIds] = useState(context.parentRoleId ? [context.parentRoleId] : []);
  const [roleName, setRoleName]           = useState('');
  const [description, setDescription]     = useState('');
  const [restrictions, setRestrictions]   = useState([]);
  const [inherited, setInherited]         = useState([]);
  const [approverInput, setApproverInput] = useState('');
  const [approvers, setApprovers]         = useState([]);
  const [simRows, setSimRows]             = useState('[{"Country":"Germany","Plant":"DE01"}]');
  const [simResults, setSimResults]       = useState(null);
  const [orgNodes, setOrgNodes]           = useState([]);
  const [allRoles, setAllRoles]           = useState([]);
  const [restrictionFields, setFields]    = useState([]);
  const [loading, setLoading]             = useState(false);
  const [done, setDone]                   = useState(false);
  const [isEditMode, setIsEditMode]       = useState(!!context.roleId);
  const [snackbar, setSnackbar]           = useState({ open: false, message: '', severity: 'error' });
  const [ldapOptions, setLdapOptions]     = useState([]);
  const [ldapLoading, setLdapLoading]     = useState(false);

  // States for optional direct assignment on creation
  const [critical, setCritical]           = useState(false);
  const [environmentId, setEnvironmentId] = useState('D');
  const [environments, setEnvironments]   = useState([]);
  const [assignUserId, setAssignUserId]   = useState('');
  const [assignUserName, setAssignUserName] = useState('');

  const [showImpactDialog, setShowImpactDialog] = useState(false);
  const [impactData, setImpactData]             = useState({ derivedRoles: [], affectedUsers: [] });
  const [originalCritical, setOriginalCritical] = useState(false);
  const [originalRestrictions, setOriginalRestrictions] = useState([]);
  const [isCriticalManuallySet, setIsCriticalManuallySet] = useState(!!context.roleId);
  const [maxStepReached, setMaxStepReached] = useState(context.roleId ? 3 : 0);

  useEffect(() => {
    if (step > maxStepReached) {
      setMaxStepReached(step);
    }
  }, [step, maxStepReached]);

  const canNavigateTo = (targetStep) => {
    if (targetStep <= step) return true;
    if (isEditMode) return true;
    if (allowFreeNavigation) return true;
    if (step === 0 && roleType === 'ORG_BASED' && !selectedOrgNodeId) return false;
    return targetStep <= maxStepReached;
  };

  const canManageThisDerivedWizard = () => {
    if (!permissions) return false;
    if (!permissions.canManageDerivedRoles) return false;
    const scope = permissions.managedDerivedRolesScope;
    if (!scope || scope.trim() === '' || scope.trim().toUpperCase() === 'ALL' || scope.trim() === '*') {
      return true;
    }

    if (context.roleId && isRoleInScope(context.roleId, roleName, scope)) {
      return true;
    }

    if (selectedParentIds && selectedParentIds.length > 0) {
      // Use stricter check (every) if it's a JSON array
      try {
        const parsed = JSON.parse(scope);
        if (Array.isArray(parsed)) {
          return selectedParentIds.every(parentId => {
            const parentRole = allRoles.find(r => r.ID === parentId);
            return isRoleInScope(parentId, parentRole?.name, scope);
          });
        }
      } catch (e) {}

      // Fallback to lax check (some) for comma-separated list
      return selectedParentIds.some(parentId => {
        const parentRole = allRoles.find(r => r.ID === parentId);
        return isRoleInScope(parentId, parentRole?.name, scope);
      });
    }
    return true;
  };

  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  const handleRoleNameBlur = async () => {
    const name = roleName.trim();
    if (!name || isEditMode) return;
    try {
      const exists = allRoles.some(r => r.name.toLowerCase() === name.toLowerCase());
      if (exists) {
        setSnackbar({ open: true, message: `A role with name "${name}" already exists.`, severity: 'error' });
      } else {
        setSnackbar(prev => prev.message?.includes('already exists') ? { open: false, message: '', severity: 'error' } : prev);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Debounced LDAP search querying mock server
  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      setLdapLoading(true);
      api.searchLdapUsers(approverInput)
        .then(res => {
          setLdapOptions(res || []);
          setLdapLoading(false);
        })
        .catch(err => {
          console.error(err);
          setLdapLoading(false);
        });
    }, 250);
    return () => clearTimeout(delayDebounce);
  }, [approverInput]);

  // Load reference data and combine restriction fields with node types
  useEffect(() => {
    api.getRoles().then(setAllRoles).catch(console.error);
    api.getAllOrgNodesFlat().then(setOrgNodes).catch(console.error);
    api.getEnvironments().then(setEnvironments).catch(console.error);
    
    api.getRestrictionFields()
      .then(fields => {
        setFields(fields);
      })
      .catch(console.error);
  }, []);

  // Fetch existing role details for editing
  useEffect(() => {
    if (context.roleId) {
      setLoading(true);
      api.getRoles().then(all => {
        const role = all.find(r => r.ID === context.roleId);
        if (role) {
          try {
            setRoleType(role.type === 'ORG_BASED' ? 'ORG_BASED' : 'SINGLE');
            setRoleName(role.name || '');
            setDescription(role.description || '');
            setOrgNode(role.orgNode_ID || '');
            
            const parentIds = role.parentRoles 
              ? role.parentRoles.map(pr => pr.parent?.ID || pr.parent_ID).filter(Boolean)
              : [];
            setSelectedParentIds(parentIds);
            
            setRestrictions(role.ownRestrictions || []);
            setOriginalRestrictions(role.ownRestrictions || []);
            setApprovers(role.approvers || []);
            setCritical(!!role.critical);
            setOriginalCritical(!!role.critical);
            setEnvironmentId(role.environment_ID || 'D');
          } catch (err) {
            console.error('Error populating role details in wizard:', err);
          }
        }
        setLoading(false);
      }).catch(e => { console.error(e); setLoading(false); });
    }
  }, [context.roleId]);

  // Load inherited restrictions when selectedParentIds changes
  useEffect(() => {
    if (roleType === 'SINGLE' && selectedParentIds.length > 0) {
      Promise.all(selectedParentIds.map(id => api.resolveEffective(id)))
        .then(results => {
          const merged = [];
          const seen = new Set();
          for (const resList of results) {
            for (const r of resList) {
              if (!seen.has(r.restrictionId)) {
                seen.add(r.restrictionId);
                merged.push(r);
              }
            }
          }
          setInherited(merged);
        })
        .catch(console.error);
    } else {
      setInherited([]);
    }
  }, [selectedParentIds, roleType]);

  // Auto-calculate critical status based on restrictions
  useEffect(() => {
    if (isCriticalManuallySet) return;
    const allRestrictions = [...restrictions, ...inherited];
    if (allRestrictions.length > 0) {
      const allCritical = allRestrictions.every(r => isCriticalRestriction(r, orgNodes));
      setCritical(allCritical);
    }
  }, [restrictions, inherited, orgNodes, isCriticalManuallySet]);

  // Auto-generate role name when org node selected
  useEffect(() => {
    if (isEditMode) return;
    if (roleType === 'ORG_BASED' && selectedOrgNodeId) {
      const node = orgNodes.find(n => n.ID === selectedOrgNodeId);
      if (node) setRoleName(`ROLE_ORG_${node.name.replace(/\s+/g,'_').toUpperCase()}`);
    } else if (roleType === 'SINGLE' && selectedParentIds.length > 0) {
      const parent = allRoles.find(r => r.ID === selectedParentIds[0]);
      if (parent) setRoleName(`${parent.name}_CUSTOM`);
    }
  }, [roleType, selectedOrgNodeId, selectedParentIds, orgNodes, allRoles, isEditMode]);

  function addApprover() {
    const v = approverInput.trim();
    if (v && !approvers.find(a => a.userId === v)) {
      setApprovers(prev => [...prev, { userId: v, userName: v, ID: `temp-${Date.now()}` }]);
    }
    setApproverInput('');
  }

  async function runSimulation() {
    let rows;
    try { 
      rows = JSON.parse(simRows); 
    } catch { 
      setSnackbar({ open: true, message: 'Invalid JSON in sample data', severity: 'error' }); 
      return; 
    }
    setLoading(true);
    try {
      const allRestrictions = [...inherited, ...restrictions];
      const results = await api.simulateAccess(null, rows, allRestrictions);
      setSimResults(results);
    } catch(e) { 
      setSnackbar({ open: true, message: e.message, severity: 'error' }); 
    }
    setLoading(false);
  }

  const getDerivedRolesRecursive = (roleId, rolesList) => {
    const derived = [];
    const queue = [roleId];
    const visited = new Set();
    while (queue.length > 0) {
      const currentId = queue.shift();
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      
      const children = rolesList.filter(r => 
        r.parentRoles && r.parentRoles.some(pr => pr.parent_ID === currentId)
      );
      for (const child of children) {
        if (!visited.has(child.ID)) {
          derived.push(child);
          queue.push(child.ID);
        }
      }
    }
    return derived;
  };

  const restrictionsChanged = (current, original) => {
    if (current.length !== original.length) return true;
    const hasMatch = (r, list) => list.some(o => 
      o.field === r.field && 
      o.filterType === r.filterType && 
      o.value === r.value
    );
    for (const r of current) {
      if (!hasMatch(r, original)) return true;
    }
    return false;
  };

  async function handleSaveClick() {
    if (!isEditMode) {
      await handleDeploy();
      return;
    }

    const criticalChanged = critical !== originalCritical;
    const restChanged = restrictionsChanged(restrictions, originalRestrictions);

    if (!criticalChanged && !restChanged) {
      // If neither critical status nor restrictions have changed, save directly without confirmation.
      await handleDeploy();
      return;
    }
    
    setLoading(true);
    try {
      const latestRoles = await api.getRoles();
      setAllRoles(latestRoles);
      
      const currentRole = latestRoles.find(r => r.ID === context.roleId);
      const derived = getDerivedRolesRecursive(context.roleId, latestRoles);
      
      const users = [];
      const rolesToCheck = [currentRole, ...derived].filter(Boolean);
      for (const r of rolesToCheck) {
        if (r.assignments) {
          for (const a of r.assignments) {
            if (!users.some(u => u.userId === a.userId)) {
              users.push({
                userId: a.userId,
                userName: a.userName || 'Unknown User',
                assignedRole: r.name
              });
            }
          }
        }
      }
      
      setImpactData({
        derivedRoles: derived,
        affectedUsers: users
      });
      setShowImpactDialog(true);
    } catch (e) {
      setSnackbar({ open: true, message: `Failed to analyze impact: ${e.message}`, severity: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function handleDeploy() {
    setLoading(true);
    try {
      let roleId;

      if (isEditMode) {
        roleId = context.roleId;
        // Don't send name if it's read-only or hasn't changed. The description is safe to update.
        await api.updateRole(roleId, { 
          description, 
          critical,
          environment_ID: environmentId,
          type: roleType === 'ORG_BASED' ? 'ORG_BASED' : (selectedParentIds.length > 0 ? 'DERIVED' : 'SINGLE')
        });

        const allRoles = await api.getRoles();
        const role = allRoles.find(r => r.ID === roleId);
        if (role) {
          if (role.ownRestrictions) {
            for (const r of role.ownRestrictions) {
              await api.deleteRestriction(r.ID);
            }
          }
          if (role.approvers) {
            for (const ap of role.approvers) {
              await api.deleteRoleApprover(ap.ID);
            }
          }
          if (role.parentRoles) {
            for (const pr of role.parentRoles) {
              await api.deleteRoleInheritance(pr.ID);
            }
          }
        }

        for (const r of restrictions) {
          await api.createRestriction({ role_ID: roleId, field: r.field, filterType: r.filterType, value: r.value, sourceLabel: 'Own' });
        }

        if (roleType === 'SINGLE' && selectedParentIds.length > 0) {
          for (const parentId of selectedParentIds) {
            await api.createRoleInheritance({ role_ID: roleId, parent_ID: parentId });
          }
        }
      } else if (roleType === 'ORG_BASED') {
        const result = await api.generateOrgRole(selectedOrgNodeId);
        roleId = result.roleId;
        await api.updateRole(roleId, { name: roleName || result.roleName, description, critical, environment_ID: environmentId });
      } else {
        const role = await api.createRole({
          name: roleName,
          type: selectedParentIds.length > 0 ? 'DERIVED' : 'SINGLE',
          description,
          critical,
          environment_ID: environmentId,
        });
        roleId = role.ID;

        for (const parentId of selectedParentIds) {
          await api.createRoleInheritance({ role_ID: roleId, parent_ID: parentId });
        }

        for (const r of restrictions) {
          await api.createRestriction({ role_ID: roleId, field: r.field, filterType: r.filterType, value: r.value, sourceLabel: 'Own' });
        }
      }

      for (const a of approvers) {
        await api.createRoleApprover({ role_ID: roleId, userId: a.userId, userName: a.userName });
      }

      // Direct assignment on creation
      if (!isEditMode && assignUserId.trim()) {
        await api.createAssignment({
          userId: assignUserId.trim(),
          userName: assignUserName.trim() || assignUserId.trim(),
          role_ID: roleId
        });
      }

      setDone(true);
    } catch(e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
    setLoading(false);
  }

  if (done) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 8, animation: 'fadeIn 0.3s' }}>
        <Box sx={{ width: 64, height: 64, borderRadius: '50%', bgcolor: 'success.light', border: '2px solid', borderColor: 'success.main', display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 3 }}>
          <Check size={28} color="#1b5e20" />
        </Box>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>{isEditMode ? 'Role Updated' : 'Role Deployed'}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>The authorization role has been {isEditMode ? 'updated' : 'created'} successfully.</Typography>
        <Button variant="contained" onClick={onDone} startIcon={<Shield size={15} />}>View All Roles</Button>
      </Box>
    );
  }

  const getRoleRestrictionFields = (roleId) => {
    const roleObj = allRoles.find(r => r.ID === roleId);
    if (!roleObj) return [];
    const own = roleObj.ownRestrictions ? roleObj.ownRestrictions.map(r => r.field) : [];
    const fields = new Set(own);
    const queue = roleObj.parentRoles ? roleObj.parentRoles.map(pr => pr.parent?.ID || pr.parent_ID).filter(Boolean) : [];
    const visited = new Set(queue);
    while (queue.length > 0) {
      const currId = queue.shift();
      const currRole = allRoles.find(r => r.ID === currId);
      if (currRole) {
        if (currRole.ownRestrictions) {
          currRole.ownRestrictions.forEach(r => fields.add(r.field));
        }
        if (currRole.parentRoles) {
          currRole.parentRoles.forEach(pr => {
            const pid = pr.parent?.ID || pr.parent_ID;
            if (pid && !visited.has(pid)) {
              visited.add(pid);
              queue.push(pid);
            }
          });
        }
      }
    }
    return restrictionFields.filter(f => !fields.has(f.name));
  };

  const isDerived = selectedParentIds.length > 0;
  const selectableRestrictionFields = (() => {
    if (!isDerived) return restrictionFields;
    if (!permissions || !permissions.canManageDerivedRoles) return [];

    // Calculate all fields used by parent role or its ancestors
    const usedFields = new Set();
    selectedParentIds.forEach(parentId => {
      const roleObj = allRoles.find(r => r.ID === parentId);
      if (roleObj) {
        if (roleObj.ownRestrictions) {
          roleObj.ownRestrictions.forEach(r => usedFields.add(r.field.toLowerCase()));
        }
        const queue = roleObj.parentRoles ? roleObj.parentRoles.map(pr => pr.parent?.ID || pr.parent_ID).filter(Boolean) : [];
        const visited = new Set(queue);
        while (queue.length > 0) {
          const currId = queue.shift();
          const currRole = allRoles.find(r => r.ID === currId);
          if (currRole) {
            if (currRole.ownRestrictions) {
              currRole.ownRestrictions.forEach(r => usedFields.add(r.field.toLowerCase()));
            }
            if (currRole.parentRoles) {
              currRole.parentRoles.forEach(pr => {
                const pid = pr.parent?.ID || pr.parent_ID;
                if (pid && !visited.has(pid)) {
                  visited.add(pid);
                  queue.push(pid);
                }
              });
            }
          }
        }
      }
    });

    const scopeStr = permissions.managedDerivedRolesScope;
    // Case 1: Unrestricted scope
    if (!scopeStr || scopeStr.trim() === '' || scopeStr.trim().toUpperCase() === 'ALL' || scopeStr.trim() === '*') {
      return restrictionFields.filter(f => !usedFields.has(f.name.toLowerCase()));
    }

    let scopeList = [];
    try {
      scopeList = JSON.parse(scopeStr);
      if (!Array.isArray(scopeList)) scopeList = [];
    } catch (e) {
      // Backward compatibility: if it is a comma-separated list of role names/IDs
      const terms = scopeStr.split(',').map(s => s.trim().toLowerCase());
      const hasAllowedParent = selectedParentIds.some(parentId => {
        const parent = allRoles.find(r => r.ID === parentId);
        return parent && (terms.includes(parent.name.toLowerCase()) || terms.includes(parent.ID.toLowerCase()));
      });
      return hasAllowedParent ? restrictionFields.filter(f => !usedFields.has(f.name.toLowerCase())) : [];
    }

    // Case 2: Structured scope (JSON list)
    const allowedFieldsSet = new Set();
    let hasParentMatch = false;

    selectedParentIds.forEach(parentId => {
      const parentRole = allRoles.find(r => r.ID === parentId);
      const entry = scopeList.find(s => s.roleId === parentId || (parentRole && s.roleId === parentRole.name));
      if (entry) {
        hasParentMatch = true;
        if (entry.fields && entry.fields.length > 0) {
          entry.fields.forEach(f => allowedFieldsSet.add(f.toLowerCase()));
        } else {
          // If no specific fields are restricted in the scope, all fields not used by the parent are allowed
          restrictionFields.forEach(f => allowedFieldsSet.add(f.name.toLowerCase()));
        }
      }
    });

    if (!hasParentMatch) return [];

    // Selectable fields = fields in allowedFieldsSet AND NOT in usedFields
    return restrictionFields.filter(f => allowedFieldsSet.has(f.name.toLowerCase()) && !usedFields.has(f.name.toLowerCase()));
  })();

  return (
    <Box sx={{ animation: 'fadeIn 0.3s' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>Authorization Wizard</Typography>
        <Typography variant="body2" color="text.secondary">Create a new Org-Based Role or Single Role step by step</Typography>
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

      {/* Stepper */}
      <Box sx={{ mb: 4 }}>
        <Stepper activeStep={step} alternativeLabel>
          {STEPS.map((s, i) => (
            <Step key={s.id} onClick={() => { if (canNavigateTo(i)) setStep(i); }} sx={{ cursor: canNavigateTo(i) ? 'pointer' : 'default' }}>
              <StepLabel>{s.label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      {/* Step Content */}
      <Box sx={{ mb: 4 }}>
        {/* STEP 0: Origin */}
        {step === 0 && (
          <Card sx={{ p: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Role Origin</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mb: 3 }}>
              {[
                { type: 'ORG_BASED', icon: Zap, label: 'Org-Based Role', desc: 'Auto-generated from an Org Structure node', color: '#1d4ed8', disabled: permissions && !permissions.canManageOrgRoles },
                { type: 'SINGLE',    icon: Shield, label: 'Single Role', desc: 'A custom role containing specific restrictions', color: '#7c3aed', disabled: permissions && !permissions.canManageSingleRoles },
              ].map(opt => {
                const isSelected = roleType === opt.type;
                const isDisabled = opt.disabled || isEditMode;
                return (
                  <Box
                    key={opt.type}
                    onClick={() => !isDisabled && setRoleType(opt.type)}
                    sx={{
                      p: 2,
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: isSelected ? opt.color : 'divider',
                      bgcolor: isSelected ? 'action.hover' : 'transparent',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      opacity: isDisabled && !isSelected ? 0.5 : 1,
                      transition: 'all 0.2s',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0.5,
                      '&:hover': {
                        borderColor: isDisabled ? 'none' : isSelected ? opt.color : 'action.active',
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <opt.icon size={18} color={opt.color} />
                      <Typography variant="body1" sx={{ fontWeight: 700 }}>{opt.label}</Typography>
                      {isSelected && <Check size={14} color="#10b981" style={{ marginLeft: 'auto' }} />}
                    </Box>
                    <Typography variant="body2" color="text.secondary">{opt.desc}</Typography>
                  </Box>
                );
              })}
            </Box>

            {roleType === 'ORG_BASED' && (
              <Box sx={{ mb: 3 }}>
                <FormControl size="small" fullWidth sx={{ maxWidth: 400 }}>
                  <InputLabel id="origin-org-label">Select Org Node</InputLabel>
                  <Select
                    labelId="origin-org-label"
                    label="Select Org Node"
                    value={selectedOrgNodeId}
                    onChange={e => setOrgNode(e.target.value)}
                    disabled={isEditMode}
                  >
                    <MenuItem value=""><em>None</em></MenuItem>
                    {orgNodes.map(n => (
                      <MenuItem key={n.ID} value={n.ID}>{n.name} ({n.type?.name || ''})</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            )}

            {roleType === 'SINGLE' && (
              <Box sx={{ mb: 3 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel id="parent-roles-select-label">Inherit from Roles (Multiple Select)</InputLabel>
                  <Select
                    labelId="parent-roles-select-label"
                    id="parent-roles-select"
                    multiple
                    value={selectedParentIds}
                    onChange={e => setSelectedParentIds(e.target.value)}
                    input={<OutlinedInput label="Inherit from Roles (Multiple Select)" />}
                    renderValue={selected => {
                      const names = selected.map(id => allRoles.find(r => r.ID === id)?.name).filter(Boolean);
                      return names.join(', ');
                    }}
                  >
                    {allRoles.filter(r => r.ID !== context.roleId).map(r => {
                      const isChecked = selectedParentIds.includes(r.ID);
                      const SelectionIcon = isChecked ? CheckBoxIcon : CheckBoxOutlineBlankIcon;

                      return (
                        <MenuItem key={r.ID} value={r.ID}>
                          <SelectionIcon
                            fontSize="small"
                            style={{ marginRight: 8, padding: 9, boxSizing: 'content-box' }}
                          />
                          <ListItemText primary={r.name} />
                        </MenuItem>
                      );
                    })}
                  </Select>
                </FormControl>
              </Box>
            )}

            <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Role Name"
                size="small"
                fullWidth
                placeholder="e.g. ROLE_DE_FINANCE"
                value={roleName}
                onChange={e => setRoleName(e.target.value)}
                onBlur={handleRoleNameBlur}
                disabled={isEditMode}
              />
              <TextField
                label="Description"
                size="small"
                fullWidth
                placeholder="Optional description"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
              <FormControl size="small" fullWidth sx={{ mt: 1 }}>
                <InputLabel id="role-env-label">Environment</InputLabel>
                <Select
                  labelId="role-env-label"
                  label="Environment"
                  value={environmentId}
                  onChange={e => setEnvironmentId(e.target.value)}
                >
                  {environments.map(env => (
                    <MenuItem key={env.ID} value={env.ID}>{env.ID} - {env.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={critical}
                    onChange={e => {
                      setCritical(e.target.checked);
                      setIsCriticalManuallySet(true);
                    }}
                    color="error"
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>Critical Status</Typography>
                    <Typography variant="caption" color="text.secondary">Flag this role as high-risk/critical authorization</Typography>
                  </Box>
                }
              />
            </Box>
          </Card>
        )}

        {/* STEP 1: Restrictions */}
        {step === 1 && (
          <Card sx={{ p: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Data Access Restrictions</Typography>
            <RestrictionBuilder
              restrictions={restrictions}
              onChange={setRestrictions}
              inheritedRestrictions={inherited}
              orgNodes={orgNodes}
              restrictionFields={selectableRestrictionFields}
            />
          </Card>
        )}

        {/* STEP 2: Approvers */}
        {step === 2 && (
          <Card sx={{ p: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Approvers List</Typography>
            <Box sx={{ display: 'flex', gap: 2, mb: 3, maxWidth: 600 }}>
              <Autocomplete
                value={null}
                onChange={(event, newValue) => {
                  if (newValue && !approvers.find(a => a.userId === newValue.username)) {
                    setApprovers(prev => [
                      ...prev,
                      {
                        userId: newValue.username,
                        userName: newValue.displayName,
                        ID: `temp-${Date.now()}`
                      }
                    ]);
                  }
                  setApproverInput('');
                }}
                inputValue={approverInput}
                onInputChange={(event, newInputValue) => {
                  setApproverInput(newInputValue);
                }}
                options={ldapOptions}
                loading={ldapLoading}
                getOptionLabel={(option) => `${option.displayName} (${option.username}) - ${option.department}`}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Search Approver (LDAP)"
                    size="small"
                    placeholder="Type name, department, or username..."
                    InputProps={{
                      ...(params.InputProps || {}),
                      endAdornment: (
                        <>
                          {ldapLoading ? <CircularProgress color="inherit" size={20} /> : null}
                          {params.InputProps?.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
                renderOption={(props, option) => {
                  const { key, ...optionProps } = props;
                  return (
                    <li key={key || option.username} {...optionProps}>
                      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{option.displayName} ({option.username})</Typography>
                        <Typography variant="caption" color="text.secondary">{option.email} | {option.department}</Typography>
                      </Box>
                    </li>
                  );
                }}
                sx={{ flex: 1 }}
              />
            </Box>

            {approvers.length > 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 500 }}>
                {approvers.map(a => (
                  <Card key={a.ID} sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, background: 'transparent', border: '1px solid', borderColor: 'divider', '&:hover': { borderColor: 'text.secondary' } }}>
                    <Shield size={14} color="#7c3aed" />
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{a.userName}</Typography>
                    <IconButton size="small" color="error" onClick={() => setApprovers(as => as.filter(x => x.ID !== a.ID))} sx={{ ml: 'auto' }}>
                      <X size={14} />
                    </IconButton>
                  </Card>
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">No approvers assigned yet.</Typography>
            )}
          </Card>
        )}

        {/* STEP 3: Review */}
        {step === 3 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Summary */}
            <Card sx={{ p: 3 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Role Summary</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Name</Typography>
                  <Typography variant="body1" sx={{ fontWeight: 700, fontFamily: 'monospace', color: 'primary.light' }}>{roleName || '—'}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Type & Environment</Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Chip
                      label={roleType === 'ORG_BASED' ? 'Org Role' : (selectedParentIds.length > 0 ? 'Derived' : 'Single')}
                      size="small"
                      color={roleType === 'ORG_BASED' ? 'primary' : 'secondary'}
                      variant="outlined"
                      sx={{ height: 20, fontSize: 10 }}
                    />
                    <Chip
                      label={environments.find(e => e.ID === environmentId)?.name || environmentId}
                      size="small"
                      color={ENV_COLOR[environmentId] || 'default'}
                      sx={{ height: 20, fontSize: 10 }}
                    />
                  </Box>
                </Box>
              </Box>
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Approvers</Typography>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {approvers.map(a => a.userName).join(', ') || 'None'}
                </Typography>
              </Box>
              {description && (
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Description</Typography>
                  <Typography variant="body2" color="text.secondary">{description}</Typography>
                </Box>
              )}
            </Card>

            {/* All Restrictions */}
            <Card sx={{ p: 3 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
                Effective Restrictions ({inherited.length + restrictions.length})
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {inherited.map((r, i) => <RestrictionDisplay key={i} restriction={r} isOwn={false} />)}
                {restrictions.map(r => <RestrictionDisplay key={r.ID} restriction={{ ...r, sourceRoleName: 'This Role' }} isOwn={true} />)}
                {inherited.length + restrictions.length === 0 && <Typography variant="body2" color="text.secondary">No restrictions defined.</Typography>}
              </Box>
            </Card>

            {/* Access Simulation */}
            <Card sx={{ p: 3 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Access Simulation</Typography>
              <TextField
                label="Sample Data Rows (JSON Array)"
                multiline
                rows={4}
                fullWidth
                value={simRows}
                onChange={e => setSimRows(e.target.value)}
                sx={{ mb: 2, '& textarea': { fontFamily: 'monospace', fontSize: 13 } }}
              />
              <Button variant="outlined" color="primary" onClick={runSimulation} disabled={loading} startIcon={<PlayCircle size={14} />} sx={{ mb: 2 }}>
                Run Simulation
              </Button>

              {simResults && (
                <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell style={{ fontWeight: 600 }}>Row</TableCell>
                        <TableCell style={{ fontWeight: 600 }}>Result</TableCell>
                        <TableCell style={{ fontWeight: 600 }}>Reason</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {simResults.map(r => (
                        <TableRow key={r.rowIndex} hover>
                          <TableCell>#{r.rowIndex + 1}</TableCell>
                          <TableCell sx={{ color: r.passed ? 'success.main' : 'error.main', fontWeight: 600 }}>
                            {r.passed ? '✓ Pass' : '✗ Fail'}
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary' }}>{r.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>

                  </Table>
                </TableContainer>
              )}
            </Card>

            {/* Immediate Assignment (Optional) */}
            {!isEditMode && (
              <Card sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Direct Assignment (Optional)</Typography>
                  <Typography variant="body2" color="text.secondary">Assign this newly created role to a user or group immediately upon deployment.</Typography>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                  <TextField
                    label="User ID / Group ID"
                    size="small"
                    placeholder="e.g. US12345"
                    value={assignUserId}
                    onChange={e => setAssignUserId(e.target.value)}
                  />
                  <TextField
                    label="User Name"
                    size="small"
                    placeholder="e.g. John Doe"
                    value={assignUserName}
                    onChange={e => setAssignUserName(e.target.value)}
                  />
                </Box>
              </Card>
            )}

            <Button
              variant="contained"
              color="primary"
              onClick={handleSaveClick}
              disabled={loading || !roleName || (permissions && (
                roleType === 'ORG_BASED' ? !permissions.canManageOrgRoles :
                (selectedParentIds.length > 0) ? !canManageThisDerivedWizard() : !permissions.canManageSingleRoles
              ))}
              sx={{ alignSelf: 'flex-end', px: 4, py: 1.25 }}
            >
              {loading ? 'Saving…' : (isEditMode ? 'Save Changes' : 'Deploy Role')}
            </Button>
          </Box>
        )}
      </Box>

      {/* Navigation Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
        <Button variant="outlined" color="error" onClick={onDone}>
          Cancel
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {step > 0 && (
            <Button variant="text" color="inherit" onClick={() => setStep(s => s - 1)} startIcon={<ChevronLeft size={15} />}>
              Back
            </Button>
          )}
          {step < 3 && (
            <Button
              variant="contained"
              onClick={() => setStep(s => s + 1)}
              disabled={step === 0 && roleType === 'ORG_BASED' && !selectedOrgNodeId}
              endIcon={<ChevronRight size={15} />}
            >
              Next
            </Button>
          )}
        </Box>
      </Box>

      {/* Impact Analysis Dialog */}
      <Dialog
        open={showImpactDialog}
        onClose={() => setShowImpactDialog(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            p: 1,
            boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          }
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
          <AlertTriangle color="#ed6c02" size={24} />
          <Typography component="span" variant="h6" sx={{ fontWeight: 700 }}>
            Confirm Changes & Analyze Impact
          </Typography>
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 3 }}>
            Saving changes to role <strong>{roleName}</strong> will affect the following derived roles and assigned users. Please review before proceeding.
          </DialogContentText>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3, mt: 1 }}>
            {/* Derived Roles Panel */}
            <Card variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <GitBranch size={18} color="#0288d1" />
                  Derived Roles
                </Typography>
                <Chip
                  label={impactData.derivedRoles.length}
                  size="small"
                  color="info"
                  sx={{ fontWeight: 600 }}
                />
              </Box>
              {impactData.derivedRoles.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', py: 1 }}>
                  No derived roles will be affected.
                </Typography>
              ) : (
                <Box sx={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {impactData.derivedRoles.map(r => (
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
                  Affected Users
                </Typography>
                <Chip
                  label={impactData.affectedUsers.length}
                  size="small"
                  color="success"
                  sx={{ fontWeight: 600 }}
                />
              </Box>
              {impactData.affectedUsers.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', py: 1 }}>
                  No assigned users will be affected.
                </Typography>
              ) : (
                <Box sx={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {impactData.affectedUsers.map(u => (
                    <Card key={u.userId} sx={{ p: 1.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{u.userName}</Typography>
                        <Chip label={u.userId} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 20 }} />
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        Assigned via: <strong>{u.assignedRole}</strong>
                      </Typography>
                    </Card>
                  ))}
                </Box>
              )}
            </Card>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, pt: 1, gap: 1 }}>
          <Button
            onClick={() => setShowImpactDialog(false)}
            variant="outlined"
            color="inherit"
            sx={{ px: 3 }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              setShowImpactDialog(false);
              handleDeploy();
            }}
            variant="contained"
            color="primary"
            sx={{ px: 4 }}
          >
            OK
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
