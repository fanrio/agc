import { useState, useEffect } from 'react';
import * as api from '../../api';
import { isCriticalRestriction, isRoleInScope } from '../../utils/helpers';

export function useWizardState({ context = {}, permissions }) {
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
  const [streamId, setStreamId]           = useState(context.streamId || 'app-global');
  const [streams, setStreams]             = useState([]);
  const [assignUserId, setAssignUserId]   = useState('');
  const [assignUserName, setAssignUserName] = useState('');

  const [showImpactDialog, setShowImpactDialog] = useState(false);
  const [impactData, setImpactData]             = useState({ derivedRoles: [], affectedUsers: [] });
  const [originalCritical, setOriginalCritical] = useState(false);
  const [originalRestrictions, setOriginalRestrictions] = useState([]);
  const [isCriticalManuallySet, setIsCriticalManuallySet] = useState(!!context.roleId);
  const [maxStepReached, setMaxStepReached] = useState(context.roleId ? 3 : 0);

  const parseEnvironments = (val) => {
    if (!val || val === 'ALL' || val === '*') return 'ALL';
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      return val.split(',').map(s => s.trim().toUpperCase());
    }
    return [];
  };

  const parseAllowedStreams = (val) => {
    if (!val || val === 'ALL' || val === '*') return 'ALL';
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      return val.split(',').map(s => s.trim());
    }
    return [];
  };

  const parsedAllowedEnvs = permissions?.isSuperAdmin ? 'ALL' : parseEnvironments(permissions?.allowedEnvironments);
  const filteredEnvironments = environments.filter(env => {
    if (parsedAllowedEnvs === 'ALL') return true;
    return parsedAllowedEnvs.includes(env.ID);
  });

  const parsedAllowedStreams = permissions?.isSuperAdmin ? 'ALL' : parseAllowedStreams(permissions?.allowedStreams);
  const filteredStreams = streams.filter(s => {
    if (parsedAllowedStreams === 'ALL') return true;
    return parsedAllowedStreams.includes(s.ID);
  });

  useEffect(() => {
    if (!isEditMode && filteredEnvironments.length > 0) {
      const isCurrentAllowed = filteredEnvironments.some(e => e.ID === environmentId);
      if (!isCurrentAllowed) {
        setEnvironmentId(filteredEnvironments[0].ID);
      }
    }
  }, [filteredEnvironments, environmentId, isEditMode]);

  useEffect(() => {
    if (!isEditMode && filteredStreams.length > 0) {
      const isCurrentAllowed = filteredStreams.some(s => s.ID === streamId);
      if (!isCurrentAllowed) {
        setStreamId(filteredStreams[0].ID);
      }
    }
  }, [filteredStreams, streamId, isEditMode]);

  useEffect(() => {
    if (step > maxStepReached) {
      setMaxStepReached(step);
    }
  }, [step, maxStepReached]);

  const canNavigateTo = (targetStep) => {
    if (targetStep <= step) return true;
    if (isEditMode) return true;
    if (context.allowFreeNavigation) return true; // check prop fallback
    if (step === 0 && !streamId) return false;
    if (step === 0 && roleType === 'ORG_BASED' && !selectedOrgNodeId) return false;
    return targetStep <= maxStepReached;
  };

  const canManageThisDerivedWizard = () => {
    if (permissions?.isSuperAdmin) return true;
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
      try {
        const parsed = JSON.parse(scope);
        if (Array.isArray(parsed)) {
          return selectedParentIds.every(parentId => {
            const parentRole = allRoles.find(r => r.ID === parentId);
            return isRoleInScope(parentId, parentRole?.name, scope);
          });
        }
      } catch (e) {}

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
    api.getRestrictionFields().then(setFields).catch(console.error);
    api.getStreamsFlat().then(setStreams).catch(console.error);
  }, []);

  // Fetch existing role details for editing
  useEffect(() => {
    if (context.roleId) {
      setLoading(true);
      api.getRoles().then(all => {
        const role = all.find(r => r.ID === context.roleId);
        if (role) {
          try {
            setRoleType(role.type === 'ORG_BASED' ? 'ORG_BASED' : (role.type === 'DRAGE' ? 'DRAGE' : 'SINGLE'));
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
            setStreamId(role.stream_ID || 'app-global');
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
      
      if (derived.length === 0 && users.length === 0) {
        await handleDeploy();
        return;
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
        await api.updateRole(roleId, { 
          description, 
          critical,
          environment_ID: environmentId,
          stream_ID: streamId,
          type: roleType === 'DRAGE' ? 'DRAGE' : (roleType === 'ORG_BASED' ? 'ORG_BASED' : (selectedParentIds.length > 0 ? 'DERIVED' : 'SINGLE'))
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
        await api.updateRole(roleId, { name: roleName || result.roleName, description, critical, environment_ID: environmentId, stream_ID: streamId });
      } else {
        const role = await api.createRole({
          name: roleName,
          type: selectedParentIds.length > 0 ? 'DERIVED' : 'SINGLE',
          description,
          critical,
          environment_ID: environmentId,
          stream_ID: streamId,
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

  const isDerived = selectedParentIds.length > 0;
  const selectableRestrictionFields = (() => {
    if (!isDerived) return restrictionFields;
    if (permissions?.isSuperAdmin) return restrictionFields;
    if (!permissions || !permissions.canManageDerivedRoles) return [];

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
    if (!scopeStr || scopeStr.trim() === '' || scopeStr.trim().toUpperCase() === 'ALL' || scopeStr.trim() === '*') {
      return restrictionFields.filter(f => !usedFields.has(f.name.toLowerCase()));
    }

    let scopeList = [];
    try {
      scopeList = JSON.parse(scopeStr);
      if (!Array.isArray(scopeList)) scopeList = [];
    } catch (e) {
      const terms = scopeStr.split(',').map(s => s.trim().toLowerCase());
      const hasAllowedParent = selectedParentIds.some(parentId => {
        const parent = allRoles.find(r => r.ID === parentId);
        return parent && (terms.includes(parent.name.toLowerCase()) || terms.includes(parent.ID.toLowerCase()));
      });
      return hasAllowedParent ? restrictionFields.filter(f => !usedFields.has(f.name.toLowerCase())) : [];
    }

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
          restrictionFields.forEach(f => allowedFieldsSet.add(f.name.toLowerCase()));
        }
      }
    });

    if (!hasParentMatch) return [];

    return restrictionFields.filter(f => allowedFieldsSet.has(f.name.toLowerCase()) && !usedFields.has(f.name.toLowerCase()));
  })();

  return {
    step, setStep,
    roleType, setRoleType,
    selectedOrgNodeId, setOrgNode,
    selectedParentIds, setSelectedParentIds,
    roleName, setRoleName,
    description, setDescription,
    restrictions, setRestrictions,
    inherited,
    approverInput, setApproverInput,
    approvers, setApprovers,
    simRows, setSimRows,
    simResults,
    orgNodes,
    allRoles,
    restrictionFields,
    loading,
    done,
    isEditMode,
    snackbar, setSnackbar,
    ldapOptions,
    ldapLoading,
    critical, setCritical,
    environmentId, setEnvironmentId,
    environments,
    streamId, setStreamId,
    streams: filteredStreams,
    assignUserId, setAssignUserId,
    assignUserName, setAssignUserName,
    showImpactDialog, setShowImpactDialog,
    impactData,
    originalCritical,
    originalRestrictions,
    isCriticalManuallySet, setIsCriticalManuallySet,
    maxStepReached,
    filteredEnvironments,
    selectableRestrictionFields,
    isDerived,
    canNavigateTo,
    canManageThisDerivedWizard,
    handleCloseSnackbar,
    handleRoleNameBlur,
    addApprover,
    runSimulation,
    handleSaveClick,
    handleDeploy
  };
}
