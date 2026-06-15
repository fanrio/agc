import { useState, useEffect } from 'react';
import {
  Wizard,
  WizardStep,
  Card,
  CardHeader,
  Button,
  CheckBox,
  Select,
  Option,
  MultiComboBox,
  MultiComboBoxItem,
  Input,
  Label,
  TextArea,
  Table,
  TableRow,
  TableCell,
  TableHeaderRow,
  TableHeaderCell,
  ComboBox,
  ComboBoxItem,
  FlexBox,
  Title,
  Text,
  Tag,
  Toast,
  Icon,
} from '@ui5/webcomponents-react';
import "@ui5/webcomponents-icons/dist/AllIcons.js";
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

export default function AuthorizationWizard({ context = {}, onDone, permissions }) {
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

  const handleStepChange = (e) => {
    const stepEl = e.detail.step;
    const idx = parseInt(stepEl.getAttribute('data-index'), 10);
    if (!isNaN(idx)) {
      setStep(idx);
    }
  };

  if (done) {
    return (
      <FlexBox direction="Column" alignItems="Center" style={{ paddingTop: '4rem', gap: '1rem' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: 'rgba(16,185,129,0.12)', border: '2px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
          <Icon name="accept" style={{ color: '#10b981', fontSize: '28px' }} />
        </div>
        <Title level="H2" style={{ fontWeight: 700, marginBottom: '0.25rem' }}>{isEditMode ? 'Role Updated' : 'Role Deployed'}</Title>
        <Text style={{ color: 'var(--sapContent_LabelColor)', marginBottom: '1.5rem' }}>The authorization role has been {isEditMode ? 'updated' : 'created'} successfully.</Text>
        <Button design="Emphasized" onClick={onDone} icon="shield">View All Roles</Button>
      </FlexBox>
    );
  }

  const isOrgDisabled = (permissions && !permissions.canManageOrgRoles) || isEditMode;
  const isSingleDisabled = (permissions && !permissions.canManageSingleRoles) || isEditMode;

  return (
    <div style={{ animation: 'fadeIn 0.3s' }}>
      <FlexBox direction="Column" style={{ marginBottom: '1.5rem' }}>
        <Title level="H2" style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Authorization Wizard</Title>
        <Text style={{ color: 'var(--sapContent_LabelColor)' }}>Create a new Org-Based Role or Single Role step by step</Text>
      </FlexBox>

      <Toast
        open={snackbar.open}
        onAfterClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        duration={6000}
      >
        {snackbar.message}
      </Toast>

      {/* Stepper / Wizard */}
      <div style={{ marginBottom: '2rem' }}>
        <Wizard onStepChange={handleStepChange}>
          {STEPS.map((s, i) => (
            <WizardStep
              key={s.id}
              data-index={i}
              titleText={s.label}
              selected={step === i}
              disabled={step < i}
              style={{ display: step === i ? 'block' : 'none' }}
            >
              {/* Step Content Rendered Inside WizardStep */}
              {step === i && (
                <div style={{ padding: '1.5rem 0' }}>
                  {i === 0 && (
                  <Card header={<CardHeader titleText="Role Origin" />}>
                    <div style={{ padding: '1.5rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                        <div
                          onClick={() => !isOrgDisabled && setRoleType('ORG_BASED')}
                          style={{
                            padding: '1rem',
                            borderRadius: '8px',
                            border: `1px solid ${roleType === 'ORG_BASED' ? '#3b82f6' : 'rgba(255,255,255,0.08)'}`,
                            backgroundColor: roleType === 'ORG_BASED' ? 'rgba(255, 255, 255, 0.02)' : 'transparent',
                            cursor: isOrgDisabled ? 'not-allowed' : 'pointer',
                            opacity: isOrgDisabled && roleType !== 'ORG_BASED' ? 0.5 : 1,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.25rem',
                          }}
                        >
                          <FlexBox alignItems="Center" style={{ gap: '0.5rem' }}>
                            <Icon name="energy" style={{ color: '#3b82f6' }} />
                            <Label style={{ fontWeight: 700 }}>Org-Based Role</Label>
                            {roleType === 'ORG_BASED' && <Icon name="accept" style={{ color: '#10b981', marginLeft: 'auto' }} />}
                          </FlexBox>
                          <Text style={{ fontSize: '0.875rem', color: 'var(--sapContent_LabelColor)' }}>Auto-generated from an Org Structure node</Text>
                        </div>

                        <div
                          onClick={() => !isSingleDisabled && setRoleType('SINGLE')}
                          style={{
                            padding: '1rem',
                            borderRadius: '8px',
                            border: `1px solid ${roleType === 'SINGLE' ? '#a78bfa' : 'rgba(255,255,255,0.08)'}`,
                            backgroundColor: roleType === 'SINGLE' ? 'rgba(255, 255, 255, 0.02)' : 'transparent',
                            cursor: isSingleDisabled ? 'not-allowed' : 'pointer',
                            opacity: isSingleDisabled && roleType !== 'SINGLE' ? 0.5 : 1,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.25rem',
                          }}
                        >
                          <FlexBox alignItems="Center" style={{ gap: '0.5rem' }}>
                            <Icon name="shield" style={{ color: '#a78bfa' }} />
                            <Label style={{ fontWeight: 700 }}>Single Role</Label>
                            {roleType === 'SINGLE' && <Icon name="accept" style={{ color: '#10b981', marginLeft: 'auto' }} />}
                          </FlexBox>
                          <Text style={{ fontSize: '0.875rem', color: 'var(--sapContent_LabelColor)' }}>A custom role containing specific restrictions</Text>
                        </div>
                      </div>

                      {roleType === 'ORG_BASED' && (
                        <FlexBox direction="Column" style={{ gap: '0.25rem', marginBottom: '1.5rem', maxWidth: '400px' }}>
                          <Label showColon>Select Org Node</Label>
                          <Select
                            onChange={e => setOrgNode(e.detail.selectedOption.value)}
                            disabled={isEditMode}
                            style={{ width: '100%' }}
                          >
                            <Option value="" selected={selectedOrgNodeId === ''}>None</Option>
                            {orgNodes.map(n => (
                              <Option key={n.ID} value={n.ID} selected={selectedOrgNodeId === n.ID}>
                                {n.name} ({n.type?.name || ''})
                              </Option>
                            ))}
                          </Select>
                        </FlexBox>
                      )}

                      {roleType === 'SINGLE' && (
                        <FlexBox direction="Column" style={{ gap: '0.25rem', marginBottom: '1.5rem' }}>
                          <Label showColon>Inherit from Roles (Multiple Select)</Label>
                          <MultiComboBox
                            onSelectionChange={(e) => {
                              const ids = e.detail.items.map(item => item.getAttribute('data-id'));
                              setSelectedParentIds(ids);
                            }}
                            placeholder="Select parent roles..."
                            style={{ width: '100%' }}
                          >
                            {allRoles.filter(r => r.ID !== context.roleId).map(r => (
                              <MultiComboBoxItem
                                key={r.ID}
                                data-id={r.ID}
                                text={r.name}
                                selected={selectedParentIds.includes(r.ID)}
                              />
                            ))}
                          </MultiComboBox>
                        </FlexBox>
                      )}

                      <FlexBox direction="Column" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.5rem', gap: '1.25rem' }}>
                        <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                          <Label showColon>Role Name</Label>
                          <Input
                            value={roleName}
                            onInput={e => setRoleName(e.target.value)}
                            onBlur={handleRoleNameBlur}
                            disabled={isEditMode}
                            placeholder="e.g. ROLE_DE_FINANCE"
                            style={{ width: '100%' }}
                          />
                        </FlexBox>

                        <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                          <Label showColon>Description</Label>
                          <Input
                            value={description}
                            onInput={e => setDescription(e.target.value)}
                            placeholder="Optional description"
                            style={{ width: '100%' }}
                          />
                        </FlexBox>

                        <FlexBox direction="Row" alignItems="Center" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
                          <CheckBox
                            checked={critical}
                            onChange={e => setCritical(e.target.checked)}
                          />
                          <FlexBox direction="Column">
                            <Label style={{ fontWeight: 600 }}>Critical Status</Label>
                            <Text style={{ fontSize: '0.75rem', color: 'var(--sapContent_LabelColor)' }}>Flag this role as high-risk/critical authorization</Text>
                          </FlexBox>
                        </FlexBox>
                      </FlexBox>
                    </div>
                  </Card>
                )}

                {i === 1 && (
                  <Card header={<CardHeader titleText="Data Access Restrictions" />}>
                    <div style={{ padding: '1.5rem' }}>
                      <RestrictionBuilder
                        restrictions={restrictions}
                        onChange={setRestrictions}
                        inheritedRestrictions={inherited}
                        orgNodes={orgNodes}
                        restrictionFields={restrictionFields}
                      />
                    </div>
                  </Card>
                )}

                {i === 2 && (
                  <Card header={<CardHeader titleText="Approvers List" />}>
                    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      <FlexBox direction="Column" style={{ gap: '0.25rem', maxWidth: '600px' }}>
                        <Label showColon>Search Approver (LDAP)</Label>
                        <ComboBox
                          value={approverInput}
                          onInput={(e) => {
                            setApproverInput(e.target.value);
                          }}
                          onSelectionChange={(e) => {
                            const selectedItem = e.detail.item;
                            if (selectedItem) {
                              const username = selectedItem.getAttribute('data-username');
                              const displayName = selectedItem.getAttribute('data-displayname');
                              if (username && !approvers.find(a => a.userId === username)) {
                                setApprovers(prev => [
                                  ...prev,
                                  {
                                    userId: username,
                                    userName: displayName || username,
                                    ID: `temp-${Date.now()}`
                                  }
                                ]);
                              }
                              setApproverInput('');
                            }
                          }}
                          placeholder="Type name, department, or username..."
                          style={{ width: '100%' }}
                          loading={ldapLoading}
                        >
                          {ldapOptions.map(option => (
                            <ComboBoxItem
                              key={option.username}
                              text={`${option.displayName} (${option.username})`}
                              additionalText={option.department}
                              data-username={option.username}
                              data-displayname={option.displayName}
                            />
                          ))}
                        </ComboBox>
                      </FlexBox>

                      {approvers.length > 0 ? (
                        <FlexBox direction="Column" style={{ gap: '0.5rem', maxWidth: '500px' }}>
                          {approvers.map(a => (
                            <Card
                              key={a.ID}
                              header={
                                <CardHeader
                                  titleText={a.userName}
                                  avatar={<Icon name="private" style={{ color: '#a78bfa' }} />}
                                  action={
                                    <Button
                                      design="Transparent"
                                      icon="decline"
                                      onClick={() => setApprovers(as => as.filter(x => x.ID !== a.ID))}
                                    />
                                  }
                                />
                              }
                            />
                          ))}
                        </FlexBox>
                      ) : (
                        <Text style={{ color: 'var(--sapContent_LabelColor)' }}>No approvers assigned yet.</Text>
                      )}
                    </div>
                  </Card>
                )}

                {i === 3 && (
                  <FlexBox direction="Column" style={{ gap: '1.5rem' }}>
                    {/* Summary */}
                    <Card header={<CardHeader titleText="Role Summary" />}>
                      <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          <FlexBox direction="Column">
                            <Label style={{ fontSize: '0.75rem', color: 'var(--sapContent_LabelColor)' }}>Name</Label>
                            <Text style={{ fontWeight: 700, fontFamily: 'monospace' }}>{roleName || '—'}</Text>
                          </FlexBox>
                          <FlexBox direction="Column">
                            <Label style={{ fontSize: '0.75rem', color: 'var(--sapContent_LabelColor)' }}>Type</Label>
                            <Tag style={{ width: 'fit-content' }}>
                              {roleType === 'ORG_BASED' ? 'Org Role' : (selectedParentIds.length > 0 ? 'Derived' : 'Single')}
                            </Tag>
                          </FlexBox>
                        </div>
                        <FlexBox direction="Column">
                          <Label style={{ fontSize: '0.75rem', color: 'var(--sapContent_LabelColor)' }}>Approvers</Label>
                          <Text style={{ fontWeight: 500 }}>
                            {approvers.map(a => a.userName).join(', ') || 'None'}
                          </Text>
                        </FlexBox>
                        {description && (
                          <FlexBox direction="Column">
                            <Label style={{ fontSize: '0.75rem', color: 'var(--sapContent_LabelColor)' }}>Description</Label>
                            <Text style={{ color: 'var(--sapContent_LabelColor)' }}>{description}</Text>
                          </FlexBox>
                        )}
                      </div>
                    </Card>

                    {/* All Restrictions */}
                    <Card header={<CardHeader titleText={`Effective Restrictions (${inherited.length + restrictions.length})`} />}>
                      <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {inherited.map((r, i) => <RestrictionDisplay key={i} restriction={r} isOwn={false} />)}
                        {restrictions.map(r => <RestrictionDisplay key={r.ID} restriction={{ ...r, sourceRoleName: 'This Role' }} isOwn={true} />)}
                        {inherited.length + restrictions.length === 0 && <Text style={{ color: 'var(--sapContent_LabelColor)' }}>No restrictions defined.</Text>}
                      </div>
                    </Card>

                    {/* Access Simulation */}
                    <Card header={<CardHeader titleText="Access Simulation" />}>
                      <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                          <Label showColon>Sample Data Rows (JSON Array)</Label>
                          <TextArea
                            rows={4}
                            value={simRows}
                            onInput={e => setSimRows(e.target.value)}
                            style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px' }}
                          />
                        </FlexBox>
                        
                        <Button
                          design="Default"
                          icon="play"
                          onClick={runSimulation}
                          disabled={loading}
                          style={{ alignSelf: 'flex-start' }}
                        >
                          Run Simulation
                        </Button>

                        {simResults && (
                          <Table
                            headerRow={
                              <TableHeaderRow>
                                <TableHeaderCell style={{ fontWeight: 600 }}>Row</TableHeaderCell>
                                <TableHeaderCell style={{ fontWeight: 600 }}>Result</TableHeaderCell>
                                <TableHeaderCell style={{ fontWeight: 600 }}>Reason</TableHeaderCell>
                              </TableHeaderRow>
                            }
                          >
                            {simResults.map(r => (
                              <TableRow key={r.rowIndex}>
                                <TableCell>#{r.rowIndex + 1}</TableCell>
                                <TableCell style={{ color: r.passed ? '#10b981' : '#ba1a1a', fontWeight: 600 }}>
                                  {r.passed ? '✓ Pass' : '✗ Fail'}
                                </TableCell>
                                <TableCell style={{ color: 'var(--sapContent_LabelColor)' }}>{r.reason}</TableCell>
                              </TableRow>
                            ))}
                          </Table>
                        )}
                      </div>
                    </Card>

                    {/* Immediate Assignment (Optional) */}
                    {!isEditMode && (
                      <Card header={<CardHeader titleText="Direct Assignment (Optional)" subtitleText="Assign this newly created role to a user or group immediately upon deployment." />}>
                        <div style={{ padding: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                            <Label showColon>User ID / Group ID</Label>
                            <Input
                              value={assignUserId}
                              onInput={e => setAssignUserId(e.target.value)}
                              placeholder="e.g. US12345"
                              style={{ width: '100%' }}
                            />
                          </FlexBox>
                          <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                            <Label showColon>User Name</Label>
                            <Input
                              value={assignUserName}
                              onInput={e => setAssignUserName(e.target.value)}
                              placeholder="e.g. John Doe"
                              style={{ width: '100%' }}
                            />
                          </FlexBox>
                        </div>
                      </Card>
                    )}

                    <Button
                      design="Emphasized"
                      onClick={handleDeploy}
                      disabled={loading || !roleName || (permissions && (
                        roleType === 'ORG_BASED' ? !permissions.canManageOrgRoles :
                        (selectedParentIds.length > 0) ? !permissions.canManageDerivedRoles : !permissions.canManageSingleRoles
                      ))}
                      style={{ alignSelf: 'flex-end', padding: '0.5rem 2rem' }}
                    >
                      {loading ? 'Saving…' : (isEditMode ? 'Save Changes' : 'Deploy Role')}
                    </Button>
                  </FlexBox>
                )}
                </div>
              )}
            </WizardStep>
          ))}
        </Wizard>
      </div>

      {/* Navigation Buttons */}
      <FlexBox justifyContent="SpaceBetween" style={{ marginTop: '1.5rem' }}>
        {step > 0 ? (
          <Button
            design="Transparent"
            icon="navigation-left-arrow"
            onClick={() => setStep(s => s - 1)}
          >
            Back
          </Button>
        ) : (
          <div />
        )}
        {step < 3 && (
          <Button
            design="Emphasized"
            icon="navigation-right-arrow"
            iconEnd
            onClick={() => setStep(s => s + 1)}
            disabled={step === 0 && roleType === 'ORG_BASED' && !selectedOrgNodeId}
          >
            Next
          </Button>
        )}
      </FlexBox>
    </div>
  );
}
