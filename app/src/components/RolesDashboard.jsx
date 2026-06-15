import { useState, useEffect, useRef } from 'react';
import {
  Card,
  CardHeader,
  Text,
  Button,
  Input,
  Dialog,
  Tag,
  FlexBox,
  Icon,
  Label,
  BusyIndicator,
  SegmentedButton,
  SegmentedButtonItem,
  Toast
} from '@ui5/webcomponents-react';
import '@ui5/webcomponents-icons/dist/AllIcons.js';
import * as api from '../api';
import { RestrictionDisplay } from './RestrictionBuilder';

// Helper to format ISO datetime strings
function formatDateTime(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  return date.toLocaleString(undefined, { 
    dateStyle: 'short', 
    timeStyle: 'short' 
  });
}

// Helper to determine if a specific restriction is critical
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

// Helper recursively collecting all restrictions for a role
function getEffectiveRestrictionsFlat(role, allRoles) {
  let list = [];
  if (role.ownRestrictions && role.ownRestrictions.length > 0) {
    list.push(...role.ownRestrictions);
  }
  if (role.parentRoles && role.parentRoles.length > 0) {
    for (const pr of role.parentRoles) {
      const parentId = pr.parent_ID || (pr.parent && pr.parent.ID);
      if (parentId) {
        const parent = allRoles.find(r => r.ID === parentId);
        if (parent) {
          list.push(...getEffectiveRestrictionsFlat(parent, allRoles));
        }
      }
    }
  }
  return list;
}

// Helper recursively checking if a role is critical (all restrictions must be critical)
function isCriticalRole(role, allRoles, orgNodes) {
  const allRestrictions = getEffectiveRestrictionsFlat(role, allRoles);
  if (allRestrictions.length === 0) return false;
  return allRestrictions.every(r => isCriticalRestriction(r, orgNodes));
}

