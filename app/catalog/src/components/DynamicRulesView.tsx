import { useState, useEffect } from 'react';
import {
  Box, Button, Card, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Checkbox, FormControlLabel, Autocomplete, IconButton, Snackbar, Alert,
  CircularProgress, Tooltip
} from '@mui/material';
import { Play, Edit, Trash2, Plus, RefreshCw } from 'lucide-react';
import * as api from '../api';
import { usePermissions } from '../context/PermissionsContext';
import EnvironmentSelection from './EnvironmentSelection';
import SearchableSelect from './SearchableSelect';

export default function DynamicRulesView() {
  const { permissions } = usePermissions();
  const [rules, setRules] = useState([]);
  const [roles, setRoles] = useState([]);
  const [fields, setFields] = useState([]);
  const [connections, setConnections] = useState([]);
  const [accessDomains, setAccessDomains] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [assets, setAssets] = useState([]);
  const [assetColumns, setAssetColumns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
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
    accessDomain_ID: '',
    environment_ID: '',
    mappings: []
  });

  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'info' | 'warning' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  const loadData = async () => {
    setLoading(true);
    try {
      const [rData, rolesData, fieldsData, connData, streamsData, envsData] = await Promise.all([
        api.getDynamicRules(),
        api.getRoles(),
        api.getRestrictionFields(),
        api.getBdcSettings(),
        api.getAccessDomainsFlat(),
        api.getEnvironments()
      ]);
      setRules(rData || []);
      setRoles(rolesData || []);
      setFields(fieldsData || []);
      setConnections(connData || []);
      setAccessDomains(streamsData || []);
      setEnvironments(envsData || []);
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
      api.fetchBdcAssets(conn.ID)
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

  // Synchronize mappings with the restriction fields of the selected Access Domain
  useEffect(() => {
    if (!form.accessDomain_ID) {
      setForm(p => ({ ...p, mappings: [] }));
      return;
    }
    const selectedDomain = accessDomains.find(d => d.ID === form.accessDomain_ID);
    const domainFields = selectedDomain
      ? (selectedDomain.restrictionFields || []).map(rf => rf.field?.name).filter(Boolean)
      : [];

    setForm(p => {
      // Reconstruct mappings to match domain restriction fields, keeping existing selections
      const newMappings = domainFields.map(fieldName => {
        const existing = p.mappings.find(m => m.targetRestrictionField === fieldName);
        return existing ? existing : { targetRestrictionField: fieldName, sourceKeyField: '' };
      });
      return { ...p, mappings: newMappings };
    });
  }, [form.accessDomain_ID, accessDomains]);

  // Fetch All Columns when the BDC Asset selection changes
  const handleAssetChange = async (selectedAsset) => {
    setForm(p => ({ ...p, sourceEntity: selectedAsset, sourceResponsibleField: '' }));
    setAssetColumns([]);
    if (!selectedAsset) return;

    const conn = connections.find(c => c.ID === form.bdcConnection_ID);
    if (!conn) return;

    // Fetch All Columns for mapping and Responsible User selector
    setLoadingColumns(true);
    try {
      const cols = await api.fetchBdcAssetColumns(conn.ID, conn.space, selectedAsset);
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
      accessDomain_ID: '',
      environment_ID: '',
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
      accessDomain_ID: rule.accessDomain_ID || '',
      environment_ID: rule.environment_ID || '',
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
        const cols = await api.fetchBdcAssetColumns(conn.ID, conn.space, rule.sourceEntity);
        setAssetColumns(cols || []);
      } catch (err) {
        console.error('Failed to fetch asset columns for editing rule:', err);
      }
      setLoadingColumns(false);
    }
    setOpen(true);
  };

  const handleClose = () => setOpen(false);

  const handleSave = async () => {
    if (!form.code.trim()) {
      setSnackbar({ open: true, message: 'Rule Code is required', severity: 'error' });
      return;
    }
    if (!form.bdcConnection_ID) {
      setSnackbar({ open: true, message: 'BDC Connection is required', severity: 'error' });
      return;
    }
    if (!form.accessDomain_ID) {
      setSnackbar({ open: true, message: 'Access Domain is required', severity: 'error' });
      return;
    }
    if (!form.environment_ID) {
      setSnackbar({ open: true, message: 'Environment is required', severity: 'error' });
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
                        <Tooltip title="Run DRAGE Sync Rule">
                          <span>
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => handleSyncRule(rule.ID)}
                              disabled={syncingRuleId === rule.ID}
                              aria-label="Run DRAGE Sync Rule"
                            >
                              {syncingRuleId === rule.ID ? <CircularProgress size={16} /> : <Play size={16} />}
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Edit Rule">
                          <IconButton size="small" onClick={() => handleOpenEdit(rule)} aria-label="Edit Rule"><Edit size={16} /></IconButton>
                        </Tooltip>
                        <Tooltip title="Delete Rule">
                          <IconButton size="small" color="error" onClick={() => handleDelete(rule.ID)} aria-label="Delete Rule"><Trash2 size={16} /></IconButton>
                        </Tooltip>
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

            <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>Role Settings</Typography>

            <SearchableSelect
              options={accessDomains.map(s => ({ value: s.ID, label: `${s.name} (${s.description})` }))}
              value={form.accessDomain_ID}
              onChange={val => setForm(p => ({ ...p, accessDomain_ID: val }))}
              label="Access Domain"
            />

            <EnvironmentSelection
              value={form.environment_ID}
              onChange={val => setForm(p => ({ ...p, environment_ID: val }))}
            />

            <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>Source Master Data Settings</Typography>

            <SearchableSelect
              options={connections.map(c => ({ value: c.ID, label: `${c.systemName} (${c.space})` }))}
              value={form.bdcConnection_ID}
              onChange={val => setForm(p => ({ ...p, bdcConnection_ID: val }))}
              label="BDC Connection"
            />

            <SearchableSelect
              options={assets}
              value={form.sourceEntity || ''}
              onChange={val => handleAssetChange(val)}
              label={loadingAssets ? 'Loading Assets...' : 'BDC Asset'}
              disabled={loadingAssets || !form.bdcConnection_ID}
            />

            <SearchableSelect
              options={assetColumns}
              value={form.sourceResponsibleField || ''}
              onChange={val => setForm(p => ({ ...p, sourceResponsibleField: val }))}
              label={loadingColumns ? 'Loading Columns...' : 'User (Responsible) Field'}
              disabled={loadingColumns || !form.sourceEntity}
            />

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
              {loadingColumns && <CircularProgress size={12} sx={{ ml: 1 }} />}
            </Typography>
            {form.mappings.length === 0 && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                Select an Access Domain containing restriction fields to configure mappings.
              </Typography>
            )}
            {form.mappings.map((mapping, idx) => (
              <Box key={idx} sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <TextField
                  label="Target Restriction Field"
                  size="small"
                  value={mapping.targetRestrictionField}
                  disabled
                  fullWidth
                />
                <Autocomplete
                  size="small"
                  options={assetColumns}
                  value={mapping.sourceKeyField || null}
                  onChange={(e, val) => {
                    setForm(p => {
                      const newMappings = [...p.mappings];
                      newMappings[idx] = { ...newMappings[idx], sourceKeyField: val || '' };
                      return { ...p, mappings: newMappings };
                    });
                  }}
                  renderInput={(params) => <TextField {...params} label="Source Asset Column" variant="outlined" />}
                  disabled={!form.sourceEntity || loadingColumns}
                  fullWidth
                />
              </Box>
            ))}

            <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>Target Configuration</Typography>
            <SearchableSelect
              options={[
                { value: 'USER_CONSOLIDATED_ROLE', label: 'User Consolidated Role (Highly Optimized)' },
                { value: 'TEMPLATE_ASSIGNMENT', label: 'Static Template Role Assignment' }
              ]}
              value={form.generationMode}
              onChange={val => setForm(p => ({ ...p, generationMode: val }))}
              label="Generation Mode"
            />

            {form.generationMode === 'TEMPLATE_ASSIGNMENT' && (
              <SearchableSelect
                options={roles.map(r => ({ value: r.ID, label: r.name }))}
                value={form.templateRole_ID}
                onChange={val => setForm(p => ({ ...p, templateRole_ID: val }))}
                label="Template Role"
              />
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
