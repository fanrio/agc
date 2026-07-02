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
  const [loading, setLoading] = useState(false);
  const [syncingRuleId, setSyncingRuleId] = useState(null);
  
  // Dialog state
  const [open, setOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [form, setForm] = useState({
    code: '',
    description: '',
    isActive: true,
    sourceType: 'LOCAL_DB',
    sourceEntity: 'fanrio.auth.Customers',
    sourceKeyField: 'ID',
    sourceResponsibleField: 'responsibleUser',
    sourceFilterCondition: '',
    generationMode: 'USER_CONSOLIDATED_ROLE',
    templateRole_ID: '',
    targetRestrictionField: '',
    filterType: 'MULTI_VALUE'
  });

  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const loadData = async () => {
    setLoading(true);
    try {
      const [rData, rolesData, fieldsData] = await Promise.all([
        api.getDynamicRules(),
        api.getRoles(),
        api.getRestrictionFields()
      ]);
      setRules(rData || []);
      setRoles(rolesData || []);
      setFields(fieldsData || []);
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenCreate = () => {
    setEditingRule(null);
    setForm({
      code: '',
      description: '',
      isActive: true,
      sourceType: 'LOCAL_DB',
      sourceEntity: 'fanrio.auth.Customers',
      sourceKeyField: 'ID',
      sourceResponsibleField: 'responsibleUser',
      sourceFilterCondition: '',
      generationMode: 'USER_CONSOLIDATED_ROLE',
      templateRole_ID: '',
      targetRestrictionField: '',
      filterType: 'MULTI_VALUE'
    });
    setOpen(true);
  };

  const handleOpenEdit = (rule) => {
    setEditingRule(rule);
    setForm({
      code: rule.code,
      description: rule.description || '',
      isActive: rule.isActive,
      sourceType: rule.sourceType,
      sourceEntity: rule.sourceEntity,
      sourceKeyField: rule.sourceKeyField,
      sourceResponsibleField: rule.sourceResponsibleField,
      sourceFilterCondition: rule.sourceFilterCondition || '',
      generationMode: rule.generationMode,
      templateRole_ID: rule.templateRole_ID || '',
      targetRestrictionField: rule.targetRestrictionField || '',
      filterType: rule.filterType
    });
    setOpen(true);
  };

  const handleClose = () => setOpen(false);

  const handleSave = async () => {
    if (!form.code.trim()) {
      setSnackbar({ open: true, message: 'Rule Code is required', severity: 'error' });
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
                <TableCell sx={{ fontWeight: 700 }}>Source Table</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>User Field</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Target Field</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Mode</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ color: 'text.secondary', py: 4 }}>No dynamic rules configured.</TableCell>
                </TableRow>
              ) : (
                rules.map((rule) => (
                  <TableRow key={rule.ID}>
                    <TableCell sx={{ fontWeight: 600 }}>{rule.code}</TableCell>
                    <TableCell>{rule.sourceEntity}</TableCell>
                    <TableCell>{rule.sourceResponsibleField}</TableCell>
                    <TableCell>{rule.targetRestrictionField || 'N/A'}</TableCell>
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
              <InputLabel>Source Type</InputLabel>
              <Select
                value={form.sourceType}
                label="Source Type"
                onChange={(e) => setForm(p => ({ ...p, sourceType: e.target.value }))}
              >
                <MenuItem value="LOCAL_DB">Local Database Entity</MenuItem>
                <MenuItem value="HANA_VIEW">SAP HANA View</MenuItem>
                <MenuItem value="ODATA_SERVICE">External OData Service</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Source Entity / Table Path"
              size="small"
              value={form.sourceEntity}
              onChange={(e) => setForm(p => ({ ...p, sourceEntity: e.target.value }))}
              fullWidth
            />

            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Key Field Name"
                size="small"
                value={form.sourceKeyField}
                onChange={(e) => setForm(p => ({ ...p, sourceKeyField: e.target.value }))}
                fullWidth
              />
              <TextField
                label="User (Responsible) Field"
                size="small"
                value={form.sourceResponsibleField}
                onChange={(e) => setForm(p => ({ ...p, sourceResponsibleField: e.target.value }))}
                fullWidth
              />
            </Box>

            <TextField
              label="Source Filter Condition"
              size="small"
              value={form.sourceFilterCondition}
              onChange={(e) => setForm(p => ({ ...p, sourceFilterCondition: e.target.value }))}
              placeholder="e.g. status = 'ACTIVE'"
              fullWidth
            />

            <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>Generation Target Configuration</Typography>
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

            {form.generationMode === 'TEMPLATE_ASSIGNMENT' ? (
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
            ) : (
              <Autocomplete
                size="small"
                options={fields}
                getOptionLabel={(option) => option.name || ''}
                value={fields.find(f => f.name === form.targetRestrictionField) || null}
                onChange={(e, val) => setForm(p => ({ ...p, targetRestrictionField: val ? val.name : '' }))}
                renderInput={(params) => <TextField {...params} label="Target Restriction Field" variant="outlined" />}
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
