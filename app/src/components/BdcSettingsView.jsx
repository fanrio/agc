import { useState, useEffect, useRef } from 'react';
import { 
  FlexBox, 
  Card, 
  CardHeader, 
  Title, 
  Label, 
  Button, 
  Input, 
  Select, 
  Option, 
  CheckBox, 
  Tag, 
  BusyIndicator, 
  MessageStrip, 
  Icon, 
  Toast 
} from '@ui5/webcomponents-react';
import "@ui5/webcomponents-icons/dist/add.js";
import "@ui5/webcomponents-icons/dist/delete.js";
import "@ui5/webcomponents-icons/dist/edit.js";
import "@ui5/webcomponents-icons/dist/accept.js";
import "@ui5/webcomponents-icons/dist/decline.js";
import "@ui5/webcomponents-icons/dist/cloud.js";
import "@ui5/webcomponents-icons/dist/connected.js";
import * as api from '../api';

export default function BdcSettingsView() {
  const [settings, setSettings] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [editingId, setEditingId] = useState(null);
  
  // State for Toast Notifications
  const [toastMessage, setToastMessage] = useState('');
  const toastRef = useRef(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    toastRef.current?.show();
  };

  const [fetchedSpaces, setFetchedSpaces] = useState([]);
  const [fetchingSpaces, setFetchingSpaces] = useState(false);

  // Form states
  const [form, setForm] = useState({
    systemName: '',
    connectionType: 'OData',
    url: '',
    host: '',
    port: 443,
    authType: 'OAUTH',
    space: '',
    username: '',
    password: '',
    tokenUrl: '',
    clientId: '',
    clientSecret: '',
    taskChainFlat: 'df_authorization_flat',
    taskChainHierarchy: '',
    isActive: true
  });

  const [editForm, setEditForm] = useState({
    systemName: '',
    connectionType: 'OData',
    url: '',
    host: '',
    port: 443,
    authType: 'OAUTH',
    space: '',
    username: '',
    password: '',
    tokenUrl: '',
    clientId: '',
    clientSecret: '',
    taskChainFlat: '',
    taskChainHierarchy: '',
    isActive: true
  });

  async function load() {
    setLoading(true);
    try {
      const data = await api.getBdcSettings();
      setSettings(data);
    } catch (e) {
      showToast(`Failed to load settings: ${e.message}`);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const { url, tokenUrl, clientId, clientSecret, connectionType } = form;
    if (connectionType === 'SAP Hana') return;
    if (url.trim() && tokenUrl.trim() && clientId.trim() && clientSecret.trim()) {
      handleLoadSpaces(false, true);
    }
  }, [form.url, form.tokenUrl, form.clientId, form.clientSecret, form.connectionType]);

  useEffect(() => {
    const { url, tokenUrl, clientId, clientSecret, connectionType } = editForm;
    if (connectionType === 'SAP Hana') return;
    if (url.trim() && tokenUrl.trim() && clientId.trim() && clientSecret.trim()) {
      handleLoadSpaces(true, true);
    }
  }, [editForm.url, editForm.tokenUrl, editForm.clientId, editForm.clientSecret, editForm.connectionType]);

  function validate(f) {
    if (!f.systemName.trim()) return 'System Name is required.';
    if (f.connectionType === 'SAP Hana') {
      if (!f.host || !f.host.trim()) return 'Hostname is required.';
      if (!f.port || String(f.port).trim() === '') return 'Port is required.';
      if (!f.username || !f.username.trim()) return 'User is required.';
      if (!f.password || !f.password.trim()) return 'Password is required.';
    } else {
      if (!f.url.trim()) return 'Basis URL is required.';
      if (!f.url.startsWith('http://') && !f.url.startsWith('https://')) {
        return 'Basis URL must start with http:// or https://';
      }
      if (!f.tokenUrl.trim()) return 'Token URL is required.';
      if (!f.clientId.trim()) return 'Client ID is required.';
      if (!f.clientSecret.trim()) return 'Client Secret is required.';
      if (!f.space.trim()) return 'Space is required. Fetch and select a space.';
    }
    return '';
  }

  async function handleLoadSpaces(isEdit, isAuto = false) {
    const f = isEdit ? editForm : form;
    if (!f.url.trim() || !f.tokenUrl.trim() || !f.clientId.trim() || !f.clientSecret.trim()) {
      if (!isAuto) {
        showToast('Please fill out Basis URL, Token URL, Client ID, and Client Secret first.');
      }
      return;
    }
    setFetchingSpaces(true);
    try {
      const spaces = await api.fetchBdcSpaces(f.url, f.tokenUrl, f.clientId, f.clientSecret);
      setFetchedSpaces(spaces);
      if (!isAuto) {
        showToast(`Successfully loaded ${spaces.length} spaces.`);
      }
    } catch (e) {
      if (!isAuto) {
        showToast(`Failed to load spaces: ${e.message}`);
      }
    }
    setFetchingSpaces(false);
  }

  async function handleCreate() {
    const err = validate(form);
    if (err) {
      showToast(err);
      return;
    }

    setLoading(true);
    try {
      const payload = {
        systemName: form.systemName,
        connectionType: form.connectionType,
        url: form.connectionType === 'SAP Hana' ? '' : form.url,
        host: form.connectionType === 'SAP Hana' ? form.host : '',
        port: form.connectionType === 'SAP Hana' ? parseInt(form.port) || 443 : 443,
        authType: form.connectionType === 'SAP Hana' ? '' : 'OAUTH',
        space: form.connectionType === 'SAP Hana' ? '' : form.space,
        username: form.username,
        password: form.password,
        tokenUrl: form.connectionType === 'SAP Hana' ? '' : form.tokenUrl,
        clientId: form.connectionType === 'SAP Hana' ? '' : form.clientId,
        clientSecret: form.connectionType === 'SAP Hana' ? '' : form.clientSecret,
        taskChainFlat: form.taskChainFlat,
        taskChainHierarchy: form.taskChainHierarchy,
        isActive: form.isActive
      };
      const created = await api.createBdcSetting(payload);
      
      setForm({
        systemName: '',
        connectionType: 'OData',
        url: '',
        host: '',
        port: 443,
        authType: 'OAUTH',
        space: '',
        username: '',
        password: '',
        tokenUrl: '',
        clientId: '',
        clientSecret: '',
        taskChainFlat: 'df_authorization_flat',
        taskChainHierarchy: '',
        isActive: true
      });
      setFetchedSpaces([]);
      setShowAdd(false);
      await load();

      if (payload.connectionType === 'SAP Hana' && created && created.ID) {
        const testRes = await api.testBdcConnection(created.ID);
        if (testRes && testRes.success) {
          showToast(`HANA connection saved and verified successfully: ${testRes.message}`);
        } else {
          showToast(`HANA connection saved, but verification failed: ${testRes ? testRes.message : 'Unknown error'}`);
        }
      } else {
        showToast('BDC Connection setting created successfully!');
      }
    } catch (e) {
      showToast(e.message);
    }
    setLoading(false);
  }

  async function handleUpdate(id) {
    const err = validate(editForm);
    if (err) {
      showToast(err);
      return;
    }

    setLoading(true);
    try {
      const payload = {
        systemName: editForm.systemName,
        connectionType: editForm.connectionType,
        url: editForm.connectionType === 'SAP Hana' ? '' : editForm.url,
        host: editForm.connectionType === 'SAP Hana' ? editForm.host : '',
        port: editForm.connectionType === 'SAP Hana' ? parseInt(editForm.port) || 443 : 443,
        authType: editForm.connectionType === 'SAP Hana' ? '' : 'OAUTH',
        space: editForm.connectionType === 'SAP Hana' ? '' : editForm.space,
        username: editForm.username,
        password: editForm.password,
        tokenUrl: editForm.connectionType === 'SAP Hana' ? '' : editForm.tokenUrl,
        clientId: editForm.connectionType === 'SAP Hana' ? '' : editForm.clientId,
        clientSecret: editForm.connectionType === 'SAP Hana' ? '' : editForm.clientSecret,
        taskChainFlat: editForm.taskChainFlat,
        taskChainHierarchy: editForm.taskChainHierarchy,
        isActive: editForm.isActive
      };
      await api.updateBdcSetting(id, payload);
      setEditingId(null);
      setFetchedSpaces([]);
      await load();

      if (payload.connectionType === 'SAP Hana') {
        const testRes = await api.testBdcConnection(id);
        if (testRes && testRes.success) {
          showToast(`HANA connection updated and verified successfully: ${testRes.message}`);
        } else {
          showToast(`HANA connection updated, but verification failed: ${testRes ? testRes.message : 'Unknown error'}`);
        }
      } else {
        showToast('BDC Connection setting updated successfully!');
      }
    } catch (e) {
      showToast(e.message);
    }
    setLoading(false);
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete BDC System Connection "${name}"?`)) return;
    setLoading(true);
    try {
      await api.deleteBdcSetting(id);
      await load();
      showToast('Connection setting deleted.');
    } catch (e) {
      showToast(e.message);
    }
    setLoading(false);
  }

  async function handleTestConnection(id) {
    showToast('Testing connection...');
    try {
      const res = await api.testBdcConnection(id);
      if (res.success) {
        showToast(res.message);
      } else {
        showToast(res.message);
      }
    } catch (e) {
      showToast(`Connection test failed: ${e.message}`);
    }
  }

  function startEdit(s) {
    setEditingId(s.ID);
    setEditForm({
      systemName: s.systemName,
      connectionType: s.connectionType || 'OData',
      url: s.url || '',
      host: s.host || '',
      port: s.port !== undefined ? s.port : 443,
      authType: s.authType || 'OAUTH',
      space: s.space || '',
      username: s.username || '',
      password: s.password || '',
      tokenUrl: s.tokenUrl || '',
      clientId: s.clientId || '',
      clientSecret: s.clientSecret || '',
      taskChainFlat: s.taskChainFlat || '',
      taskChainHierarchy: s.taskChainHierarchy || '',
      isActive: s.isActive !== false
    });
    if (s.space) {
      setFetchedSpaces([s.space]);
    } else {
      setFetchedSpaces([]);
    }
  }

  return (
    <FlexBox direction="Column" style={{ width: '100%', gap: '1rem', padding: '1rem', boxSizing: 'border-box' }}>
      <Toast ref={toastRef}>{toastMessage}</Toast>

      <FlexBox justifySelf="Spread" alignItems="Center" style={{ width: '100%', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <FlexBox direction="Column">
          <Title level="H3">Business Data Cloud Connections</Title>
          <Label>Configure BDC system connection parameters, credentials, and catalog space integrations</Label>
        </FlexBox>
        <Button design="Emphasized" icon="add" onClick={() => { setShowAdd(s => !s); }}>
          Add Connection
        </Button>
      </FlexBox>

      {/* Add New Connection Form */}
      {showAdd && (
        <Card style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <FlexBox direction="Column" style={{ gap: '1rem', width: '100%' }}>
            <Title level="H5">New System Connection</Title>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', width: '100%' }}>
              <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                <Label showColon>System Connection Name</Label>
                <Input placeholder="e.g. Datasphere Production" value={form.systemName} onInput={e => setForm(f => ({ ...f, systemName: e.target.value }))} style={{ width: '100%' }} />
              </FlexBox>
              
              <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                <Label showColon>Connection Type</Label>
                <Select onChange={e => setForm(f => ({ ...f, connectionType: e.detail.selectedOption.value }))} style={{ width: '100%' }}>
                  <Option value="OData" selected={form.connectionType === 'OData'}>OData (REST Catalog)</Option>
                  <Option value="SAP Hana" selected={form.connectionType === 'SAP Hana'}>SAP Hana (Direct DB)</Option>
                </Select>
              </FlexBox>

              {form.connectionType === 'SAP Hana' ? (
                <>
                  <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                    <Label showColon>Hostname</Label>
                    <Input placeholder="e.g. host.company.com" value={form.host} onInput={e => setForm(f => ({ ...f, host: e.target.value }))} style={{ width: '100%' }} />
                  </FlexBox>
                  <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                    <Label showColon>Port</Label>
                    <Input type="Number" value={form.port} onInput={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || '' }))} style={{ width: '100%' }} />
                  </FlexBox>
                  <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                    <Label showColon>User</Label>
                    <Input value={form.username} onInput={e => setForm(f => ({ ...f, username: e.target.value }))} style={{ width: '100%' }} />
                  </FlexBox>
                  <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                    <Label showColon>Password</Label>
                    <Input type="Password" value={form.password} onInput={e => setForm(f => ({ ...f, password: e.target.value }))} style={{ width: '100%' }} />
                  </FlexBox>
                </>
              ) : (
                <>
                  <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                    <Label showColon>Basis URL</Label>
                    <Input placeholder="https://port-xxxx.datasphere.cloud.sap" value={form.url} onInput={e => setForm(f => ({ ...f, url: e.target.value }))} style={{ width: '100%' }} />
                  </FlexBox>
                  <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                    <Label showColon>Token URL</Label>
                    <Input placeholder="https://oauth.datasphere.cloud.sap/oauth/token" value={form.tokenUrl} onInput={e => setForm(f => ({ ...f, tokenUrl: e.target.value }))} style={{ width: '100%' }} />
                  </FlexBox>
                  <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                    <Label showColon>Client ID</Label>
                    <Input value={form.clientId} onInput={e => setForm(f => ({ ...f, clientId: e.target.value }))} style={{ width: '100%' }} />
                  </FlexBox>
                  <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                    <Label showColon>Client Secret</Label>
                    <Input type="Password" value={form.clientSecret} onInput={e => setForm(f => ({ ...f, clientSecret: e.target.value }))} style={{ width: '100%' }} />
                  </FlexBox>
                  
                  <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                    <Label showColon>Space</Label>
                    <FlexBox style={{ gap: '0.5rem', width: '100%' }}>
                      <Select 
                        disabled={fetchingSpaces}
                        onChange={e => setForm(f => ({ ...f, space: e.detail.selectedOption.value }))}
                        style={{ flexGrow: 1 }}
                      >
                        {Array.from(new Set([...fetchedSpaces, form.space])).filter(Boolean).map(sp => (
                          <Option key={sp} value={sp} selected={sp === form.space}>{sp}</Option>
                        ))}
                        {fetchedSpaces.length === 0 && !form.space && (
                          <Option value="" disabled selected>Please fetch spaces first</Option>
                        )}
                      </Select>
                      <Button 
                        onClick={() => handleLoadSpaces(false)}
                        disabled={fetchingSpaces}
                      >
                        {fetchingSpaces ? <BusyIndicator active size="S" /> : 'Fetch Spaces'}
                      </Button>
                    </FlexBox>
                  </FlexBox>

                  <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                    <Label showColon>Task chain: Flat authorization</Label>
                    <Input placeholder="e.g. TC_FLAT_AUTH" value={form.taskChainFlat} onInput={e => setForm(f => ({ ...f, taskChainFlat: e.target.value }))} style={{ width: '100%' }} />
                  </FlexBox>
                  <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                    <Label showColon>Task chain: Hierarchy authorization</Label>
                    <Input placeholder="e.g. TC_HIER_AUTH" value={form.taskChainHierarchy} onInput={e => setForm(f => ({ ...f, taskChainHierarchy: e.target.value }))} style={{ width: '100%' }} />
                  </FlexBox>
                </>
              )}
            </div>

            <FlexBox style={{ gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <Button design="Transparent" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button design="Emphasized" icon="accept" onClick={handleCreate} disabled={loading}>Save Connection</Button>
            </FlexBox>
          </FlexBox>
        </Card>
      )}

      {/* Connection Configurations List */}
      <FlexBox direction="Column" style={{ gap: '1.5rem', width: '100%' }}>
        {loading && settings.length === 0 ? (
          <FlexBox justifySelf="Center" style={{ width: '100%', justifyContent: 'center', padding: '3rem 0' }}>
            <BusyIndicator active size="M" />
          </FlexBox>
        ) : settings.length === 0 ? (
          <FlexBox direction="Column" alignItems="Center" justifyContent="Center" style={{ padding: '4rem 0', opacity: 0.5, gap: '1rem' }}>
            <Icon name="cloud" style={{ fontSize: '3rem' }} />
            <Title level="H4">No BDC integrations configured</Title>
            <Label>Configure a BDC integration connection to fetch catalog spaces.</Label>
          </FlexBox>
        ) : (
          settings.map(s => {
            const isEditing = editingId === s.ID;
            const currentType = s.connectionType || 'OData';
            return (
              <Card key={s.ID} style={{ padding: '1.5rem', border: s.isActive ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid #dee2e6' }}>
                {isEditing ? (
                  /* EDIT MODE FORM */
                  <FlexBox direction="Column" style={{ gap: '1rem', width: '100%' }}>
                    <Title level="H5">Edit Connection: {s.systemName}</Title>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', width: '100%' }}>
                      <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                        <Label showColon>System Connection Name</Label>
                        <Input value={editForm.systemName} onInput={e => setEditForm(f => ({ ...f, systemName: e.target.value }))} style={{ width: '100%' }} />
                      </FlexBox>
                      
                      <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                        <Label showColon>Connection Type</Label>
                        <Select onChange={e => setEditForm(f => ({ ...f, connectionType: e.detail.selectedOption.value }))} style={{ width: '100%' }}>
                          <Option value="OData" selected={editForm.connectionType === 'OData'}>OData (REST Catalog)</Option>
                          <Option value="SAP Hana" selected={editForm.connectionType === 'SAP Hana'}>SAP Hana (Direct DB)</Option>
                        </Select>
                      </FlexBox>

                      {editForm.connectionType === 'SAP Hana' ? (
                        <>
                          <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                            <Label showColon>Hostname</Label>
                            <Input placeholder="e.g. host.company.com" value={editForm.host} onInput={e => setEditForm(f => ({ ...f, host: e.target.value }))} style={{ width: '100%' }} />
                          </FlexBox>
                          <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                            <Label showColon>Port</Label>
                            <Input type="Number" value={editForm.port} onInput={e => setEditForm(f => ({ ...f, port: parseInt(e.target.value) || '' }))} style={{ width: '100%' }} />
                          </FlexBox>
                          <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                            <Label showColon>User</Label>
                            <Input value={editForm.username} onInput={e => setEditForm(f => ({ ...f, username: e.target.value }))} style={{ width: '100%' }} />
                          </FlexBox>
                          <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                            <Label showColon>Password</Label>
                            <Input type="Password" placeholder="••••••••" value={editForm.password} onInput={e => setEditForm(f => ({ ...f, password: e.target.value }))} style={{ width: '100%' }} />
                          </FlexBox>
                        </>
                      ) : (
                        <>
                          <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                            <Label showColon>Basis URL</Label>
                            <Input value={editForm.url} onInput={e => setEditForm(f => ({ ...f, url: e.target.value }))} style={{ width: '100%' }} />
                          </FlexBox>
                          <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                            <Label showColon>Token URL</Label>
                            <Input value={editForm.tokenUrl} onInput={e => setEditForm(f => ({ ...f, tokenUrl: e.target.value }))} style={{ width: '100%' }} />
                          </FlexBox>
                          <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                            <Label showColon>Client ID</Label>
                            <Input value={editForm.clientId} onInput={e => setEditForm(f => ({ ...f, clientId: e.target.value }))} style={{ width: '100%' }} />
                          </FlexBox>
                          <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                            <Label showColon>Client Secret</Label>
                            <Input type="Password" placeholder="••••••••" value={editForm.clientSecret} onInput={e => setEditForm(f => ({ ...f, clientSecret: e.target.value }))} style={{ width: '100%' }} />
                          </FlexBox>
                          
                          <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                            <Label showColon>Space</Label>
                            <FlexBox style={{ gap: '0.5rem', width: '100%' }}>
                              <Select 
                                disabled={fetchingSpaces}
                                onChange={e => setEditForm(f => ({ ...f, space: e.detail.selectedOption.value }))}
                                style={{ flexGrow: 1 }}
                              >
                                {Array.from(new Set([...fetchedSpaces, editForm.space])).filter(Boolean).map(sp => (
                                  <Option key={sp} value={sp} selected={sp === editForm.space}>{sp}</Option>
                                ))}
                                {fetchedSpaces.length === 0 && !editForm.space && (
                                  <Option value="" disabled selected>Please fetch spaces first</Option>
                                )}
                              </Select>
                              <Button 
                                onClick={() => handleLoadSpaces(true)}
                                disabled={fetchingSpaces}
                              >
                                {fetchingSpaces ? <BusyIndicator active size="S" /> : 'Fetch Spaces'}
                              </Button>
                            </FlexBox>
                          </FlexBox>

                          <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                            <Label showColon>Task chain: Flat authorization</Label>
                            <Input placeholder="e.g. TC_FLAT_AUTH" value={editForm.taskChainFlat} onInput={e => setEditForm(f => ({ ...f, taskChainFlat: e.target.value }))} style={{ width: '100%' }} />
                          </FlexBox>
                          <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                            <Label showColon>Task chain: Hierarchy authorization</Label>
                            <Input placeholder="e.g. TC_HIER_AUTH" value={editForm.taskChainHierarchy} onInput={e => setEditForm(f => ({ ...f, taskChainHierarchy: e.target.value }))} style={{ width: '100%' }} />
                          </FlexBox>
                        </>
                      )}

                      <CheckBox 
                        checked={editForm.isActive} 
                        onChange={e => setEditForm(f => ({ ...f, isActive: e.target.checked }))} 
                        text="Is Active Connection" 
                      />
                    </div>

                    <FlexBox style={{ gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                      <Button design="Transparent" onClick={() => setEditingId(null)}>Cancel</Button>
                      <Button design="Emphasized" icon="accept" onClick={() => handleUpdate(s.ID)} disabled={loading}>Save Changes</Button>
                    </FlexBox>
                  </FlexBox>
                ) : (
                  /* VIEW DETAILS MODE */
                  <FlexBox direction="Column" style={{ gap: '1rem', width: '100%' }}>
                    <FlexBox justifySelf="Spread" alignItems="Center" style={{ width: '100%', justifyContent: 'space-between' }}>
                      <FlexBox alignItems="Center" style={{ gap: '1rem' }}>
                        <Icon name="cloud" style={{ color: s.isActive ? '#3b82f6' : '#94a3b8' }} />
                        <FlexBox direction="Column">
                          <FlexBox alignItems="Center" style={{ gap: '0.5rem' }}>
                            <Title level="H5">{s.systemName}</Title>
                            <Tag design={currentType === 'SAP Hana' ? "Set2" : "Set1"}>{currentType}</Tag>
                          </FlexBox>
                          <Label>
                            {currentType === 'SAP Hana' ? `Host: ${s.host || '—'}:${s.port || 443}` : `Basis URL: ${s.url || '—'}`}
                          </Label>
                        </FlexBox>
                      </FlexBox>

                      <FlexBox style={{ gap: '0.5rem' }}>
                        <Button onClick={() => handleTestConnection(s.ID)} icon="connected">
                          Test Connection
                        </Button>
                        <Button design="Transparent" icon="edit" onClick={() => startEdit(s)} />
                        <Button design="Transparent" icon="delete" onClick={() => handleDelete(s.ID, s.systemName)} disabled={loading} style={{ color: 'var(--sapNegativeElementColor)' }} />
                      </FlexBox>
                    </FlexBox>

                    {currentType === 'SAP Hana' ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
                        <FlexBox direction="Column">
                          <Label>Hostname</Label>
                          <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>{s.host || '—'}</span>
                        </FlexBox>
                        <FlexBox direction="Column">
                          <Label>Port</Label>
                          <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>{s.port || '443'}</span>
                        </FlexBox>
                        <FlexBox direction="Column">
                          <Label>User</Label>
                          <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>{s.username || '—'}</span>
                        </FlexBox>
                        <FlexBox direction="Column">
                          <Label>State</Label>
                          <span style={{ fontWeight: 'bold', color: s.isActive ? '#10b981' : '#94a3b8' }}>
                            {s.isActive ? '● Active' : '○ Inactive'}
                          </span>
                        </FlexBox>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
                        <FlexBox direction="Column">
                          <Label>Token URL</Label>
                          <span style={{ fontWeight: 'bold', fontFamily: 'monospace', fontSize: '0.85rem' }}>{s.tokenUrl || '—'}</span>
                        </FlexBox>
                        <FlexBox direction="Column">
                          <Label>Client ID</Label>
                          <span style={{ fontWeight: 'bold', fontFamily: 'monospace', fontSize: '0.85rem' }}>{s.clientId || '—'}</span>
                        </FlexBox>
                        <FlexBox direction="Column">
                          <Label>Selected Space</Label>
                          <span style={{ fontWeight: 'bold', color: '#3b82f6' }}>{s.space || '—'}</span>
                        </FlexBox>
                        <FlexBox direction="Column">
                          <Label>State</Label>
                          <span style={{ fontWeight: 'bold', color: s.isActive ? '#10b981' : '#94a3b8' }}>
                            {s.isActive ? '● Active' : '○ Inactive'}
                          </span>
                        </FlexBox>
                        <FlexBox direction="Column">
                          <Label>Task chain: Flat authorization</Label>
                          <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>{s.taskChainFlat || '—'}</span>
                        </FlexBox>
                        <FlexBox direction="Column">
                          <Label>Task chain: Hierarchy authorization</Label>
                          <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>{s.taskChainHierarchy || '—'}</span>
                        </FlexBox>
                      </div>
                    )}
                  </FlexBox>
                )}
              </Card>
            );
          })
        )}
      </FlexBox>
    </FlexBox>
  );
}