// Helper to recursively check if a role or any of its parents has restrictions
function hasAnyRestrictions(role, allRoles) {
  if (role.ownRestrictions && role.ownRestrictions.length > 0) return true;
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

function RoleCard({ role, allRoles, orgNodes = [], depth = 0, onDerive, onEdit, onDelete, onRefresh, isSearchActive = false, onError, onAssign, isCompact, permissions }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [showEffective, setShowEffective] = useState(false);
  const [effective, setEffective] = useState(null);
  const [loading, setLoading] = useState(false);

  const children = allRoles.filter(r => r.parentRoles && r.parentRoles.some(pr => pr.parent_ID === role.ID));

  async function loadEffective() {
    if (effective) { setShowEffective(s => !s); return; }
    setLoading(true);
    try {
      const data = await api.resolveEffective(role.ID);
      setEffective(data);
      setShowEffective(true);
    } catch(e) { onError(e.message); }
    setLoading(false);
  }

  async function handleDelete() {
    if (children.length > 0) { onError('Cannot delete a role that has child roles. Delete children first.'); return; }
    if (!confirm(`Delete role "${role.name}"?`)) return;
    setLoading(true);
    try {
      await api.deleteRole(role.ID);
      await onRefresh();
    } catch(e) { onError(e.message); }
    setLoading(false);
  }

  return (
    <FlexBox direction="Column" style={{ gap: '8px' }}>
      <Card
        header={
          <CardHeader
            titleText={role.name}
            subtitleText={!isCompact && role.description ? role.description : undefined}
            avatar={
              <FlexBox alignItems="Center" style={{ gap: '8px' }}>
                {children.length > 0 && !isSearchActive && (
                  <Button
                    icon={expanded ? "navigation-down-arrow" : "navigation-right-arrow"}
                    design="Transparent"
                    onClick={() => setExpanded(e => !e)}
                    style={{ minWidth: '24px', height: '24px' }}
                  />
                )}
                <Icon name="shield" style={{ color: role.type === 'ORG_BASED' ? 'var(--sapContent_NonInteractiveIconColor)' : '#a78bfa' }} />
              </FlexBox>
            }
            action={
              <FlexBox style={{ gap: '6px' }}>
                <Tag design={role.type === 'ORG_BASED' ? "Set8" : (role.parentRoles && role.parentRoles.length > 0 ? "Set6" : "Set1")}>
                  {role.type === 'ORG_BASED' ? 'Org Role' : (role.parentRoles && role.parentRoles.length > 0 ? 'Derived' : 'Single')}
                </Tag>
                {role.critical && (
                  <Tag design="Set2">
                    Critical
                  </Tag>
                )}
                {depth > 0 && (
                  <Tag design="Set1">
                    {`L${depth}`}
                  </Tag>
                )}
              </FlexBox>
            }
          />
        }
        style={{
          marginLeft: `${depth * 24}px`,
          width: 'auto'
        }}
      >
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* Own restrictions */}
          {!isCompact && role.ownRestrictions && role.ownRestrictions.length > 0 && (
            <FlexBox direction="Column" style={{ gap: '6px' }}>
              {role.ownRestrictions.map(r => (
                <RestrictionDisplay key={r.ID} restriction={r} isOwn={true} />
              ))}
            </FlexBox>
          )}

          {/* Assigned users */}
          {!isCompact && role.assignments && role.assignments.length > 0 && (
            <FlexBox alignItems="Center" style={{ gap: '6px' }}>
              <Icon name="group" style={{ width: '14px', height: '14px', color: '#94a3b8' }} />
              <Text style={{ fontSize: '12px', color: 'var(--sapContent_LabelColor)' }}>
                Assigned: {role.assignments.map(a => a.userName || a.userId).join(', ')}
              </Text>
            </FlexBox>
          )}

          {/* Approvers */}
          {!isCompact && role.approvers && role.approvers.length > 0 && (
            <FlexBox alignItems="Center" style={{ gap: '6px' }}>
              <Icon name="shield" style={{ width: '14px', height: '14px', color: '#a78bfa' }} />
              <Text style={{ fontSize: '12px', color: '#a78bfa' }}>
                Approvers: {role.approvers.map(a => a.userName || a.userId).join(', ')}
              </Text>
            </FlexBox>
          )}

          {/* Managed Metadata */}
          {!isCompact && (
            <FlexBox style={{ gap: '12px', flexWrap: 'wrap', fontSize: '10px', color: 'var(--sapContent_LabelColor)', opacity: 0.8 }}>
              <div>
                Created: <span style={{ color: 'var(--sapContent_TextColor)' }}>{formatDateTime(role.createdAt)}</span> by <span style={{ color: 'var(--sapContent_TextColor)' }}>{role.createdBy || 'seed'}</span>
              </div>
              {role.modifiedAt && role.modifiedAt !== role.createdAt && (
                <div>
                  · Modified: <span style={{ color: 'var(--sapContent_TextColor)' }}>{formatDateTime(role.modifiedAt)}</span> by <span style={{ color: 'var(--sapContent_TextColor)' }}>{role.modifiedBy || 'seed'}</span>
                </div>
              )}
            </FlexBox>
          )}

          {/* Action Buttons */}
          <FlexBox style={{ gap: '8px', flexWrap: 'wrap', alignItems: 'center', width: '100%' }}>
            <Button design="Transparent" onClick={loadEffective} disabled={loading} icon="show">
              {showEffective ? 'Hide' : 'View'} Effective
            </Button>
            <Button 
              design="Transparent" 
              onClick={() => onEdit(role.ID)} 
              disabled={permissions && (
                role.type === 'ORG_BASED' ? !permissions.canManageOrgRoles :
                (role.parentRoles && role.parentRoles.length > 0) ? !permissions.canManageDerivedRoles : !permissions.canManageSingleRoles
              )}
              icon="edit"
            >
              Edit
            </Button>
            <Button 
              design="Transparent" 
              onClick={() => onDerive(role.ID)} 
              disabled={permissions && !permissions.canManageDerivedRoles}
              icon="org-chart"
            >
              Derive Child Role
            </Button>
            <Button
              design="Emphasized"
              onClick={() => onAssign(role)}
              disabled={(permissions && !permissions.canAssignRoles) || !hasAnyRestrictions(role, allRoles)}
              icon="group"
            >
              Assign User
            </Button>
            <Button 
              design="Transparent"
              onClick={handleDelete} 
              disabled={loading || (permissions && (
                role.type === 'ORG_BASED' ? !permissions.canManageOrgRoles :
                (role.parentRoles && role.parentRoles.length > 0) ? !permissions.canManageDerivedRoles : !permissions.canManageSingleRoles
              ))} 
              icon="delete"
              style={{ marginLeft: 'auto', color: 'var(--sapNegativeElementColor)' }}
            />
          </FlexBox>

          {/* Effective Restrictions Collapse (conditional rendering) */}
          {showEffective && effective && (
            <div style={{ marginTop: '8px', paddingTop: '12px', borderTop: '1px solid var(--sapGroup_TitleBorderColor)' }}>
              <Text style={{ textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '8px', color: 'var(--sapContent_LabelColor)', fontSize: '11px' }}>
                Effective Restriction Chain ({effective.length} total)
              </Text>
              <FlexBox direction="Column" style={{ gap: '6px' }}>
                {effective.map((r, i) => (
                  <RestrictionDisplay
                    key={i}
                    restriction={{ ...r, field: r.field, filterType: r.filterType, value: r.value, sourceRoleName: r.sourceRoleName }}
                    isOwn={r.isOwn}
                  />
                ))}
              </FlexBox>
            </div>
          )}
        </div>
      </Card>

      {/* Children */}
      {expanded && !isSearchActive && children.map(child => (
        <RoleCard
          key={child.ID}
          role={child}
          allRoles={allRoles}
          orgNodes={orgNodes}
          depth={depth + 1}
          onDerive={onDerive}
          onEdit={onEdit}
          onDelete={onDelete}
          onRefresh={onRefresh}
          isSearchActive={isSearchActive}
          onError={onError}
          onAssign={onAssign}
          isCompact={isCompact}
          permissions={permissions}
        />
      ))}
    </FlexBox>
  );
}

