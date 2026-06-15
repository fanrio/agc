import { useState, useEffect } from 'react';
import { 
  Button, 
  Card, 
  Title, 
  Text,
  Table, 
  TableHeaderRow,
  TableHeaderCell, 
  TableRow, 
  TableCell, 
  CheckBox, 
  Dialog, 
  Bar,
  ComboBox,
  ComboBoxItem,
  BusyIndicator,
  MessageStrip,
  FlexBox,
  Icon
} from '@ui5/webcomponents-react';
import '@ui5/webcomponents-icons/dist/AllIcons.js';
import * as api from '../api';

export default function AppAuthorizationsView() {
  const [authorizations, setAuthorizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ldapOptions, setLdapOptions] = useState([]);
  const [ldapLoading, setLdapLoading] = useState(false);
  const [ldapInput, setLdapInput] = useState('');
  
  // Dialog state
  const [openAdd, setOpenAdd] = useState(false);
  const [selectedLdapUser, setSelectedLdapUser] = useState(null);
  const [newPermissions, setNewPermissions] = useState({
    canManageOrgRoles: true,
    canManageSingleRoles: true,
    canManageDerivedRoles: true,
    canAssignRoles: true
  });
  
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await api.getAppAuthorizations();
      setAuthorizations(data || []);
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Failed to load authorizations', severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Debounced LDAP search
  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      if (!ldapInput.trim()) return;
      setLdapLoading(true);
      api.searchLdapUsers(ldapInput)
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
  }, [ldapInput]);

  const handleTogglePermission = async (id, field, value) => {
    try {
      await api.updateAppAuthorization(id, { [field]: value });
      setAuthorizations(prev => prev.map(item => item.ID === id ? { ...item, [field]: value } : item));
      setSnackbar({ open: true, message: 'Authorization updated successfully', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Update failed', severity: 'error' });
    }
  };

  const handleAddAuthorization = async () => {
    if (!selectedLdapUser) {
      setSnackbar({ open: true, message: 'Please select a user from LDAP', severity: 'error' });
      return;
    }

    // Check if user already exists
    const exists = authorizations.some(a => a.userId.toLowerCase() === selectedLdapUser.username.toLowerCase());
    if (exists) {
      setSnackbar({ open: true, message: `User "${selectedLdapUser.displayName}" is already configured`, severity: 'error' });
      return;
    }

    try {
      const newAuth = await api.createAppAuthorization({
        userId: selectedLdapUser.username,
        userName: selectedLdapUser.displayName,
        canManageOrgRoles: newPermissions.canManageOrgRoles,
        canManageSingleRoles: newPermissions.canManageSingleRoles,
        canManageDerivedRoles: newPermissions.canManageDerivedRoles,
        canAssignRoles: newPermissions.canAssignRoles
      });
      setAuthorizations(prev => [...prev, newAuth]);
      setOpenAdd(false);
      setSelectedLdapUser(null);
      setNewPermissions({ canManageOrgRoles: true, canManageSingleRoles: true, canManageDerivedRoles: true, canAssignRoles: true });
      setSnackbar({ open: true, message: 'User authorization added successfully', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Failed to add authorization', severity: 'error' });
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Remove application authorizations for user "${name}"?`)) return;
    try {
      await api.deleteAppAuthorization(id);
      setAuthorizations(prev => prev.filter(item => item.ID !== id));
      setSnackbar({ open: true, message: 'Authorization removed successfully', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.message || 'Deletion failed', severity: 'error' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {snackbar.open && (
        <MessageStrip
          design={snackbar.severity === 'error' ? 'Negative' : 'Positive'}
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          style={{ marginBottom: '16px' }}
        >
          {snackbar.message}
        </MessageStrip>
      )}

      <FlexBox justifyContent="SpaceBetween" alignItems="Center">
        <FlexBox direction="Column" style={{ gap: '4px' }}>
          <Title level="H3" style={{ fontWeight: 700 }}>
            Application Access Control
          </Title>
          <Text style={{ color: 'var(--sapContent_LabelColor)' }}>
            Manage roles/features permission levels for administrators within the Auth Wizard itself.
          </Text>
        </FlexBox>
        <Button 
          design="Emphasized" 
          icon="sap-icon://add"
          onClick={() => setOpenAdd(true)}
        >
          Add User Authorization
        </Button>
      </FlexBox>

      {authorizations.length === 0 && !loading && (
        <MessageStrip
          design="Warning"
          hideCloseButton
          style={{ marginBottom: '16px' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontWeight: 600 }}>Open Demo Mode Active</span>
            <span>
              No user authorizations are explicitly defined yet. All logged-in simulation users have full administrator access. Add a user below to enable strict role-based access control.
            </span>
          </div>
        </MessageStrip>
      )}

      <Card>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
            <BusyIndicator active size="Medium" />
          </div>
        ) : (
          <Table
            headerRow={
              <TableHeaderRow>
                <TableHeaderCell><Text style={{ fontWeight: 'bold' }}>User ID</Text></TableHeaderCell>
                <TableHeaderCell><Text style={{ fontWeight: 'bold' }}>User Name</Text></TableHeaderCell>
                <TableHeaderCell style={{ textAlign: 'center' }}><Text style={{ fontWeight: 'bold' }}>Manage Org Roles</Text></TableHeaderCell>
                <TableHeaderCell style={{ textAlign: 'center' }}><Text style={{ fontWeight: 'bold' }}>Manage Single Roles</Text></TableHeaderCell>
                <TableHeaderCell style={{ textAlign: 'center' }}><Text style={{ fontWeight: 'bold' }}>Manage Derived Roles</Text></TableHeaderCell>
                <TableHeaderCell style={{ textAlign: 'center' }}><Text style={{ fontWeight: 'bold' }}>Assign Roles</Text></TableHeaderCell>
                <TableHeaderCell style={{ textAlign: 'end' }}><Text style={{ fontWeight: 'bold' }}>Actions</Text></TableHeaderCell>
              </TableHeaderRow>
            }
          >
            {authorizations.length === 0 ? (
              <TableRow>
                <TableCell style={{ textAlign: 'center' }} colSpan={7}>
                  <Text style={{ color: 'var(--sapContent_LabelColor)' }}>No administrator authorization definitions set.</Text>
                </TableCell>
              </TableRow>
            ) : (
              authorizations.map(auth => (
                <TableRow key={auth.ID}>
                  <TableCell>
                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{auth.userId}</span>
                  </TableCell>
                  <TableCell>
                    <span style={{ fontWeight: 500 }}>{auth.userName}</span>
                  </TableCell>
                  <TableCell style={{ textAlign: 'center' }}>
                    <CheckBox 
                      checked={auth.canManageOrgRoles}
                      onChange={(e) => handleTogglePermission(auth.ID, 'canManageOrgRoles', e.target.checked)}
                    />
                  </TableCell>
                  <TableCell style={{ textAlign: 'center' }}>
                    <CheckBox 
                      checked={auth.canManageSingleRoles}
                      onChange={(e) => handleTogglePermission(auth.ID, 'canManageSingleRoles', e.target.checked)}
                    />
                  </TableCell>
                  <TableCell style={{ textAlign: 'center' }}>
                    <CheckBox 
                      checked={auth.canManageDerivedRoles}
                      onChange={(e) => handleTogglePermission(auth.ID, 'canManageDerivedRoles', e.target.checked)}
                    />
                  </TableCell>
                  <TableCell style={{ textAlign: 'center' }}>
                    <CheckBox 
                      checked={auth.canAssignRoles}
                      onChange={(e) => handleTogglePermission(auth.ID, 'canAssignRoles', e.target.checked)}
                    />
                  </TableCell>
                  <TableCell style={{ textAlign: 'end' }}>
                    <Button 
                      design="Transparent"
                      icon="sap-icon://delete"
                      onClick={() => handleDelete(auth.ID, auth.userName || auth.userId)}
                      style={{ color: 'var(--sapContent_NegativeTextColor)' }}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </Table>
        )}
      </Card>

      <Dialog 
        open={openAdd} 
        onClose={() => setOpenAdd(false)}
        header={
          <Bar startContent={<Title level="H4">Add User Authorization</Title>} />
        }
        footer={
          <Bar 
            endContent={
              <>
                <Button onClick={() => setOpenAdd(false)} design="Transparent">Cancel</Button>
                <Button onClick={handleAddAuthorization} design="Emphasized" disabled={!selectedLdapUser}>Add</Button>
              </>
            } 
          />
        }
        style={{ width: '450px' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px' }}>
          <FlexBox alignItems="Center" style={{ gap: '8px', width: '100%' }}>
            <ComboBox
              placeholder="Search User (LDAP)..."
              value={selectedLdapUser ? `${selectedLdapUser.displayName} (${selectedLdapUser.username})` : ldapInput}
              onInput={e => {
                setLdapInput(e.target.value);
                if (!e.target.value) {
                  setSelectedLdapUser(null);
                }
              }}
              onSelectionChange={e => {
                const selectedItem = e.detail.item;
                if (selectedItem) {
                  const username = selectedItem.dataset.username;
                  const option = ldapOptions.find(o => o.username === username);
                  if (option) {
                    setSelectedLdapUser(option);
                  }
                } else {
                  setSelectedLdapUser(null);
                }
              }}
              style={{ width: '100%' }}
            >
              {ldapOptions.map(option => (
                <ComboBoxItem
                  key={option.username}
                  text={`${option.displayName} (${option.username})`}
                  data-username={option.username}
                />
              ))}
            </ComboBox>
            {ldapLoading && <BusyIndicator active size="Small" />}
          </FlexBox>

          {selectedLdapUser && (
            <div style={{ backgroundColor: 'var(--sapList_Background)', padding: '8px', borderRadius: '4px', border: '1px solid var(--sapGroup_BorderColor)' }}>
              <Text style={{ fontWeight: 'bold', display: 'block' }}>
                {selectedLdapUser.displayName} ({selectedLdapUser.username})
              </Text>
              <Text style={{ color: 'var(--sapContent_LabelColor)', fontSize: '12px' }}>
                Department: {selectedLdapUser.department}
              </Text>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Title level="H5" style={{ fontWeight: 600 }}>Permissions</Title>
            
            <FlexBox alignItems="Center" style={{ gap: '8px' }}>
              <CheckBox 
                checked={newPermissions.canManageOrgRoles}
                onChange={(e) => setNewPermissions(prev => ({ ...prev, canManageOrgRoles: e.target.checked }))}
                id="perm-org-roles"
              />
              <div style={{ cursor: 'pointer' }} onClick={() => setNewPermissions(prev => ({ ...prev, canManageOrgRoles: !prev.canManageOrgRoles }))}>
                <Text style={{ fontWeight: 500, display: 'block' }}>Manage Org-Based Roles</Text>
                <Text style={{ fontSize: '12px', color: 'var(--sapContent_LabelColor)' }}>Add, change, delete org-based roles</Text>
              </div>
            </FlexBox>

            <FlexBox alignItems="Center" style={{ gap: '8px', marginTop: '4px' }}>
              <CheckBox 
                checked={newPermissions.canManageSingleRoles}
                onChange={(e) => setNewPermissions(prev => ({ ...prev, canManageSingleRoles: e.target.checked }))}
                id="perm-single-roles"
              />
              <div style={{ cursor: 'pointer' }} onClick={() => setNewPermissions(prev => ({ ...prev, canManageSingleRoles: !prev.canManageSingleRoles }))}>
                <Text style={{ fontWeight: 500, display: 'block' }}>Manage Single Roles</Text>
                <Text style={{ fontSize: '12px', color: 'var(--sapContent_LabelColor)' }}>Add, change, delete custom single roles</Text>
              </div>
            </FlexBox>

            <FlexBox alignItems="Center" style={{ gap: '8px', marginTop: '4px' }}>
              <CheckBox 
                checked={newPermissions.canManageDerivedRoles}
                onChange={(e) => setNewPermissions(prev => ({ ...prev, canManageDerivedRoles: e.target.checked }))}
                id="perm-derived-roles"
              />
              <div style={{ cursor: 'pointer' }} onClick={() => setNewPermissions(prev => ({ ...prev, canManageDerivedRoles: !prev.canManageDerivedRoles }))}>
                <Text style={{ fontWeight: 500, display: 'block' }}>Manage Derived Roles</Text>
                <Text style={{ fontSize: '12px', color: 'var(--sapContent_LabelColor)' }}>Add, change, delete child roles containing parents</Text>
              </div>
            </FlexBox>

            <FlexBox alignItems="Center" style={{ gap: '8px', marginTop: '4px' }}>
              <CheckBox 
                checked={newPermissions.canAssignRoles}
                onChange={(e) => setNewPermissions(prev => ({ ...prev, canAssignRoles: e.target.checked }))}
                id="perm-assign"
              />
              <div style={{ cursor: 'pointer' }} onClick={() => setNewPermissions(prev => ({ ...prev, canAssignRoles: !prev.canAssignRoles }))}>
                <Text style={{ fontWeight: 500, display: 'block' }}>Assign Roles</Text>
                <Text style={{ fontSize: '12px', color: 'var(--sapContent_LabelColor)' }}>Link and assign roles to users</Text>
              </div>
            </FlexBox>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

