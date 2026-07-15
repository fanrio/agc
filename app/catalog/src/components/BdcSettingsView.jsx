import { useState, useEffect } from 'react';
import { Box, Button, TextField, Card, Typography, IconButton, CircularProgress, Alert, Collapse, Select, MenuItem, FormControl, InputLabel, Grid, Snackbar, Checkbox, FormControlLabel, Chip, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import { Plus, Trash2, Edit3, X, Check, Cloud, Link2, Wifi, Key } from 'lucide-react';
import * as api from '../api';

const ENV_LABEL = {
  P: 'Production',
  Q: 'Quality Assurance',
  D: 'Development'
};

const ENV_COLOR = {
  P: 'error',
  Q: 'warning',
  D: 'info'
};

export default function BdcSettingsView() {
  const [settings, setSettings] = useState([]);
  const [loading, setLoading]   = useState(true);
  
  // Confirm Dialog State
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: 'Confirm', message: '', onConfirm: null });
  const [showAdd, setShowAdd]   = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [environments, setEnvironments] = useState([]);
  
  // State for Toast Notifications
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'error' });

  const [fetchedSpaces, setFetchedSpaces] = useState([]);
  const [fetchingSpaces, setFetchingSpaces] = useState(false);

  // Form states
  const [form, setForm] = useState({
    systemName: '',
    connectionType: 'OData',
    environment_ID: 'D',
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
    environment_ID: 'D',
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

  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  async function load() {
    setLoading(true);
    try {
      const [data, envs] = await Promise.all([
        api.getBdcSettings(),
        api.getEnvironments()
      ]);
      setSettings(data);
      setEnvironments(envs);
    } catch (e) {
      setSnackbar({ open: true, message: `Failed to load settings: ${e.message}`, severity: 'error' });
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
        setSnackbar({ open: true, message: 'Please fill out Basis URL, Token URL, Client ID, and Client Secret first.', severity: 'warning' });
      }
      return;
    }
    setFetchingSpaces(true);
    try {
      const spaces = await api.fetchBdcSpaces(f.url, f.tokenUrl, f.clientId, f.clientSecret);
      setFetchedSpaces(spaces);
      if (!isAuto) {
        setSnackbar({ open: true, message: `Successfully loaded ${spaces.length} spaces.`, severity: 'success' });
      }
    } catch (e) {
      if (!isAuto) {
        setSnackbar({ open: true, message: `Failed to load spaces: ${e.message}`, severity: 'error' });
      }
    }
    setFetchingSpaces(false);
  }

  async function handleCreate() {
    const err = validate(form);
    if (err) {
      setSnackbar({ open: true, message: err, severity: 'error' });
      return;
    }

    setLoading(true);
    try {
      const payload = {
        systemName: form.systemName,
        connectionType: form.connectionType,
        environment_ID: form.environment_ID,
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
        environment_ID: 'D',
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
          setSnackbar({ open: true, message: `HANA connection saved and verified successfully: ${testRes.message}`, severity: 'success' });
        } else {
          setSnackbar({ open: true, message: `HANA connection saved, but verification failed: ${testRes ? testRes.message : 'Unknown error'}`, severity: 'warning' });
        }
      } else {
        setSnackbar({ open: true, message: 'BDC Connection setting created successfully!', severity: 'success' });
      }
    } catch (e) {
      setSnackbar({ open: true, message: e.message, severity: 'error' });
    }
    setLoading(false);
  }

  async function handleUpdate(id) {
    const err = validate(editForm);
    if (err) {
      setSnackbar({ open: true, message: err, severity: 'error' });
      return;
    }

    setLoading(true);
    try {
      const payload = {
        systemName: editForm.systemName,
        connectionType: editForm.connectionType,
        environment_ID: editForm.environment_ID,
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
          setSnackbar({ open: true, message: `HANA connection updated and verified successfully: ${testRes.message}`, severity: 'success' });
        } else {
          setSnackbar({ open: true, message: `HANA connection updated, but verification failed: ${testRes ? testRes.message : 'Unknown error'}`, severity: 'warning' });
        }
      } else {
        setSnackbar({ open: true, message: 'BDC Connection setting updated successfully!', severity: 'success' });
      }
    } catch (e) {
      setSnackbar({ open: true, message: e.message, severity: 'error' });
    }
    setLoading(false);
  }

  function handleDelete(id, name) {
    setConfirmDialog({
      open: true,
      title: 'Delete Connection',
      message: `Delete BDC System Connection "${name}"?`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        setLoading(true);
        try {
          await api.deleteBdcSetting(id);
          await load();
          setSnackbar({ open: true, message: 'Connection setting deleted.', severity: 'info' });
        } catch (e) {
          setSnackbar({ open: true, message: e.message, severity: 'error' });
        }
        setLoading(false);
      }
    });
  }

  async function handleTestConnection(id) {
    setSnackbar({ open: true, message: 'Testing connection...', severity: 'info' });
    try {
      const res = await api.testBdcConnection(id);
      if (res.success) {
        setSnackbar({ open: true, message: res.message, severity: 'success' });
      } else {
        setSnackbar({ open: true, message: res.message, severity: 'error' });
      }
    } catch (e) {
      setSnackbar({ open: true, message: `Connection test failed: ${e.message}`, severity: 'error' });
    }
  }

  function startEdit(s) {
    setEditingId(s.ID);
    setEditForm({
      systemName: s.systemName,
      connectionType: s.connectionType || 'OData',
      environment_ID: s.environment_ID || 'D',
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

  if (loading && settings.length === 0 && environments.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ animation: 'fadeIn 0.3s' }}>
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

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Business Data Cloud Connections</Typography>
          <Typography variant="body2" color="text.secondary">Configure BDC system connection parameters, credentials, and catalog space integrations</Typography>
        </Box>
        <Button variant="contained" onClick={() => { setShowAdd(s => !s); }} startIcon={<Plus size={15} />}>
          Add Connection
        </Button>
      </Box>

      {/* Add New Connection Form */}
      <Collapse in={showAdd}>
        <Card sx={{ p: 3, mb: 4, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>New System Connection</Typography>
          <Grid container spacing={2.5}>
            <Grid item xs={12} sm={4}>
              <TextField label="System Connection Name" size="small" fullWidth placeholder="e.g. Datasphere Production" value={form.systemName} onChange={e => setForm(f => ({ ...f, systemName: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl size="small" fullWidth>
                <InputLabel id="add-conn-type-label">Connection Type</InputLabel>
                <Select
                  labelId="add-conn-type-label"
                  label="Connection Type"
                  value={form.connectionType}
                  onChange={e => setForm(f => ({ ...f, connectionType: e.target.value }))}
                >
                  <MenuItem value="OData">OData (REST Catalog)</MenuItem>
                  <MenuItem value="SAP Hana">SAP Hana (Direct DB)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
             <Grid item xs={12} sm={4}>
               <FormControl size="small" fullWidth>
                 <InputLabel id="add-env-label">Environment</InputLabel>
                 <Select
                   labelId="add-env-label"
                   label="Environment"
                   value={form.environment_ID}
                   onChange={e => setForm(f => ({ ...f, environment_ID: e.target.value }))}
                 >
                   {environments.map(env => (
                     <MenuItem key={env.ID} value={env.ID}>{env.ID} - {env.name}</MenuItem>
                   ))}
                 </Select>
               </FormControl>
             </Grid>

            {form.connectionType === 'SAP Hana' ? (
              /* HANA FIELDS */
              <>
                <Grid item xs={12} sm={6}>
                  <TextField label="Hostname" size="small" fullWidth placeholder="e.g. host.company.com" value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Port" type="number" size="small" fullWidth value={form.port} onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || '' }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="User" size="small" fullWidth value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Password" type="password" size="small" fullWidth value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                </Grid>
              </>
            ) : (
              /* ODATA FIELDS */
              <>
                <Grid item xs={12} sm={6}>
                  <TextField label="Basis URL" size="small" fullWidth placeholder="https://port-xxxx.datasphere.cloud.sap" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Token URL" size="small" fullWidth placeholder="https://oauth.datasphere.cloud.sap/oauth/token" value={form.tokenUrl} onChange={e => setForm(f => ({ ...f, tokenUrl: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Client ID" size="small" fullWidth value={form.clientId} onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Client Secret" type="password" size="small" fullWidth value={form.clientSecret} onChange={e => setForm(f => ({ ...f, clientSecret: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={8}>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="add-space-label">Space</InputLabel>
                    <Select
                      labelId="add-space-label"
                      label="Space"
                      value={form.space}
                      onChange={e => setForm(f => ({ ...f, space: e.target.value }))}
                      disabled={fetchingSpaces}
                    >
                      {Array.from(new Set([...fetchedSpaces, form.space])).filter(Boolean).map(sp => (
                        <MenuItem key={sp} value={sp}>{sp}</MenuItem>
                      ))}
                      {fetchedSpaces.length === 0 && !form.space && (
                        <MenuItem value="" disabled>Please fetch spaces first</MenuItem>
                      )}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={4} sx={{ display: 'flex', alignItems: 'center' }}>
                  <Button
                    variant="outlined"
                    color="secondary"
                    size="small"
                    fullWidth
                    onClick={() => handleLoadSpaces(false)}
                    disabled={fetchingSpaces}
                    sx={{ height: 40 }}
                  >
                    {fetchingSpaces ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
                    Fetch Spaces
                  </Button>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Task chain: Flat authorization" size="small" fullWidth placeholder="e.g. TC_FLAT_AUTH" value={form.taskChainFlat} onChange={e => setForm(f => ({ ...f, taskChainFlat: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Task chain: Hierarchy authorization" size="small" fullWidth placeholder="e.g. TC_HIER_AUTH" value={form.taskChainHierarchy} onChange={e => setForm(f => ({ ...f, taskChainHierarchy: e.target.value }))} />
                </Grid>
              </>
            )}
          </Grid>

          <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end', mt: 1 }}>
            <Button variant="outlined" color="inherit" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button variant="contained" onClick={handleCreate} disabled={loading} startIcon={<Check size={14} />}>Save Connection</Button>
          </Box>
        </Card>
      </Collapse>

      {/* Connection Configurations List */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3.5 }}>
        {loading && settings.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress size={30} /></Box>
        ) : settings.length === 0 ? (
          <Box sx={{ py: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <Box sx={{ opacity: 0.5, mb: 2 }}><Cloud size={40} /></Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>No BDC integrations configured</Typography>
            <Typography variant="body2" color="text.secondary">Configure a BDC integration connection to fetch catalog spaces.</Typography>
          </Box>
        ) : (
          settings.map(s => {
            const isEditing = editingId === s.ID;
            const currentType = s.connectionType || 'OData';
            return (
              <Card key={s.ID} sx={{ p: 3, border: '1px solid', borderColor: s.isActive ? 'rgba(59, 130, 246, 0.15)' : 'divider' }}>
                {isEditing ? (
                  /* EDIT MODE FORM */
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Edit Connection: {s.systemName}</Typography>
                    <Grid container spacing={2.5}>
                      <Grid item xs={12} sm={4}>
                        <TextField label="System Connection Name" size="small" fullWidth value={editForm.systemName} onChange={e => setEditForm(f => ({ ...f, systemName: e.target.value }))} />
                      </Grid>
                      <Grid item xs={12} sm={4}>
                        <FormControl size="small" fullWidth>
                          <InputLabel id="edit-conn-type-label">Connection Type</InputLabel>
                          <Select
                            labelId="edit-conn-type-label"
                            label="Connection Type"
                            value={editForm.connectionType}
                            onChange={e => setEditForm(f => ({ ...f, connectionType: e.target.value }))}
                          >
                            <MenuItem value="OData">OData (REST Catalog)</MenuItem>
                            <MenuItem value="SAP Hana">SAP Hana (Direct DB)</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} sm={4}>
                        <FormControl size="small" fullWidth>
                          <InputLabel id="edit-env-label">Environment</InputLabel>
                          <Select
                            labelId="edit-env-label"
                            label="Environment"
                            value={editForm.environment_ID}
                            onChange={e => setEditForm(f => ({ ...f, environment_ID: e.target.value }))}
                          >
                            {environments.map(env => (
                              <MenuItem key={env.ID} value={env.ID}>{env.ID} - {env.name}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>

                      {editForm.connectionType === 'SAP Hana' ? (
                        /* HANA EDIT FIELDS */
                        <>
                          <Grid item xs={12} sm={6}>
                            <TextField label="Hostname" size="small" fullWidth placeholder="e.g. host.company.com" value={editForm.host} onChange={e => setEditForm(f => ({ ...f, host: e.target.value }))} />
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <TextField label="Port" type="number" size="small" fullWidth value={editForm.port} onChange={e => setEditForm(f => ({ ...f, port: parseInt(e.target.value) || '' }))} />
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <TextField label="User" size="small" fullWidth value={editForm.username} onChange={e => setEditForm(f => ({ ...f, username: e.target.value }))} />
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <TextField label="Password" type="password" size="small" fullWidth placeholder="••••••••" value={editForm.password} onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))} />
                          </Grid>
                        </>
                      ) : (
                        /* ODATA EDIT FIELDS */
                        <>
                          <Grid item xs={12} sm={6}>
                            <TextField label="Basis URL" size="small" fullWidth value={editForm.url} onChange={e => setEditForm(f => ({ ...f, url: e.target.value }))} />
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <TextField label="Token URL" size="small" fullWidth value={editForm.tokenUrl} onChange={e => setEditForm(f => ({ ...f, tokenUrl: e.target.value }))} />
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <TextField label="Client ID" size="small" fullWidth value={editForm.clientId} onChange={e => setEditForm(f => ({ ...f, clientId: e.target.value }))} />
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <TextField label="Client Secret" type="password" size="small" fullWidth placeholder="••••••••" value={editForm.clientSecret} onChange={e => setEditForm(f => ({ ...f, clientSecret: e.target.value }))} />
                          </Grid>
                          <Grid item xs={12} sm={8}>
                            <FormControl size="small" fullWidth>
                              <InputLabel id="edit-space-label">Space</InputLabel>
                              <Select
                                labelId="edit-space-label"
                                label="Space"
                                value={editForm.space}
                                onChange={e => setEditForm(f => ({ ...f, space: e.target.value }))}
                                disabled={fetchingSpaces}
                              >
                                {Array.from(new Set([...fetchedSpaces, editForm.space])).filter(Boolean).map(sp => (
                                  <MenuItem key={sp} value={sp}>{sp}</MenuItem>
                                ))}
                                {fetchedSpaces.length === 0 && !editForm.space && (
                                  <MenuItem value="" disabled>Please fetch spaces first</MenuItem>
                                )}
                              </Select>
                            </FormControl>
                          </Grid>
                          <Grid item xs={12} sm={4} sx={{ display: 'flex', alignItems: 'center' }}>
                            <Button
                              variant="outlined"
                              color="secondary"
                              size="small"
                              fullWidth
                              onClick={() => handleLoadSpaces(true)}
                              disabled={fetchingSpaces}
                              sx={{ height: 40 }}
                            >
                              {fetchingSpaces ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
                              Fetch Spaces
                            </Button>
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <TextField label="Task chain: Flat authorization" size="small" fullWidth placeholder="e.g. TC_FLAT_AUTH" value={editForm.taskChainFlat} onChange={e => setEditForm(f => ({ ...f, taskChainFlat: e.target.value }))} />
                          </Grid>
                          <Grid item xs={12} sm={6}>
                            <TextField label="Task chain: Hierarchy authorization" size="small" fullWidth placeholder="e.g. TC_HIER_AUTH" value={editForm.taskChainHierarchy} onChange={e => setEditForm(f => ({ ...f, taskChainHierarchy: e.target.value }))} />
                          </Grid>
                        </>
                      )}

                      <Grid item xs={12}>
                        <FormControlLabel
                          control={<Checkbox checked={editForm.isActive} onChange={e => setEditForm(f => ({ ...f, isActive: e.target.checked }))} />}
                          label="Is Active Connection"
                        />
                      </Grid>
                    </Grid>

                    <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end', mt: 1 }}>
                      <Button variant="outlined" color="inherit" onClick={() => setEditingId(null)}>Cancel</Button>
                      <Button variant="contained" onClick={() => handleUpdate(s.ID)} disabled={loading} startIcon={<Check size={14} />}>Save Changes</Button>
                    </Box>
                  </Box>
                ) : (
                  /* VIEW DETAILS MODE */
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                      <Cloud size={20} color={s.isActive ? "#3b82f6" : "text.secondary"} />
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                          {s.systemName}
                          <Chip label={currentType} size="small" color={currentType === 'SAP Hana' ? "secondary" : "primary"} sx={{ height: 20, fontSize: 10 }} />
                          {s.environment_ID && (
                            <Chip
                              label={(() => {
                                const found = environments.find(e => e.ID === s.environment_ID);
                                return found ? found.name : s.environment_ID;
                              })()}
                              size="small"
                              color={ENV_COLOR[s.environment_ID] || "default"}
                              sx={{ height: 20, fontSize: 10 }}
                            />
                          )}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {currentType === 'SAP Hana' ? (
                            <>Host: <Box component="span" sx={{ color: 'text.primary' }}>{s.host || '—'}:{s.port || 443}</Box></>
                          ) : (
                            <>Basis URL: <Box component="span" sx={{ color: 'text.primary' }}>{s.url || '—'}</Box></>
                          )}
                        </Typography>
                      </Box>

                      <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
                        <Button variant="outlined" color="primary" size="small" onClick={() => handleTestConnection(s.ID)} startIcon={<Wifi size={13} />}>
                          Test Connection
                        </Button>
                        <IconButton onClick={() => startEdit(s)} size="small" color="inherit">
                          <Edit3 size={15} />
                        </IconButton>
                        <IconButton color="error" onClick={() => handleDelete(s.ID, s.systemName)} disabled={loading} size="small">
                          <Trash2 size={15} />
                        </IconButton>
                      </Box>
                    </Box>

                    {currentType === 'SAP Hana' ? (
                      /* HANA VIEW DETAILS GRID */
                      <Grid container spacing={2} sx={{ mt: 1, borderTop: '1px solid rgba(255,255,255,0.05)', pt: 2 }}>
                        <Grid item xs={12} sm={5}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Hostname</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {s.host || '—'}
                          </Typography>
                        </Grid>
                        <Grid item xs={12} sm={2}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Port</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {s.port || '443'}
                          </Typography>
                        </Grid>
                        <Grid item xs={12} sm={3}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>User</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {s.username || '—'}
                          </Typography>
                        </Grid>
                        <Grid item xs={12} sm={2}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>State</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: s.isActive ? '#10b981' : 'text.secondary' }}>
                            {s.isActive ? '● Active' : '○ Inactive'}
                          </Typography>
                        </Grid>
                      </Grid>
                    ) : (
                      /* ODATA VIEW DETAILS GRID */
                      <Grid container spacing={2} sx={{ mt: 1, borderTop: '1px solid rgba(255,255,255,0.05)', pt: 2 }}>
                        <Grid item xs={12} sm={3}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Token URL</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {s.tokenUrl || '—'}
                          </Typography>
                        </Grid>
                        <Grid item xs={12} sm={3}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Client ID</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {s.clientId || '—'}
                          </Typography>
                        </Grid>
                        <Grid item xs={12} sm={2}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Selected Space</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: '#3b82f6' }}>
                            {s.space || '—'}
                          </Typography>
                        </Grid>
                        <Grid item xs={12} sm={2}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>State</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: s.isActive ? '#10b981' : 'text.secondary' }}>
                            {s.isActive ? '● Active' : '○ Inactive'}
                          </Typography>
                        </Grid>
                        <Grid item xs={12} sm={6} sx={{ mt: 1 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Task chain: Flat authorization</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {s.taskChainFlat || '—'}
                          </Typography>
                        </Grid>
                        <Grid item xs={12} sm={6} sx={{ mt: 1 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Task chain: Hierarchy authorization</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {s.taskChainHierarchy || '—'}
                          </Typography>
                        </Grid>
                      </Grid>
                    )}
                  </Box>
                )}
              </Card>
            );
          })
        )}
      </Box>

      {/* Confirm Dialog */}
      <Dialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog(prev => ({ ...prev, open: false }))}
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
      >
        <DialogTitle id="confirm-dialog-title">
          {confirmDialog.title}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="confirm-dialog-description">
            {confirmDialog.message}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(prev => ({ ...prev, open: false }))} color="inherit">
            Cancel
          </Button>
          <Button onClick={confirmDialog.onConfirm} color="primary" variant="contained" autoFocus>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
