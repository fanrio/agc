import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  TextField,
  Card,
  Typography,
  IconButton,
  CircularProgress,
  Alert,
  Collapse,
  Grid,
  Snackbar,
  FormControlLabel,
  Switch,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Tooltip
} from '@mui/material';
import {
  Plus,
  Trash2,
  Edit3,
  X,
  Check,
  Server,
  Wifi,
  ExternalLink,
  Key,
  ShieldCheck
} from 'lucide-react';
import * as api from '../api';
import EnvironmentSelection from './EnvironmentSelection';
import SearchableSelect from './SearchableSelect';

const ENV_COLOR: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  P: 'error',
  Q: 'warning',
  D: 'info'
};

interface DatabricksSetting {
  ID: string;
  systemName: string;
  environment_ID: string;
  workspaceUrl: string;
  authType: 'TOKEN' | 'SERVICE_PRINCIPAL';
  apiToken?: string;
  clientId?: string;
  clientSecret?: string;
  targetCatalog: string;
  targetSchema: string;
  sqlWarehouseId: string;
  isActive: boolean;
  environment?: { ID: string; name: string };
  createdAt?: string;
  modifiedAt?: string;
}

const AUTH_TYPE_OPTIONS = [
  { value: 'TOKEN', label: 'Personal Access Token (PAT)' },
  { value: 'SERVICE_PRINCIPAL', label: 'OAuth M2M / Service Principal' }
];

