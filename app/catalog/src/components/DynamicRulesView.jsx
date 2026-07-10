import { useState, useEffect } from 'react';
import { 
  Box, Button, Card, Table, TableBody, TableCell, TableContainer, 
  TableHead, TableRow, Typography, Dialog, DialogTitle, DialogContent, 
  DialogActions, TextField, Checkbox, FormControlLabel, Select, MenuItem, 
  InputLabel, FormControl, Autocomplete, IconButton, Snackbar, Alert, 
  CircularProgress
} from '@mui/material';
import { Play, Edit, Trash2, Plus, RefreshCw } from 'lucide-react';
import * as api from '../api';

export default function DynamicRulesView() {
  const [rules, setRules] = useState([]);
  const [roles, setRoles] = useState([]);
  const [fields, setFields] = useState([]);
  const [connections, setConnections] = useState([]);
  const [assets, setAssets] = useState([]);
  const [assetColumns, setAssetColumns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [syncingRuleId, setSyncingRuleId] = useState(null);
  
  // Dialog state
  const [open, setOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [form, setForm] = useState({
    code: '',
    description: '',
    isActive: true,
    sourceType: 'ODATA_SERVICE',
    sourceEntity: '',
    sourceResponsibleField: '',
    sourceFilterCondition: '',
    generationMode: 'USER_CONSOLIDATED_ROLE',
    templateRole_ID: '',
    bdcConnection_ID: '',
    mappings: []
  });

  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const loadData = async () => {
    setLoading(true);
    try {
      const [rData, rolesData, fieldsData, connData] = await Promise.all([
        api.getDynamicRules(),
        api.getRoles(),
        api.getRestrictionFields(),
        api.getBdcSettings()
      ]);
      setRules(rData || []);
      setRoles(rolesData || []);
      setFields(fieldsData || []);
      setConnections(connData || []);
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Fetch BDC Assets whenever connection selection changes in the form
  useEffect(() => {
    if (!form.bdcConnection_ID) {
      setAssets([]);
      return;
    }
    const conn = connections.find(c => c.ID === form.bdcConnection_ID);
    if (conn) {
      setLoadingAssets(true);
      api.fetchBdcAssets(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space)
        .then(assetsList => {
          setAssets(assetsList || []);
        })
        .catch(err => {
          console.error('Failed to load BDC Assets:', err);
          setAssets([]);
          setSnackbar({ open: true, message: `Failed to load BDC Assets: ${err.message}`, severity: 'error' });
        })
        .finally(() => {
          setLoadingAssets(false);
        });
    }
  }, [form.bdcConnection_ID, connections]);

  // Fetch Key Columns & All Columns when the BDC Asset selection changes
  const handleAssetChange = async (selectedAsset) => {
    setForm(p => ({ ...p, sourceEntity: selectedAsset, sourceResponsibleField: '', mappings: [] }));
    setAssetColumns([]);
    if (!selectedAsset) return;

    const conn = connections.find(c => c.ID === form.bdcConnection_ID);
    if (!conn) return;

    // 1. Fetch Key Columns
    setLoadingKeys(true);
    try {
      const keys = await api.fetchBdcAssetKeyColumns(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space, selectedAsset);
      if (keys && keys.length > 0) {
        setForm(p => ({
          ...p,
          mappings: keys.map(k => ({ sourceKeyField: k, targetRestrictionField: '' }))
        }));
      } else {
        setSnackbar({ open: true, message: 'No key columns found in metadata for selected asset.', severity: 'warning' });
      }
    } catch (err) {
      console.error('Failed to fetch asset key columns:', err);
      setSnackbar({ open: true, message: `Failed to fetch asset key columns: ${err.message}`, severity: 'error' });
    }
    setLoadingKeys(false);

    // 2. Fetch All Columns for Responsible User selector
    setLoadingColumns(true);
    try {
      const cols = await api.fetchBdcAssetColumns(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space, selectedAsset);
      setAssetColumns(cols || []);
    } catch (err) {
      console.error('Failed to fetch asset columns:', err);
      setSnackbar({ open: true, message: `Failed to fetch asset columns: ${err.message}`, severity: 'error' });
    }
    setLoadingColumns(false);
  };

  const handleOpenCreate = () => {
    setEditingRule(null);
    setForm({
      code: '',
      description: '',
      isActive: true,
      sourceType: 'ODATA_SERVICE',
      sourceEntity: '',
      sourceResponsibleField: '',
      sourceFilterCondition: '',
      generationMode: 'USER_CONSOLIDATED_ROLE',
      templateRole_ID: '',
      bdcConnection_ID: connections[0]?.ID || '',
      mappings: []
    });
    setAssetColumns([]);
    setOpen(true);
  };

  // On Edit, populate available columns if we have an active connection and asset selected
  const handleOpenEdit = async (rule) => {
    setEditingRule(rule);
    setForm({
      code: rule.code,
      description: rule.description || '',
      isActive: rule.isActive,
      sourceType: rule.sourceType,
      sourceEntity: rule.sourceEntity,
      sourceResponsibleField: rule.sourceResponsibleField,
      sourceFilterCondition: rule.sourceFilterCondition || '',
      generationMode: rule.generationMode,
      templateRole_ID: rule.templateRole_ID || '',
      bdcConnection_ID: rule.bdcConnection_ID || '',
      mappings: (rule.mappings || []).map(m => ({
        sourceKeyField: m.sourceKeyField,
        targetRestrictionField: m.targetRestrictionField
      }))
    });
    setAssetColumns([]);

    const conn = connections.find(c => c.ID === rule.bdcConnection_ID);
    if (conn && rule.sourceEntity) {
      setLoadingColumns(true);
      try {
        const cols = await api.fetchBdcAssetColumns(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space, rule.sourceEntity);
        setAssetColumns(cols || []);
      } catch (err) {
        console.error('Failed to fetch asset columns for editing rule:', err);
      }
      setLoadingColumns(false);
    }
    setOpen(true);
  };

  const handleClose = () => setOpen(false);

  const handleMappingChange = (index, value) => {
    setForm(p => {
      const newMappings = [...p.mappings];
      newMappings[index] = { ...newMappings[index], targetRestrictionField: value };
      return { ...p, mappings: newMappings };
    });
  };

  const handleSave = async () => {
    if (!form.code.trim()) {
      setSnackbar({ open: true, message: 'Rule Code is required', severity: 'error' });
      return;
    }
    if (!form.bdcConnection_ID) {
      setSnackbar({ open: true, message: 'BDC Connection is required', severity: 'error' });
      return;
    }
    if (!form.sourceEntity) {
      setSnackbar({ open: true, message: 'Source BDC Asset is required', severity: 'error' });
      return;
    }
    if (!form.sourceResponsibleField) {
      setSnackbar({ open: true, message: 'User (Responsible) Field is required', severity: 'error' });
      return;
    }
    if (form.mappings.length === 0 || form.mappings.some(m => !m.sourceKeyField.trim() || !m.targetRestrictionField.trim())) {
      setSnackbar({ open: true, message: 'All auto-generated field mappings must be fully configured', severity: 'error' });
      return;
    }

    try {
      if (editingRule) {
        await api.updateDynamicRule(editingRule.ID, form);
        setSnackbar({ open: true, message: 'Rule updated successfully', severity: 'success' });
      } else {
        await api.createDynamicRule(form);
        setSnackbar({ open: true, message: 'Rule created successfully', severity: 'success' });
      }
      handleClose();
      loadData();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this rule?')) return;
    try {
      await api.deleteDynamicRule(id);
      setSnackbar({ open: true, message: 'Rule deleted successfully', severity: 'success' });
      loadData();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  const handleSyncRule = async (id) => {
    setSyncingRuleId(id);
    try {
      const res = await api.syncDynamicRule(id);
      if (res.success) {
        setSnackbar({ open: true, message: res.message || 'Rule synchronized successfully', severity: 'success' });
      } else {
        setSnackbar({ open: true, message: res.message || 'Synchronization failed', severity: 'error' });
      }
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
    setSyncingRuleId(null);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>Dynamic Generation Rules</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" onClick={loadData} startIcon={<RefreshCw size={15} />}>Refresh</Button>
          <Button variant="contained" onClick={handleOpenCreate} startIcon={<Plus size={15} />}>New Rule</Button>
        </Box>
      </Box>

      <TableContainer component={Card} variant="outlined" sx={{ borderRadius: 2 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Rule Code</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>BDC Connection</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>BDC Asset</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>User Field</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Mappings Count</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Mode</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ color: 'text.secondary', py: 4 }}>No dynamic rules configured.</TableCell>
                </TableRow>
              ) : (
                rules.map((rule) => (
                  <TableRow key={rule.ID}>
                    <TableCell sx={{ fontWeight: 600 }}>{rule.code}</TableCell>
                    <TableCell>{rule.bdcConnection?.systemName || 'Unknown'}</TableCell>
                    <TableCell>{rule.sourceEntity}</TableCell>
                    <TableCell>{rule.sourceResponsibleField}</TableCell>
                    <TableCell>{(rule.mappings || []).length} field(s)</TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ px: 1, py: 0.5, bgcolor: 'action.selected', borderRadius: 1, fontWeight: 600 }}>
                        {rule.generationMode === 'USER_CONSOLIDATED_ROLE' ? 'CONSOLIDATED' : 'TEMPLATE'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ px: 1, py: 0.5, color: rule.isActive ? 'success.main' : 'text.disabled', bgcolor: rule.isActive ? 'success.light' : 'action.selected', borderRadius: 1, fontWeight: 700 }}>
                        {rule.isActive ? 'Active' : 'Inactive'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                        <IconButton 
                          size="small" 
                          color="primary" 
                          onClick={() => handleSyncRule(rule.ID)}
                          disabled={syncingRuleId === rule.ID}
                        >
                          {syncingRuleId === rule.ID ? <CircularProgress size={16} /> : <Play size={16} />}
                        </IconButton>
                        <IconButton size="small" onClick={() => handleOpenEdit(rule)}><Edit size={16} /></IconButton>
                        <IconButton size="small" color="error" onClick={() => handleDelete(rule.ID)}><Trash2 size={16} /></IconButton>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </TableContainer>

      {/* Create/Edit Dialog */}
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{editingRule ? 'Edit Generation Rule' : 'New Generation Rule'}</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Rule Code"
              size="small"
              value={form.code}
              onChange={(e) => setForm(p => ({ ...p, code: e.target.value }))}
              disabled={!!editingRule}
              fullWidth
            />
            <TextField
              label="Description"
              size="small"
              value={form.description}
              onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))}
              fullWidth
            />
            <FormControlLabel
              control={<Checkbox checked={form.isActive} onChange={(e) => setForm(p => ({ ...p, isActive: e.target.checked }))} />}
              label="Active Rule"
            />
            
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>Source Master Data Settings</Typography>
            
            <FormControl size="small" fullWidth>
              <InputLabel>BDC Connection</InputLabel>
              <Select
                value={form.bdcConnection_ID}
                label="BDC Connection"
                onChange={(e) => setForm(p => ({ ...p, bdcConnection_ID: e.target.value }))}
              >
                {connections.map(c => <MenuItem key={c.ID} value={c.ID}>{c.systemName} ({c.space})</MenuItem>)}
              </Select>
            </FormControl>

            <FormControl size="small" fullWidth disabled={loadingAssets || !form.bdcConnection_ID}>
              <InputLabel id="bdc-asset-label">
                {loadingAssets ? 'Loading Assets...' : 'BDC Asset'}
              </InputLabel>
              <Select
                labelId="bdc-asset-label"
                label="BDC Asset"
                value={form.sourceEntity || ''}
                onChange={(e) => handleAssetChange(e.target.value)}
              >
                {assets.map(asset => (
                  <MenuItem key={asset} value={asset}>{asset}</MenuItem>
                ))}
                {assets.length === 0 && !loadingAssets && (
                  <MenuItem value="" disabled>No assets available</MenuItem>
                )}
              </Select>
            </FormControl>

            <FormControl size="small" fullWidth disabled={loadingColumns || !form.sourceEntity}>
              <InputLabel id="bdc-responsible-label">
                {loadingColumns ? 'Loading Columns...' : 'User (Responsible) Field'}
              </InputLabel>
              <Select
                labelId="bdc-responsible-label"
                label="User (Responsible) Field"
                value={form.sourceResponsibleField || ''}
                onChange={(e) => setForm(p => ({ ...p, sourceResponsibleField: e.target.value }))}
              >
                {assetColumns.map(col => (
                  <MenuItem key={col} value={col}>{col}</MenuItem>
                ))}
                {assetColumns.length === 0 && !loadingColumns && (
                  <MenuItem value="" disabled>No columns available</MenuItem>
                )}
              </Select>
            </FormControl>

            <TextField
              label="Source Filter Condition"
              size="small"
              value={form.sourceFilterCondition}
              onChange={(e) => setForm(p => ({ ...p, sourceFilterCondition: e.target.value }))}
              placeholder='e.g. {"field": "status", "value": "ACTIVE"}'
              fullWidth
            />

            <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>
              Composite Field Mappings
              {loadingKeys && <CircularProgress size={12} sx={{ ml: 1 }} />}
            </Typography>
            {form.mappings.length === 0 && !loadingKeys && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                Select a BDC Asset to automatically populate its key columns.
              </Typography>
            )}
            {form.mappings.map((mapping, idx) => (
              <Box key={idx} sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <TextField
                  label="Source Column (Derived)"
                  size="small"
                  value={mapping.sourceKeyField}
                  disabled
                  fullWidth
                />
                <Autocomplete
                  size="small"
                  options={fields}
                  getOptionLabel={(option) => option.name || ''}
                  value={fields.find(f => f.name === mapping.targetRestrictionField) || null}
                  onChange={(e, val) => handleMappingChange(idx, val ? val.name : '')}
                  renderInput={(params) => <TextField {...params} label="Target Restriction Field" variant="outlined" />}
                  fullWidth
                />
              </Box>
            ))}

            <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>Target Configuration</Typography>
            <FormControl size="small" fullWidth>
              <InputLabel>Generation Mode</InputLabel>
              <Select
                value={form.generationMode}
                label="Generation Mode"
                onChange={(e) => setForm(p => ({ ...p, generationMode: e.target.value }))}
              >
                <MenuItem value="USER_CONSOLIDATED_ROLE">User Consolidated Role (Highly Optimized)</MenuItem>
                <MenuItem value="TEMPLATE_ASSIGNMENT">Static Template Role Assignment</MenuItem>
              </Select>
            </FormControl>

            {form.generationMode === 'TEMPLATE_ASSIGNMENT' && (
              <FormControl size="small" fullWidth>
                <InputLabel>Template Role</InputLabel>
                <Select
                  value={form.templateRole_ID}
                  label="Template Role"
                  onChange={(e) => setForm(p => ({ ...p, templateRole_ID: e.target.value }))}
                >
                  {roles.map(r => <MenuItem key={r.ID} value={r.ID}>{r.name}</MenuItem>)}
                </Select>
              </FormControl>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>Save Rule</Button>
        </DialogActions>
      </Dialog>

      <Snackbar 
        open={snackbar.open} 
        autoHideDuration={4000} 
        onClose={() => setSnackbar(p => ({ ...p, open: false }))}
      >
        <Alert severity={snackbar.severity} variant="filled">{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
