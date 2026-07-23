import { useState, useEffect } from 'react';
import { Box, Button, TextField, Card, Typography, IconButton, CircularProgress, Collapse, Select, MenuItem, FormControl, InputLabel, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Checkbox, FormControlLabel, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import { Plus, Trash2, X, Settings, Cloud, Edit3, Check } from 'lucide-react';
import * as api from '../api';

export default function RestrictionFieldsView() {
  const [fields, setFields] = useState([]);
  const [bdcConnections, setBdcConnections] = useState([]);
  const [loading, setLoading] = useState(true);

  // Creation States
  const [showAdd, setShowAdd] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newBdcConnectionId, setNewBdcConnectionId] = useState('');
  const [newAsset, setNewAsset] = useState('');
  const [newAssetText, setNewAssetText] = useState('');
  const [newAssetHierarchy, setNewAssetHierarchy] = useState('');
  const [newWithHierarchyDirectory, setNewWithHierarchyDirectory] = useState(false);
  const [assetsList, setAssetsList] = useState([]);
  const [loadingAssets, setLoadingAssets] = useState(false);

  // Editing States
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', bdcConnectionId: '', asset: '', assetText: '', assetHierarchy: '', withHierarchyDirectory: false });
  const [editAssetsList, setEditAssetsList] = useState([]);
  const [loadingEditAssets, setLoadingEditAssets] = useState(false);

  // Alert Dialog States
  const [alertDialog, setAlertDialog] = useState({ open: false, title: 'Error', message: '' });

  function showAlert(message, title = 'Error') {
    setAlertDialog({ open: true, title, message });
  }

  function handleCloseAlert() {
    setAlertDialog({ open: false, title: 'Error', message: '' });
  }

  // Confirm Dialog State
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: 'Confirm', message: '', onConfirm: null });

  // Auto-check metadata of Selected Hierarchy Asset for "hierarchy" attribute (Creation form)
  useEffect(() => {
    if (!newBdcConnectionId || !newAssetHierarchy) {
      setNewWithHierarchyDirectory(false);
      return;
    }
    const conn = bdcConnections.find(c => c.ID === newBdcConnectionId);
    if (conn) {
      api.fetchBdcAssetColumns(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space, newAssetHierarchy)
        .then(cols => {
          const hasHierarchy = cols.some(c => c.toLowerCase() === 'hierarchy');
          setNewWithHierarchyDirectory(hasHierarchy);
        })
        .catch(e => {
          console.error('Failed to fetch asset columns for hierarchy check:', e);
          setNewWithHierarchyDirectory(false);
        });
    }
  }, [newBdcConnectionId, newAssetHierarchy, bdcConnections]);

  // Auto-check metadata of Selected Hierarchy Asset for "hierarchy" attribute (Editing form)
  useEffect(() => {
    if (!editForm.bdcConnectionId || !editForm.assetHierarchy) {
      return;
    }
    const conn = bdcConnections.find(c => c.ID === editForm.bdcConnectionId);
    if (conn) {
      api.fetchBdcAssetColumns(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space, editForm.assetHierarchy)
        .then(cols => {
          const hasHierarchy = cols.some(c => c.toLowerCase() === 'hierarchy');
          setEditForm(prev => ({ ...prev, withHierarchyDirectory: hasHierarchy }));
        })
        .catch(e => {
          console.error('Failed to fetch edit asset columns for hierarchy check:', e);
        });
    }
  }, [editForm.bdcConnectionId, editForm.assetHierarchy, bdcConnections]);

  async function load() {
    setLoading(true);
    try {
      const [customFields, connections] = await Promise.all([
        api.getRestrictionFields(),
        api.getBdcSettings()
      ]);
      setFields(customFields);
      setBdcConnections(connections);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Auto-fetch assets when creation BDC connection changes
  useEffect(() => {
    if (!newBdcConnectionId) {
      setAssetsList([]);
      setNewAsset('');
      setNewAssetText('');
      setNewAssetHierarchy('');
      return;
    }
    const conn = bdcConnections.find(c => c.ID === newBdcConnectionId);
    if (conn) {
      setLoadingAssets(true);
      api.fetchBdcAssets(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space)
        .then(assets => {
          setAssetsList(assets);
          setNewAsset(assets[0] || '');
          setNewAssetText(assets[0] || '');
          setNewAssetHierarchy(assets[0] || '');
        })
        .catch(e => {
          console.error('Failed to load assets:', e);
          setAssetsList([]);
          setNewAsset('');
          setNewAssetText('');
          setNewAssetHierarchy('');
          showAlert(`Failed to load assets: ${e.message}`);
        })
        .finally(() => {
          setLoadingAssets(false);
        });
    }
  }, [newBdcConnectionId, bdcConnections]);

  // Auto-fetch assets when editing BDC connection changes
  useEffect(() => {
    if (!editForm.bdcConnectionId) {
      setEditAssetsList([]);
      return;
    }
    const conn = bdcConnections.find(c => c.ID === editForm.bdcConnectionId);
    if (conn) {
      setLoadingEditAssets(true);
      api.fetchBdcAssets(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space)
        .then(assets => {
          setEditAssetsList(assets);
        })
        .catch(e => {
          console.error('Failed to load edit assets:', e);
          setEditAssetsList([]);
          showAlert(`Failed to load edit assets: ${e.message}`);
        })
        .finally(() => {
          setLoadingEditAssets(false);
        });
    }
  }, [editForm.bdcConnectionId, bdcConnections]);

  async function handleAddField() {
    const name = newFieldName.trim();
    if (!name) return;
    setLoading(true);
    try {
      const payload = {
        name,
        bdcConnection_ID: newBdcConnectionId || null,
        asset: newAsset || null,
        assetText: newAssetText || null,
        assetHierarchy: newAssetHierarchy || null,
        withHierarchyDirectory: newWithHierarchyDirectory,
        idColumns: null,
        textColumn: null
      };
      await api.createRestrictionField(payload);

      setNewFieldName('');
      setNewBdcConnectionId('');
      setNewAsset('');
      setNewAssetText('');
      setNewAssetHierarchy('');
      setNewWithHierarchyDirectory(false);
      setShowAdd(false);
      await load();
    } catch (e) {
      showAlert(e.message);
    }
    setLoading(false);
  }

  async function handleUpdateField(id) {
    const name = editForm.name.trim();
    if (!name) return;
    setLoading(true);
    try {
      const payload = {
        name,
        bdcConnection_ID: editForm.bdcConnectionId || null,
        asset: editForm.asset || null,
        assetText: editForm.assetText || null,
        assetHierarchy: editForm.assetHierarchy || null,
        withHierarchyDirectory: editForm.withHierarchyDirectory || false,
        idColumns: null,
        textColumn: null
      };
      await api.updateRestrictionField(id, payload);

      setEditingId(null);
      await load();
    } catch (e) {
      showAlert(e.message);
    }
    setLoading(false);
  }

  function startEdit(f) {
    setEditingId(f.ID);
    setEditForm({
      name: f.name,
      bdcConnectionId: f.bdcConnection?.ID || '',
      asset: f.asset || '',
      assetText: f.assetText || '',
      assetHierarchy: f.assetHierarchy || '',
      withHierarchyDirectory: !!f.withHierarchyDirectory
    });
    const initialAssets = Array.from(new Set([f.asset, f.assetText, f.assetHierarchy].filter(Boolean)));
    setEditAssetsList(initialAssets);
  }

  function handleDeleteField(id, name) {
    setConfirmDialog({
      open: true,
      title: 'Remove Field',
      message: `Remove restriction field "${name}"? Existing roles using this field name will not be deleted but it will no longer be available for new restrictions.`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        setLoading(true);
        try {
          await api.deleteRestrictionField(id);
          await load();
        } catch (e) {
          showAlert(e.message);
        }
        setLoading(false);
      }
    });
  }

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Restriction Fields Configuration</Typography>
          <Typography variant="body2" color="text.secondary">Configure the field names and BDC asset associations</Typography>
        </Box>
        <Button variant="contained" color="primary" onClick={() => setShowAdd(s => !s)} startIcon={<Plus size={15} />}>
          Add Field
        </Button>
      </Box>

      <Collapse in={showAdd}>
        <Card sx={{ p: 3, mb: 4, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>New Restriction Field</Typography>
          <Grid container spacing={2}>
            {/* Row 1: Field Name, BDC Connection, Asset ID, Asset Text, Asset Hierarchy, Checkbox */}
            <Grid size={{ xs: 12, sm: 1.5 }}>
              <TextField
                label="Field Name"
                size="small"
                fullWidth
                placeholder="e.g. CostCenter"
                value={newFieldName}
                onChange={e => setNewFieldName(e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 2.25 }}>
              <FormControl size="small" fullWidth>
                <InputLabel id="bdc-connection-select-label">BDC Connection</InputLabel>
                <Select
                  labelId="bdc-connection-select-label"
                  label="BDC Connection"
                  value={newBdcConnectionId}
                  onChange={e => setNewBdcConnectionId(e.target.value)}
                >
                  <MenuItem value=""><em>None (No BDC Link)</em></MenuItem>
                  {bdcConnections.map(c => (
                    <MenuItem key={c.ID} value={c.ID}>{c.systemName}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 2 }}>
              <FormControl size="small" fullWidth disabled={!newBdcConnectionId || loadingAssets}>
                <InputLabel id="new-asset-id-label">
                  {loadingAssets ? 'Loading...' : 'Asset ID'}
                </InputLabel>
                <Select
                  labelId="new-asset-id-label"
                  label="Asset ID"
                  value={newAsset}
                  onChange={e => setNewAsset(e.target.value)}
                >
                  {assetsList.map(a => (
                    <MenuItem key={a} value={a}>{a}</MenuItem>
                  ))}
                  {assetsList.length === 0 && (
                    <MenuItem value="" disabled>No assets available</MenuItem>
                  )}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 2 }}>
              <FormControl size="small" fullWidth disabled={!newBdcConnectionId || loadingAssets}>
                <InputLabel id="new-asset-text-label">
                  {loadingAssets ? 'Loading...' : 'Asset Text'}
                </InputLabel>
                <Select
                  labelId="new-asset-text-label"
                  label="Asset Text"
                  value={newAssetText}
                  onChange={e => setNewAssetText(e.target.value)}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {assetsList.map(a => (
                    <MenuItem key={a} value={a}>{a}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 2 }}>
              <FormControl size="small" fullWidth disabled={!newBdcConnectionId || loadingAssets}>
                <InputLabel id="new-asset-hierarchy-label">
                  {loadingAssets ? 'Loading...' : 'Asset Hierarchy'}
                </InputLabel>
                <Select
                  labelId="new-asset-hierarchy-label"
                  label="Asset Hierarchy"
                  value={newAssetHierarchy}
                  onChange={e => setNewAssetHierarchy(e.target.value)}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {assetsList.map(a => (
                    <MenuItem key={a} value={a}>{a}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 2.25 }} sx={{ display: 'flex', alignItems: 'center' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={newWithHierarchyDirectory}
                    disabled={true}
                  />
                }
                label="With Hierarchy Directory"
                sx={{
                  '& .MuiFormControlLabel-label': {
                    fontSize: '0.75rem',
                    lineHeight: 1.1,
                    whiteSpace: 'normal',
                  }
                }}
              />
            </Grid>

            {/* Row 2: Buttons (Right) */}
            <Grid size={12} sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
              <Box sx={{ display: 'flex', gap: 1.5 }}>
                <Button variant="outlined" color="inherit" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button variant="contained" onClick={handleAddField} disabled={loading || !newFieldName.trim()}>Save Field</Button>
              </Box>
            </Grid>
          </Grid>
        </Card>
      </Collapse>

      <Card>
        {loading && fields.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={30} /></Box>
        ) : fields.length === 0 ? (
          <Box sx={{ py: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <Box sx={{ opacity: 0.5, mb: 2 }}><Settings size={40} /></Box>
            <Typography variant="subtitle1" color="text.primary" sx={{ fontWeight: 600 }}>No restriction fields configured</Typography>
            <Typography variant="body2" color="text.secondary">Add fields like Country, Plant, or CostCenter to configure them.</Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell style={{ fontWeight: 600 }}>Field Name</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>BDC Connection</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Asset ID</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Asset Text</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Asset Hierarchy</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Hierarchy Directory</TableCell>
                  <TableCell align="right" style={{ width: 120, fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {fields.map(f => {
                  const isEditing = editingId === f.ID;
                  if (isEditing) {
                    return (
                      <TableRow key={f.ID}>
                        <TableCell colSpan={7} sx={{ bgcolor: 'rgba(0, 0, 0, 0.02)', p: 3 }}>
                          <Grid container spacing={2}>
                            {/* Row 1: Field Name, BDC Connection, Asset ID, Asset Text, Asset Hierarchy, Checkbox */}
                            <Grid size={{ xs: 12, sm: 1.5 }}>
                              <TextField
                                label="Field Name"
                                size="small"
                                fullWidth
                                value={editForm.name}
                                onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                              />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 2.25 }}>
                              <FormControl size="small" fullWidth>
                                <InputLabel id="edit-bdc-select-label">BDC Connection</InputLabel>
                                <Select
                                  labelId="edit-bdc-select-label"
                                  label="BDC Connection"
                                  value={editForm.bdcConnectionId}
                                  onChange={e => setEditForm(prev => ({ ...prev, bdcConnectionId: e.target.value }))}
                                >
                                  <MenuItem value=""><em>None (No BDC Link)</em></MenuItem>
                                  {bdcConnections.map(c => (
                                    <MenuItem key={c.ID} value={c.ID}>{c.systemName}</MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 2 }}>
                              <FormControl size="small" fullWidth disabled={!editForm.bdcConnectionId || loadingEditAssets}>
                                <InputLabel id="edit-asset-id-label">
                                  {loadingEditAssets ? 'Loading...' : 'Asset ID'}
                                </InputLabel>
                                <Select
                                  labelId="edit-asset-id-label"
                                  label="Asset ID"
                                  value={editForm.asset}
                                  onChange={e => setEditForm(prev => ({ ...prev, asset: e.target.value }))}
                                >
                                  {Array.from(new Set([...editAssetsList, editForm.asset])).filter(Boolean).map(a => (
                                    <MenuItem key={a} value={a}>{a}</MenuItem>
                                  ))}
                                  {editAssetsList.length === 0 && (
                                    <MenuItem value="" disabled>No assets available</MenuItem>
                                  )}
                                </Select>
                              </FormControl>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 2 }}>
                              <FormControl size="small" fullWidth disabled={!editForm.bdcConnectionId || loadingEditAssets}>
                                <InputLabel id="edit-asset-text-label">
                                  {loadingEditAssets ? 'Loading...' : 'Asset Text'}
                                </InputLabel>
                                <Select
                                  labelId="edit-asset-text-label"
                                  label="Asset Text"
                                  value={editForm.assetText}
                                  onChange={e => setEditForm(prev => ({ ...prev, assetText: e.target.value }))}
                                >
                                  <MenuItem value=""><em>None</em></MenuItem>
                                  {Array.from(new Set([...editAssetsList, editForm.assetText])).filter(Boolean).map(a => (
                                    <MenuItem key={a} value={a}>{a}</MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 2 }}>
                              <FormControl size="small" fullWidth disabled={!editForm.bdcConnectionId || loadingEditAssets}>
                                <InputLabel id="edit-asset-hierarchy-label">
                                  {loadingEditAssets ? 'Loading...' : 'Asset Hierarchy'}
                                </InputLabel>
                                <Select
                                  labelId="edit-asset-hierarchy-label"
                                  label="Asset Hierarchy"
                                  value={editForm.assetHierarchy}
                                  onChange={e => setEditForm(prev => ({ ...prev, assetHierarchy: e.target.value }))}
                                >
                                  <MenuItem value=""><em>None</em></MenuItem>
                                  {Array.from(new Set([...editAssetsList, editForm.assetHierarchy])).filter(Boolean).map(a => (
                                    <MenuItem key={a} value={a}>{a}</MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 2.25 }} sx={{ display: 'flex', alignItems: 'center' }}>
                              <FormControlLabel
                                control={
                                  <Checkbox
                                    checked={!!editForm.withHierarchyDirectory}
                                    disabled={true}
                                  />
                                }
                                label="With Hierarchy Directory"
                                sx={{
                                  '& .MuiFormControlLabel-label': {
                                    fontSize: '0.75rem',
                                    lineHeight: 1.1,
                                    whiteSpace: 'normal',
                                  }
                                }}
                              />
                            </Grid>

                            {/* Row 2: Buttons (Right) */}
                            <Grid size={12} sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
                              <Box sx={{ display: 'flex', gap: 1.5 }}>
                                <Button variant="outlined" size="small" color="inherit" onClick={() => setEditingId(null)} startIcon={<X size={14} />}>
                                  Cancel
                                </Button>
                                <Button variant="contained" size="small" onClick={() => handleUpdateField(f.ID)} disabled={loading || !editForm.name.trim()} startIcon={<Check size={14} />}>
                                  Save
                                </Button>
                              </Box>
                            </Grid>
                          </Grid>
                        </TableCell>
                      </TableRow>
                    );
                  }

                  return (
                    <TableRow key={f.ID} hover>
                      <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>
                        {f.name}
                      </TableCell>
                      <TableCell>
                        {f.bdcConnection ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Cloud size={14} color="#3b82f6" />
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {f.bdcConnection.systemName}
                            </Typography>
                          </Box>
                        ) : 'None'}
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.8125rem' }}>
                        {f.asset || '—'}
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.8125rem' }}>
                        {f.assetText || '—'}
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.8125rem' }}>
                        {f.assetHierarchy || '—'}
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.8125rem' }}>
                        {f.withHierarchyDirectory ? 'Yes' : '—'}
                      </TableCell>
                      <TableCell align="right">
                        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                          <IconButton onClick={() => startEdit(f)} disabled={loading} size="small" color="inherit">
                            <Edit3 size={15} />
                          </IconButton>
                          <IconButton color="error" onClick={() => handleDeleteField(f.ID, f.name)} disabled={loading} size="small">
                            <Trash2 size={15} />
                          </IconButton>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      {/* Alert Dialog replacing default window.alert */}
      <Dialog
        open={alertDialog.open}
        onClose={handleCloseAlert}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle id="alert-dialog-title">
          {alertDialog.title}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="alert-dialog-description">
            {alertDialog.message}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAlert} variant="contained" autoFocus>
            OK
          </Button>
        </DialogActions>
      </Dialog>

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