export default function DatabricksSettingsView() {
  const [settings, setSettings] = useState<DatabricksSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [environments, setEnvironments] = useState<any[]>([]);

  // Dialog & Form Toggle State
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: (() => void) | null;
  }>({ open: false, title: 'Confirm', message: '', onConfirm: null });

  // Testing connection state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testStatusMap, setTestStatusMap] = useState<
    Record<string, { success: boolean; message: string; httpStatus?: number }>
  >({});

  // Toast Notifications
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'info' | 'warning' | 'error';
  }>({ open: false, message: '', severity: 'info' });

  // New setting form
  const [form, setForm] = useState({
    systemName: '',
    environment_ID: 'D',
    workspaceUrl: '',
    authType: 'TOKEN' as 'TOKEN' | 'SERVICE_PRINCIPAL',
    apiToken: '',
    clientId: '',
    clientSecret: '',
    targetCatalog: 'main',
    targetSchema: 'default',
    sqlWarehouseId: '',
    isActive: true
  });

  // Edit setting form
  const [editForm, setEditForm] = useState({
    systemName: '',
    environment_ID: 'D',
    workspaceUrl: '',
    authType: 'TOKEN' as 'TOKEN' | 'SERVICE_PRINCIPAL',
    apiToken: '',
    clientId: '',
    clientSecret: '',
    targetCatalog: 'main',
    targetSchema: 'default',
    sqlWarehouseId: '',
    isActive: true
  });

  const handleCloseSnackbar = (_event?: any, reason?: string) => {
    if (reason === 'clickaway') return;
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  async function load() {
    setLoading(true);
    try {
      const [data, envs] = await Promise.all([
        api.getDatabricksSettings(),
        api.getEnvironments()
      ]);
      setSettings(Array.isArray(data) ? data : []);
      setEnvironments(Array.isArray(envs) ? envs : []);
    } catch (e: any) {
      setSnackbar({ open: true, message: `Failed to load Databricks settings: ${e.message}`, severity: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function validate(f: typeof form, isEdit = false): string {
    if (!f.systemName || !f.systemName.trim()) return 'System Connection Name is required.';
    if (!f.workspaceUrl || !f.workspaceUrl.trim()) return 'Databricks Workspace URL is required.';
    if (!f.workspaceUrl.startsWith('http://') && !f.workspaceUrl.startsWith('https://')) {
      return 'Databricks Workspace URL must start with http:// or https://';
    }
    const auth = (f.authType || 'TOKEN').toUpperCase();
    if (auth === 'TOKEN') {
      if (!isEdit && (!f.apiToken || !f.apiToken.trim())) {
        return 'Personal Access Token is required for TOKEN authentication.';
      }
    } else if (auth === 'SERVICE_PRINCIPAL') {
      if (!f.clientId || !f.clientId.trim()) {
        return 'Client ID is required for SERVICE_PRINCIPAL authentication.';
      }
      if (!isEdit && (!f.clientSecret || !f.clientSecret.trim())) {
        return 'Client Secret is required for SERVICE_PRINCIPAL authentication.';
      }
    }
    return '';
  }

  async function handleCreate() {
    const err = validate(form, false);
    if (err) {
      setSnackbar({ open: true, message: err, severity: 'error' });
      return;
    }

    setLoading(true);
    try {
      const payload: api.DatabricksSettingPayload = {
        systemName: form.systemName.trim(),
        environment_ID: form.environment_ID,
        workspaceUrl: form.workspaceUrl.trim(),
        authType: form.authType,
        targetCatalog: form.targetCatalog ? form.targetCatalog.trim() : 'main',
        targetSchema: form.targetSchema ? form.targetSchema.trim() : 'default',
        sqlWarehouseId: form.sqlWarehouseId ? form.sqlWarehouseId.trim() : '',
        isActive: form.isActive
      };

      if (form.authType === 'TOKEN') {
        payload.apiToken = form.apiToken.trim();
      } else {
        payload.clientId = form.clientId.trim();
        payload.clientSecret = form.clientSecret.trim();
      }

      await api.createDatabricksSetting(payload);
      setShowAdd(false);
      setForm({
        systemName: '',
        environment_ID: 'D',
        workspaceUrl: '',
        authType: 'TOKEN',
        apiToken: '',
        clientId: '',
        clientSecret: '',
        targetCatalog: 'main',
        targetSchema: 'default',
        sqlWarehouseId: '',
        isActive: true
      });
      await load();
      setSnackbar({ open: true, message: 'Databricks workspace connection created successfully.', severity: 'success' });
    } catch (e: any) {
      setSnackbar({ open: true, message: `Failed to create setting: ${e.message}`, severity: 'error' });
    } finally {
      setLoading(false);
    }
  }

  function startEdit(s: DatabricksSetting) {
    setEditingId(s.ID);
    setEditForm({
      systemName: s.systemName || '',
      environment_ID: s.environment_ID || 'D',
      workspaceUrl: s.workspaceUrl || '',
      authType: s.authType || 'TOKEN',
      apiToken: '', // Keep blank on read; user enters new token only if updating
      clientId: s.clientId || '',
      clientSecret: '', // Keep blank on read; user enters new secret only if updating
      targetCatalog: s.targetCatalog || 'main',
      targetSchema: s.targetSchema || 'default',
      sqlWarehouseId: s.sqlWarehouseId || '',
      isActive: s.isActive !== false
    });
  }

  async function handleUpdate(id: string) {
    const err = validate(editForm, true);
    if (err) {
      setSnackbar({ open: true, message: err, severity: 'error' });
      return;
    }

    setLoading(true);
    try {
      const payload: Partial<api.DatabricksSettingPayload> = {
        systemName: editForm.systemName.trim(),
        environment_ID: editForm.environment_ID,
        workspaceUrl: editForm.workspaceUrl.trim(),
        authType: editForm.authType,
        targetCatalog: editForm.targetCatalog ? editForm.targetCatalog.trim() : 'main',
        targetSchema: editForm.targetSchema ? editForm.targetSchema.trim() : 'default',
        sqlWarehouseId: editForm.sqlWarehouseId ? editForm.sqlWarehouseId.trim() : '',
        isActive: editForm.isActive
      };

      // Non-destructive credential update: only send credential fields if user provided non-empty values
      if (editForm.authType === 'TOKEN') {
        if (editForm.apiToken && editForm.apiToken.trim()) {
          payload.apiToken = editForm.apiToken.trim();
        }
      } else if (editForm.authType === 'SERVICE_PRINCIPAL') {
        if (editForm.clientId && editForm.clientId.trim()) {
          payload.clientId = editForm.clientId.trim();
        }
        if (editForm.clientSecret && editForm.clientSecret.trim()) {
          payload.clientSecret = editForm.clientSecret.trim();
        }
      }

      await api.updateDatabricksSetting(id, payload);
      setEditingId(null);
      await load();
      setSnackbar({ open: true, message: 'Databricks workspace connection updated successfully.', severity: 'success' });
    } catch (e: any) {
      setSnackbar({ open: true, message: `Update failed: ${e.message}`, severity: 'error' });
    } finally {
      setLoading(false);
    }
  }

  function confirmDelete(id: string, name: string) {
    setConfirmDialog({
      open: true,
      title: 'Delete Databricks Connection',
      message: `Are you sure you want to permanently delete connection "${name}"? Real-time synchronizations to this workspace will cease.`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        setLoading(true);
        try {
          await api.deleteDatabricksSetting(id);
          await load();
          setSnackbar({ open: true, message: 'Databricks connection deleted successfully.', severity: 'success' });
        } catch (e: any) {
          setSnackbar({ open: true, message: `Deletion failed: ${e.message}`, severity: 'error' });
        } finally {
          setLoading(false);
        }
      }
    });
  }

  async function handleTestConnection(id: string) {
    setTestingId(id);
    setSnackbar({ open: true, message: 'Testing Databricks connection...', severity: 'info' });
    try {
      const res = await api.testDatabricksConnection(id);
      setTestStatusMap(prev => ({
        ...prev,
        [id]: {
          success: Boolean(res.success),
          message: res.message || (res.success ? 'Connection verified successfully' : 'Connection verification failed'),
          httpStatus: res.httpStatus
        }
      }));

      if (res.success) {
        setSnackbar({
          open: true,
          message: `Databricks connection verified: ${res.message} (HTTP ${res.httpStatus || 200})`,
          severity: 'success'
        });
      } else {
        setSnackbar({
          open: true,
          message: `Databricks connection test failed: ${res.message} [HTTP ${res.httpStatus || 400}]`,
          severity: 'error'
        });
      }
    } catch (e: any) {
      setTestStatusMap(prev => ({
        ...prev,
        [id]: {
          success: false,
          message: e.message || 'Connection test failed with unexpected error',
          httpStatus: 502
        }
      }));
      setSnackbar({
        open: true,
        message: `Connection test error: ${e.message}`,
        severity: 'error'
      });
    } finally {
      setTestingId(null);
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
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Databricks Workspace Settings</Typography>
          <Typography variant="body2" color="text.secondary">
            Configure Databricks Unity Catalog workspaces, authentication credentials, and SQL Warehouse connections for real-time policy synchronization
          </Typography>
        </Box>
        <Button
          variant="contained"
          onClick={() => setShowAdd(s => !s)}
          startIcon={showAdd ? <X size={15} /> : <Plus size={15} />}
        >
          {showAdd ? 'Close' : 'Add Workspace'}
        </Button>
      </Box>

      {/* Add New Workspace Form */}
      <Collapse in={showAdd}>
        <Card sx={{ p: 3, mb: 4, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>New Databricks System Connection</Typography>
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="System Connection Name"
                size="small"
                fullWidth
                placeholder="e.g. Databricks Unity Production"
                value={form.systemName}
                onChange={e => setForm(f => ({ ...f, systemName: e.target.value }))}
                required
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <SearchableSelect
                options={AUTH_TYPE_OPTIONS}
                value={form.authType}
                onChange={val => setForm(f => ({ ...f, authType: val as 'TOKEN' | 'SERVICE_PRINCIPAL' }))}
                label="Authentication Type"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <EnvironmentSelection
                value={form.environment_ID}
                onChange={val => setForm(f => ({ ...f, environment_ID: val }))}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <TextField
                label="Databricks Workspace URL"
                size="small"
                fullWidth
                placeholder="https://adb-123456789.1.azuredatabricks.net or https://dbc-xxxx.cloud.databricks.com"
                value={form.workspaceUrl}
                onChange={e => setForm(f => ({ ...f, workspaceUrl: e.target.value }))}
                required
              />
            </Grid>

            {form.authType === 'TOKEN' ? (
              <Grid size={{ xs: 12 }}>
                <TextField
                  label="API Bearer Token (Personal Access Token)"
                  type="password"
                  size="small"
                  fullWidth
                  placeholder="dapi..."
                  value={form.apiToken}
                  onChange={e => setForm(f => ({ ...f, apiToken: e.target.value }))}
                  required
                />
              </Grid>
            ) : (
              <>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="OAuth Client ID (Application ID)"
                    size="small"
                    fullWidth
                    placeholder="e.g. 00000000-0000-0000-0000-000000000000"
                    value={form.clientId}
                    onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
                    required
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="OAuth Client Secret"
                    type="password"
                    size="small"
                    fullWidth
                    placeholder="Enter service principal secret"
                    value={form.clientSecret}
                    onChange={e => setForm(f => ({ ...f, clientSecret: e.target.value }))}
                    required
                  />
                </Grid>
              </>
            )}

            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Target Catalog"
                size="small"
                fullWidth
                placeholder="main"
                value={form.targetCatalog}
                onChange={e => setForm(f => ({ ...f, targetCatalog: e.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Target Schema"
                size="small"
                fullWidth
                placeholder="default"
                value={form.targetSchema}
                onChange={e => setForm(f => ({ ...f, targetSchema: e.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="SQL Warehouse ID"
                size="small"
                fullWidth
                placeholder="e.g. a1b2c3d4e5f6g7h8"
                value={form.sqlWarehouseId}
                onChange={e => setForm(f => ({ ...f, sqlWarehouseId: e.target.value }))}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.isActive}
                    onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                    color="primary"
                  />
                }
                label="Enable active synchronization for this Databricks workspace"
              />
            </Grid>
          </Grid>

          <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end', mt: 1 }}>
            <Button variant="outlined" color="inherit" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button variant="contained" onClick={handleCreate} disabled={loading} startIcon={<Check size={14} />}>
              Save Connection
            </Button>
          </Box>
        </Card>
      </Collapse>

      {/* Connection List */}
      {settings.length === 0 ? (
        <Card sx={{ p: 6, textAlign: 'center', bgcolor: 'background.paper', borderRadius: 2 }}>
          <Server size={44} style={{ opacity: 0.3, marginBottom: 16 }} />
          <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 600, mb: 1 }}>
            No Databricks Connections Configured
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480, mx: 'auto', mb: 3 }}>
            Connect your Databricks Unity Catalog workspace to enable automatic synchronization of authorization roles, row-level filters, and table grants.
          </Typography>
          <Button variant="contained" onClick={() => setShowAdd(true)} startIcon={<Plus size={15} />}>
            Add Databricks Workspace
          </Button>
        </Card>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {settings.map(s => {
            const isEditing = editingId === s.ID;
            const isTesting = testingId === s.ID;
            const testResult = testStatusMap[s.ID];

            if (isEditing) {
              return (
                <Card key={s.ID} sx={{ p: 3, border: '1px solid', borderColor: 'primary.main', display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'primary.main' }}>
                    Edit Connection: {s.systemName}
                  </Typography>
                  <Grid container spacing={2.5}>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        label="System Connection Name"
                        size="small"
                        fullWidth
                        value={editForm.systemName}
                        onChange={e => setEditForm(f => ({ ...f, systemName: e.target.value }))}
                        required
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <SearchableSelect
                        options={AUTH_TYPE_OPTIONS}
                        value={editForm.authType}
                        onChange={val => setEditForm(f => ({ ...f, authType: val as 'TOKEN' | 'SERVICE_PRINCIPAL' }))}
                        label="Authentication Type"
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <EnvironmentSelection
                        value={editForm.environment_ID}
                        onChange={val => setEditForm(f => ({ ...f, environment_ID: val }))}
                      />
                    </Grid>

                    <Grid size={{ xs: 12 }}>
                      <TextField
                        label="Databricks Workspace URL"
                        size="small"
                        fullWidth
                        value={editForm.workspaceUrl}
                        onChange={e => setEditForm(f => ({ ...f, workspaceUrl: e.target.value }))}
                        required
                      />
                    </Grid>

                    {editForm.authType === 'TOKEN' ? (
                      <Grid size={{ xs: 12 }}>
                        <TextField
                          label="API Bearer Token"
                          type="password"
                          size="small"
                          fullWidth
                          placeholder="Leave blank to keep existing stored token"
                          value={editForm.apiToken}
                          onChange={e => setEditForm(f => ({ ...f, apiToken: e.target.value }))}
                          helperText="Masked on read. Enter a new token only if you wish to change the credential."
                        />
                      </Grid>
                    ) : (
                      <>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField
                            label="OAuth Client ID"
                            size="small"
                            fullWidth
                            value={editForm.clientId}
                            onChange={e => setEditForm(f => ({ ...f, clientId: e.target.value }))}
                            required
                          />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField
                            label="OAuth Client Secret"
                            type="password"
                            size="small"
                            fullWidth
                            placeholder="Leave blank to keep existing secret"
                            value={editForm.clientSecret}
                            onChange={e => setEditForm(f => ({ ...f, clientSecret: e.target.value }))}
                            helperText="Masked on read. Enter a new secret only if you wish to change it."
                          />
                        </Grid>
                      </>
                    )}

                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        label="Target Catalog"
                        size="small"
                        fullWidth
                        value={editForm.targetCatalog}
                        onChange={e => setEditForm(f => ({ ...f, targetCatalog: e.target.value }))}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        label="Target Schema"
                        size="small"
                        fullWidth
                        value={editForm.targetSchema}
                        onChange={e => setEditForm(f => ({ ...f, targetSchema: e.target.value }))}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        label="SQL Warehouse ID"
                        size="small"
                        fullWidth
                        value={editForm.sqlWarehouseId}
                        onChange={e => setEditForm(f => ({ ...f, sqlWarehouseId: e.target.value }))}
                      />
                    </Grid>

                    <Grid size={{ xs: 12 }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={editForm.isActive}
                            onChange={e => setEditForm(f => ({ ...f, isActive: e.target.checked }))}
                            color="primary"
                          />
                        }
                        label="Active synchronization enabled"
                      />
                    </Grid>
                  </Grid>

                  <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end', mt: 1 }}>
                    <Button variant="outlined" color="inherit" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                    <Button variant="contained" onClick={() => handleUpdate(s.ID)} disabled={loading} startIcon={<Check size={14} />}>
                      Save Changes
                    </Button>
                  </Box>
                </Card>
              );
            }

            return (
              <Card key={s.ID} sx={{ p: 2.5, position: 'relative' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5 }}>
                  {/* Left info */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: 1.5,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: s.isActive ? 'warning.lighter' : 'action.hover',
                        color: s.isActive ? 'warning.main' : 'text.disabled'
                      }}
                    >
                      <Server size={22} />
                    </Box>
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                          {s.systemName}
                        </Typography>
                        <Chip
                          size="small"
                          label={s.authType === 'SERVICE_PRINCIPAL' ? 'Service Principal' : 'Personal Token'}
                          variant="outlined"
                          sx={{ fontSize: '0.75rem', fontWeight: 600 }}
                        />
                        <Chip
                          size="small"
                          label={s.environment?.name || s.environment_ID}
                          color={ENV_COLOR[s.environment_ID] || 'default'}
                          sx={{ fontSize: '0.75rem', fontWeight: 600 }}
                        />
                        <Chip
                          size="small"
                          label={s.isActive ? 'Active' : 'Inactive'}
                          color={s.isActive ? 'success' : 'default'}
                          variant="outlined"
                          sx={{ fontSize: '0.75rem' }}
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                        <ExternalLink size={12} />
                        {s.workspaceUrl}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Action buttons */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Button
                      variant="outlined"
                      color="primary"
                      size="small"
                      onClick={() => handleTestConnection(s.ID)}
                      disabled={isTesting || loading}
                      startIcon={isTesting ? <CircularProgress size={13} color="inherit" /> : <Wifi size={13} />}
                      sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                      {isTesting ? 'Testing...' : 'Test Connection'}
                    </Button>
                    <Tooltip title="Edit Connection">
                      <IconButton size="small" onClick={() => startEdit(s)} color="default">
                        <Edit3 size={16} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete Connection">
                      <IconButton size="small" onClick={() => confirmDelete(s.ID, s.systemName)} color="error">
                        <Trash2 size={16} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                {/* Test Result Alert */}
                {testResult && (
                  <Alert
                    severity={testResult.success ? 'success' : 'error'}
                    onClose={() => setTestStatusMap(prev => {
                      const next = { ...prev };
                      delete next[s.ID];
                      return next;
                    })}
                    sx={{ mt: 2, py: 0.5, fontSize: '0.8125rem' }}
                  >
                    {testResult.message} {testResult.httpStatus ? `[HTTP ${testResult.httpStatus}]` : ''}
                  </Alert>
                )}

                {/* Details Grid */}
                <Grid container spacing={2} sx={{ mt: 1, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Target Catalog & Schema
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {s.targetCatalog || 'main'} . {s.targetSchema || 'default'}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      SQL Warehouse ID
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {s.sqlWarehouseId || '— (Serverless/Default)'}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Authentication Status
                    </Typography>
                    <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {s.authType === 'SERVICE_PRINCIPAL' ? (
                        <>
                          <ShieldCheck size={14} />
                          Client: {s.clientId ? `${s.clientId.substring(0, 8)}...` : 'Configured'}
                        </>
                      ) : (
                        <>
                          <Key size={14} />
                          Personal Access Token (Configured)
                        </>
                      )}
                    </Typography>
                  </Grid>
                </Grid>
              </Card>
            );
          })}
        </Box>
      )}

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog(prev => ({ ...prev, open: false }))}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>{confirmDialog.title}</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirmDialog.message}</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmDialog(prev => ({ ...prev, open: false }))} color="inherit">
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (confirmDialog.onConfirm) confirmDialog.onConfirm();
            }}
            color="error"
            variant="contained"
            autoFocus
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