export default function RolesDashboard({ onDeriveRole, onEditRole, onCreateRole, initialFilter, setInitialFilter, permissions }) {
  const [roles, setRoles]     = useState([]);
  const [orgNodes, setOrgNodes] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [healthFilter, setHealthFilter] = useState(initialFilter || null);
  const toastRef = useRef(null);

  useEffect(() => {
    if (initialFilter) {
      setHealthFilter(initialFilter);
    }
  }, [initialFilter]);

  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'error' });

  // Toggle representation states ('compact' or 'detailed')
  const [viewMode, setViewMode] = useState('detailed');

  // Assignment dialog states
  const [assigningRole, setAssigningRole] = useState(null);
  const [assignForm, setAssignForm] = useState({ userId: '', userName: '' });
  const [assigningLoading, setAssigningLoading] = useState(false);

  useEffect(() => {
    if (snackbar.open && toastRef.current) {
      toastRef.current.show();
      const timer = setTimeout(() => {
        setSnackbar(prev => ({ ...prev, open: false }));
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [snackbar.open]);

  const showNotification = (msg, severity = 'error') => {
    setSnackbar({ open: true, message: msg, severity });
  };

  async function load() {
    setLoading(true);
    try {
      const [rolesData, nodesData] = await Promise.all([
        api.getRoles(),
        api.getAllOrgNodesFlat()
      ]);
      setRoles(rolesData);
      setOrgNodes(nodesData);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAssignSubmit() {
    if (!assignForm.userId.trim()) return;
    setAssigningLoading(true);
    try {
      await api.createAssignment({
        userId: assignForm.userId.trim(),
        userName: assignForm.userName.trim() || assignForm.userId.trim(),
        role_ID: assigningRole.ID
      });
      showNotification(`Successfully assigned role "${assigningRole.name}" to ${assignForm.userId}`, 'success');
      setAssigningRole(null);
      setAssignForm({ userId: '', userName: '' });
      await load();
    } catch (e) {
      showNotification(e.message, 'error');
    }
    setAssigningLoading(false);
  }

  // Apply health filters
  const healthFilteredRoles = roles.filter(role => {
    if (!healthFilter) return true;
    if (healthFilter === 'unrestricted') {
      return !role.ownRestrictions || role.ownRestrictions.length === 0;
    }
    if (healthFilter === 'no-users') {
      return !role.assignments || role.assignments.length === 0;
    }
    if (healthFilter === 'no-approver') {
      return !role.approvers || role.approvers.length === 0;
    }
    if (healthFilter === 'critical') {
      return !!role.critical;
    }
    return true;
  });

  // Filter roles based on name, description, and restrictions
  const filteredRoles = healthFilteredRoles.filter(role => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const nameMatch = role.name.toLowerCase().includes(q);
    const descMatch = role.description && role.description.toLowerCase().includes(q);
    const restMatch = role.ownRestrictions && role.ownRestrictions.some(r => 
      r.field.toLowerCase().includes(q) || 
      r.value.toLowerCase().includes(q)
    );
    return nameMatch || descMatch || restMatch;
  });

  const isFilterActive = Boolean(searchQuery.trim() || healthFilter);
  const rootRoles = roles.filter(r => !r.parentRoles || r.parentRoles.length === 0);

  return (
    <div style={{ animation: 'fadeIn 0.3s', padding: '16px' }}>
      <FlexBox justifyContent="SpaceBetween" alignItems="Center" style={{ flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
        <div>
          <Text style={{ fontSize: '24px', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>Roles & Authorizations</Text>
          <Text style={{ color: 'var(--sapContent_LabelColor)' }}>Visual inheritance tree of all Org-Based, Single, and Derived roles</Text>
        </div>
        <FlexBox alignItems="Center" style={{ gap: '12px', flexWrap: 'wrap' }}>
          {healthFilter && (
            <Tag design="Set8" style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px' }}>
              {healthFilter === 'unrestricted' ? 'Unrestricted Roles' :
               healthFilter === 'no-users' ? 'Roles with No Users' :
               healthFilter === 'no-approver' ? 'Roles with No Approver' : 
               healthFilter === 'critical' ? 'Critical Roles' : 'Filtered'}
              <Icon 
                name="decline" 
                style={{ cursor: 'pointer', width: '12px', height: '12px' }} 
                onClick={() => {
                  setHealthFilter(null);
                  if (setInitialFilter) setInitialFilter(null);
                }}
              />
            </Tag>
          )}
          <Input
            placeholder="Search roles or restrictions…"
            value={searchQuery}
            onInput={e => setSearchQuery(e.target.value)}
            style={{ width: '260px' }}
            icon={<Icon name="search" />}
          />
          <SegmentedButton
            onSelectionChange={(e) => {
              const selectedItem = e.detail.selectedItem;
              const val = selectedItem.getAttribute('data-value');
              if (val) setViewMode(val);
            }}
          >
            <SegmentedButtonItem data-value="compact" selected={viewMode === 'compact'}>
              Compact
            </SegmentedButtonItem>
            <SegmentedButtonItem data-value="detailed" selected={viewMode === 'detailed'}>
              Detailed
            </SegmentedButtonItem>
          </SegmentedButton>
          <Button 
            design="Emphasized" 
            onClick={onCreateRole} 
            disabled={permissions && !permissions.canManageSingleRoles && !permissions.canManageOrgRoles}
            icon="add"
          >
            Create Role
          </Button>
        </FlexBox>
      </FlexBox>

      <Toast ref={toastRef} duration={6000}>
        {snackbar.severity === 'error' ? 'Error: ' : ''}{snackbar.message}
      </Toast>

      {loading ? (
        <FlexBox justifyContent="Center" style={{ padding: '64px' }}>
          <BusyIndicator active size="Large" />
        </FlexBox>
      ) : rootRoles.length === 0 ? (
        <Card style={{ padding: '64px', textAlign: 'center' }}>
          <FlexBox direction="Column" alignItems="Center" justifyContent="Center" style={{ gap: '16px' }}>
            <Icon name="shield" style={{ width: '40px', height: '40px', opacity: 0.5 }} />
            <Text style={{ fontWeight: 'bold', fontSize: '16px' }}>No roles yet</Text>
            <Text style={{ color: 'var(--sapContent_LabelColor)' }}>Generate an Org Role from the Org Structure view, or create a new role in the wizard.</Text>
          </FlexBox>
        </Card>
      ) : (
        <FlexBox direction="Column" style={{ gap: '20px' }}>
          {isFilterActive ? (
            filteredRoles.length === 0 ? (
              <Card style={{ padding: '32px', textAlign: 'center' }}>
                <Text style={{ color: 'var(--sapContent_LabelColor)' }}>No matching roles or restrictions found.</Text>
              </Card>
            ) : (
              filteredRoles.map(r => (
                <RoleCard
                  key={r.ID}
                  role={r}
                  allRoles={roles}
                  orgNodes={orgNodes}
                  depth={0}
                  onDerive={onDeriveRole}
                  onEdit={onEditRole}
                  onRefresh={load}
                  isSearchActive={true}
                  onError={msg => showNotification(msg, 'error')}
                  onAssign={setAssigningRole}
                  isCompact={viewMode === 'compact'}
                  permissions={permissions}
                />
              ))
            )
          ) : (
            rootRoles.map(r => (
              <RoleCard
                key={r.ID}
                role={r}
                allRoles={roles}
                orgNodes={orgNodes}
                depth={0}
                onDerive={onDeriveRole}
                onEdit={onEditRole}
                onRefresh={load}
                onError={msg => showNotification(msg, 'error')}
                onAssign={setAssigningRole}
                isCompact={viewMode === 'compact'}
                permissions={permissions}
              />
            ))
          )}
        </FlexBox>
      )}

      {/* Assign User Dialog */}
      <Dialog 
        open={Boolean(assigningRole)} 
        headerText="Assign User to Role"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%', padding: '12px 16px' }}>
            <Button design="Transparent" onClick={() => setAssigningRole(null)} disabled={assigningLoading}>
              Cancel
            </Button>
            <Button design="Emphasized" onClick={handleAssignSubmit} disabled={assigningLoading || !assignForm.userId.trim()}>
              {assigningLoading ? 'Assigning...' : 'Assign'}
            </Button>
          </div>
        }
      >
        <FlexBox direction="Column" style={{ gap: '16px', padding: '16px', minWidth: '320px' }}>
          <Text style={{ color: 'var(--sapContent_LabelColor)' }}>
            Assign role <strong>{assigningRole?.name}</strong> to a user or group.
          </Text>
          <FlexBox direction="Column" style={{ gap: '4px' }}>
            <Label required>User ID / Group ID</Label>
            <Input
              placeholder="e.g. US12345"
              value={assignForm.userId}
              onInput={e => setAssignForm(prev => ({ ...prev, userId: e.target.value }))}
              disabled={assigningLoading}
            />
          </FlexBox>
          <FlexBox direction="Column" style={{ gap: '4px' }}>
            <Label>User Name</Label>
            <Input
              placeholder="e.g. John Doe"
              value={assignForm.userName}
              onInput={e => setAssignForm(prev => ({ ...prev, userName: e.target.value }))}
              disabled={assigningLoading}
            />
          </FlexBox>
        </FlexBox>
      </Dialog>
    </div>
  );
}
