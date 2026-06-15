import { useState, useEffect } from 'react';
import { Box, Card, Typography, Stepper, Step, StepLabel, Button, TextField, FormControl, FormGroup, FormControlLabel, Checkbox, CircularProgress, Alert, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, IconButton, InputLabel, Select, MenuItem, OutlinedInput, ListItemText, Snackbar, Autocomplete } from '@mui/material';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import { Check, ChevronRight, ChevronLeft, Shield, Building2, PlayCircle, Zap, GitBranch, X } from 'lucide-react';
import * as api from '../api';
import RestrictionBuilder from './RestrictionBuilder';
import { RestrictionDisplay } from './RestrictionBuilder';

const STEPS = [
  { id: 'origin',       label: 'Origin & Parent' },
  { id: 'restrictions', label: 'Restrictions' },
  { id: 'identity',     label: 'Approvers' },
  { id: 'review',       label: 'Review & Deploy' },
];

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

export default function Wizard({ context = {}, onDone, permissions }) {
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
  const [assignUserId, setAssignUserId]   = useState('');
  const [assignUserName, setAssignUserName] = useState('');

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
          setRoleType(role.type === 'ORG_BASED' ? 'ORG_BASED' : 'SINGLE');
          setRoleName(role.name);
          setDescription(role.description || '');
          setOrgNode(role.orgNode_ID || '');
          setSelectedParentIds(role.parentRoles ? role.parentRoles.map(pr => pr.parent.ID) : []);
          setRestrictions(role.ownRestrictions || []);
          setApprovers(role.approvers || []);
          setCritical(!!role.critical);
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
    const allRestrictions = [...restrictions, ...inherited];
    if (allRestrictions.length > 0) {
      const allCritical = allRestrictions.every(r => isCriticalRestriction(r, orgNodes));
      setCritical(allCritical);
    }
  }, [restrictions, inherited, orgNodes]);

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
    try { rows = JSON.parse(simRows); } catch { setSnackbar({ open: true, message: 'Invalid JSON in sample data', severity: 'error' }); return; }
    setLoading(true);
    try {
      const allRestrictions = [...inherited, ...restrictions.map(r => ({ ...r, isOwn: true, sourceRoleName: 'This Role' }))];
      const results = rows.map((row, idx) => {
        for (const r of allRestrictions) {
          const val = row[r.field];
          if (val === undefined) return { rowIndex: idx, passed: false, reason: `Field '${r.field}' missing` };
          if (r.filterType === 'SINGLE_VALUE' && String(val) !== r.value) return { rowIndex: idx, passed: false, reason: `${r.field} must be '${r.value}'` };
          if (r.filterType === 'MULTI_VALUE') { const arr = JSON.parse(r.value); if (!arr.includes(String(val))) return { rowIndex: idx, passed: false, reason: `${r.field} not in allowed list` }; }
          if (r.filterType === 'RANGE') { const rng = JSON.parse(r.value); const n = parseFloat(val); if (isNaN(n) || n < rng.from || n > rng.to) return { rowIndex: idx, passed: false, reason: `${r.field} out of range` }; }
          if (r.filterType === 'PATTERN') { const p = r.value.replace(/%/g,'.*').replace(/_/g,'.'); if (!new RegExp(`^${p}$`,'i').test(String(val))) return { rowIndex: idx, passed: false, reason: `${r.field} doesn't match pattern` }; }
        }
        return { rowIndex: idx, passed: true, reason: 'All restrictions satisfied' };
      });
      setSimResults(results);
    } catch(e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
    setLoading(false);
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
        await api.updateRole(roleId, { name: roleName || result.roleName, description, critical });
      } else {
        const role = await api.createRole({
          name: roleName,
          type: selectedParentIds.length > 0 ? 'DERIVED' : 'SINGLE',
          description,
          critical,
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
        <Box sx={{ width: 64, height: 64, borderRadius: '50%', bgcolor: 'rgba(16,185,129,0.12)', border: '2px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 3 }}>
          <Check size={28} color="#10b981" />
        </Box>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>{isEditMode ? 'Role Updated' : 'Role Deployed'}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>The authorization role has been {isEditMode ? 'updated' : 'created'} successfully.</Typography>
        <Button variant="contained" onClick={onDone} startIcon={<Shield size={15} />}>View All Roles</Button>
      </Box>
    );
  }

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
            <Step key={s.id} onClick={() => setStep(i)} sx={{ cursor: 'pointer' }}>
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
                { type: 'ORG_BASED', icon: Zap, label: 'Org-Based Role', desc: 'Auto-generated from an Org Structure node', color: '#3b82f6', disabled: permissions && !permissions.canManageOrgRoles },
                { type: 'SINGLE',    icon: Shield, label: 'Single Role', desc: 'A custom role containing specific restrictions', color: '#a78bfa', disabled: permissions && !permissions.canManageSingleRoles },
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
                      borderColor: isSelected ? opt.color : 'rgba(255,255,255,0.08)',
                      bgcolor: isSelected ? 'rgba(255,255,255,0.02)' : 'transparent',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      opacity: isDisabled && !isSelected ? 0.5 : 1,
                      transition: 'all 0.2s',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0.5,
                      '&:hover': {
                        borderColor: isDisabled ? 'none' : isSelected ? opt.color : 'rgba(255,255,255,0.15)',
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
              <FormControlLabel
                control={
                  <Checkbox
                    checked={critical}
                    onChange={e => setCritical(e.target.checked)}
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
              restrictionFields={restrictionFields}
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
                  <Card key={a.ID} sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, background: 'rgba(255,255,255,0.01)', '&:hover': { borderColor: 'rgba(255,255,255,0.1)' } }}>
                    <Shield size={14} color="#a78bfa" />
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
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Type</Typography>
                  <Chip
                    label={roleType === 'ORG_BASED' ? 'Org Role' : (selectedParentIds.length > 0 ? 'Derived' : 'Single')}
                    size="small"
                    color={roleType === 'ORG_BASED' ? 'primary' : 'secondary'}
                    variant="outlined"
                    sx={{ height: 20, fontSize: 10 }}
                  />
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
                          <TableCell sx={{ color: r.passed ? '#10b981' : '#ba1a1a', fontWeight: 600 }}>
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
              onClick={handleDeploy}
              disabled={loading || !roleName || (permissions && (
                roleType === 'ORG_BASED' ? !permissions.canManageOrgRoles :
                (selectedParentIds.length > 0) ? !permissions.canManageDerivedRoles : !permissions.canManageSingleRoles
              ))}
              sx={{ alignSelf: 'flex-end', px: 4, py: 1.25 }}
            >
              {loading ? 'Saving…' : (isEditMode ? 'Save Changes' : 'Deploy Role')}
            </Button>
          </Box>
        )}
      </Box>

      {/* Navigation Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
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
            sx={{ ml: 'auto' }}
          >
            Next
          </Button>
        )}
      </Box>
    </Box>
  );
}
