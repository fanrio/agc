import { useState, useEffect } from 'react';
import { 
  Button, 
  Card, 
  CardHeader,
  Title,
  Text,
  Label,
  Table, 
  TableHeaderRow,
  TableHeaderCell, 
  TableRow, 
  TableCell, 
  Icon, 
  BusyIndicator, 
  Select, 
  Option, 
  Input, 
  MessageStrip, 
  FlexBox 
} from '@ui5/webcomponents-react';
import '@ui5/webcomponents-icons/dist/AllIcons.js';
import * as api from '../api';

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

export default function RoleAssignmentsView({ permissions }) {
  const [assignments, setAssignments] = useState([]);
  const [roles, setRoles]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showAdd, setShowAdd]         = useState(false);
  const [error, setError]             = useState(''); // Kept for reference but using snackbar/message strip instead
  const [snackbar, setSnackbar]       = useState({ open: false, message: '', severity: 'error' });

  // Form states
  const [form, setForm] = useState({ userId: '', userName: '', roleId: '' });

  async function load() {
    setLoading(true);
    try {
      const [assignData, roleData] = await Promise.all([
        api.getAssignments(),
        api.getRoles()
      ]);
      setAssignments(assignData);
      setRoles(roleData);
    } catch (e) {
      setError(`Failed to load data: ${e.message}`);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    if (!form.userId.trim() || !form.roleId) {
      setSnackbar({ open: true, message: 'User ID and Role selection are required.', severity: 'error' });
      return;
    }

    const payload = {
      userId: form.userId.trim(),
      userName: form.userName.trim() || form.userId.trim(),
      role_ID: form.roleId
    };

    setLoading(true);
    try {
      await api.createAssignment(payload);
      setForm({ userId: '', userName: '', roleId: '' });
      setShowAdd(false);
      await load();
    } catch (e) {
      setSnackbar({ open: true, message: e.message, severity: 'error' });
    }
    setLoading(false);
  }

  async function handleDelete(id, user, roleName) {
    if (!confirm(`Remove assignment of role "${roleName}" from user "${user}"?`)) return;
    setLoading(true);
    try {
      await api.deleteAssignment(id);
      await load();
    } catch (e) {
      setSnackbar({ open: true, message: e.message, severity: 'error' });
    }
    setLoading(false);
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s' }}>
      <FlexBox justifyContent="SpaceBetween" alignItems="Center" style={{ marginBottom: '24px' }}>
        <FlexBox direction="Column" style={{ gap: '4px' }}>
          <Title level="H3" style={{ fontWeight: 700 }}>Role Assignments</Title>
          <Text style={{ color: 'var(--sapContent_LabelColor)' }}>Assign authorization roles to users and groups</Text>
        </FlexBox>
        <Button 
          design="Emphasized" 
          onClick={() => { setShowAdd(s => !s); setSnackbar(prev => ({ ...prev, open: false })); }} 
          disabled={permissions && !permissions.canAssignRoles}
          icon="sap-icon://add"
        >
          Assign Role
        </Button>
      </FlexBox>

      {snackbar.open && (
        <MessageStrip
          design={snackbar.severity === 'error' ? 'Negative' : 'Positive'}
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          style={{ marginBottom: '16px' }}
        >
          {snackbar.message}
        </MessageStrip>
      )}

      {showAdd && (
        <Card header={<CardHeader titleText="Assign Role" />} style={{ marginBottom: '24px' }}>
          <div style={{ padding: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', alignItems: 'end' }}>
              <FlexBox direction="Column" style={{ gap: '4px' }}>
                <Label showColon>User ID / Group ID</Label>
                <Input
                  placeholder="e.g. US12345"
                  value={form.userId}
                  onInput={e => setForm(f => ({ ...f, userId: e.target.value }))}
                />
              </FlexBox>
              <FlexBox direction="Column" style={{ gap: '4px' }}>
                <Label>User Name (Optional)</Label>
                <Input
                  placeholder="e.g. John Doe"
                  value={form.userName}
                  onInput={e => setForm(f => ({ ...f, userName: e.target.value }))}
                />
              </FlexBox>
              <FlexBox direction="Column" style={{ gap: '4px' }}>
                <Label showColon>Role</Label>
                <Select
                  onChange={e => setForm(f => ({ ...f, roleId: e.detail.selectedOption.value }))}
                  style={{ width: '100%' }}
                >
                  <Option value="" selected={form.roleId === ''}>Select Role</Option>
                  {roles.map(r => {
                    const allowed = hasAnyRestrictions(r, roles);
                    return (
                      <Option key={r.ID} value={r.ID} disabled={!allowed} selected={form.roleId === r.ID}>
                        {`${r.name} (${r.type === 'ORG_BASED' ? 'Org' : (r.parentRoles && r.parentRoles.length > 0 ? 'Derived' : 'Single')})${!allowed ? ' - No Restrictions' : ''}`}
                      </Option>
                    );
                  })}
                </Select>
              </FlexBox>
              <FlexBox alignItems="Center" style={{ gap: '8px' }}>
                <Button design="Emphasized" onClick={handleCreate} disabled={loading} icon="sap-icon://accept">
                  Assign
                </Button>
                <Button design="Transparent" onClick={() => setShowAdd(false)} icon="sap-icon://decline" />
              </FlexBox>
            </div>
          </div>
        </Card>
      )}

      <Card>
        {loading && assignments.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
            <BusyIndicator active size="Medium" />
          </div>
        ) : assignments.length === 0 ? (
          <div style={{ padding: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '16px' }}>
            <div style={{ opacity: 0.5 }}>
              <Icon name="sap-icon://group" style={{ fontSize: '40px', width: '40px', height: '40px' }} />
            </div>
            <Title level="H4">No role assignments yet</Title>
            <Text style={{ color: 'var(--sapContent_LabelColor)' }}>Click "Assign Role" to link a user or group to an authorization role.</Text>
          </div>
        ) : (
          <Table
            headerRow={
              <TableHeaderRow>
                <TableHeaderCell style={{ width: '25%' }}><Text style={{ fontWeight: 'bold' }}>User ID</Text></TableHeaderCell>
                <TableHeaderCell style={{ width: '30%' }}><Text style={{ fontWeight: 'bold' }}>User Name</Text></TableHeaderCell>
                <TableHeaderCell style={{ width: '30%' }}><Text style={{ fontWeight: 'bold' }}>Assigned Role</Text></TableHeaderCell>
                <TableHeaderCell style={{ width: '15%', textAlign: 'end' }}><Text style={{ fontWeight: 'bold' }}>Actions</Text></TableHeaderCell>
              </TableHeaderRow>
            }
          >
            {assignments.map(a => (
              <TableRow key={a.ID}>
                <TableCell>
                  <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{a.userId}</span>
                </TableCell>
                <TableCell>
                  <span style={{ fontWeight: 500 }}>{a.userName || a.userId}</span>
                </TableCell>
                <TableCell>
                  <FlexBox alignItems="Center" style={{ gap: '8px' }}>
                    <Icon 
                      name="sap-icon://shield" 
                      style={{ color: a.role?.type === 'ORG_BASED' ? '#3b82f6' : '#a78bfa', width: '16px', height: '16px' }} 
                    />
                    <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>
                      {a.role?.name || 'Unknown Role'}
                    </span>
                  </FlexBox>
                </TableCell>
                <TableCell style={{ textAlign: 'end' }}>
                  <Button
                    design="Transparent"
                    icon="sap-icon://delete"
                    onClick={() => handleDelete(a.ID, a.userName || a.userId, a.role?.name || 'Unknown')}
                    disabled={loading || (permissions && !permissions.canAssignRoles)}
                    style={{ color: 'var(--sapContent_NegativeTextColor)' }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

