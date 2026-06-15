import { useState, useEffect } from 'react';
import { Box, Button, TextField, Card, Typography, List, ListItem, IconButton, Chip, CircularProgress, Collapse, Select, MenuItem, FormControl, InputLabel, Grid, Checkbox, OutlinedInput, ListItemText, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { Plus, Trash2, X, Settings, Cloud, Edit3, Check } from 'lucide-react';
import * as api from '../api';

export default function RestrictionFieldsView() {
  const [fields, setFields]         = useState([]);
  const [bdcConnections, setBdcConnections] = useState([]);
  const [loading, setLoading]       = useState(true);
  
  // Creation States
  const [showAdd, setShowAdd]       = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newBdcConnectionId, setNewBdcConnectionId] = useState('');
  const [newAsset, setNewAsset] = useState('');
  const [assetsList, setAssetsList] = useState([]);
  const [loadingAssets, setLoadingAssets] = useState(false);

  // ID & Text Metadata Columns States
  const [columnsList, setColumnsList] = useState([]);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [newIdColumns, setNewIdColumns] = useState([]);
  const [newTextColumn, setNewTextColumn] = useState('');

  // Editing States
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', bdcConnectionId: '', asset: '', idColumns: [], textColumn: '' });
  const [editAssetsList, setEditAssetsList] = useState([]);
  const [loadingEditAssets, setLoadingEditAssets] = useState(false);
  const [editColumnsList, setEditColumnsList] = useState([]);
  const [loadingEditColumns, setLoadingEditColumns] = useState(false);

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
      return;
    }
    const conn = bdcConnections.find(c => c.ID === newBdcConnectionId);
    if (conn) {
      setLoadingAssets(true);
      api.fetchBdcAssets(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space)
        .then(assets => {
          setAssetsList(assets);
          setNewAsset(assets[0] || '');
        })
        .catch(e => {
          console.error('Failed to load assets:', e);
          setAssetsList([]);
          setNewAsset('');
          alert(`Failed to load assets: ${e.message}`);
        })
        .finally(() => {
          setLoadingAssets(false);
        });
    }
  }, [newBdcConnectionId, bdcConnections]);

  // Auto-fetch columns when creation BDC connection or asset changes
  useEffect(() => {
    if (!newBdcConnectionId || !newAsset) {
      setColumnsList([]);
      setNewIdColumns([]);
      setNewTextColumn('');
      return;
    }
    const conn = bdcConnections.find(c => c.ID === newBdcConnectionId);
    if (conn) {
      setLoadingColumns(true);
      api.fetchBdcAssetColumns(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space, newAsset)
        .then(cols => {
          setColumnsList(cols);
          const defaultId = cols.find(c => c.toLowerCase() === 'id') || cols[0] || '';
          setNewIdColumns(defaultId ? [defaultId] : []);
          const defaultText = cols.find(c => ['name', 'text', 'description', 'formattedaddress'].includes(c.toLowerCase())) || cols[0] || '';
          setNewTextColumn(defaultText);
        })
        .catch(e => {
          console.error('Failed to fetch columns:', e);
          setColumnsList([]);
          alert(`Failed to load columns: ${e.message}`);
        })
        .finally(() => {
          setLoadingColumns(false);
        });
    }
  }, [newBdcConnectionId, newAsset, bdcConnections]);

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
          alert(`Failed to load edit assets: ${e.message}`);
        })
        .finally(() => {
          setLoadingEditAssets(false);
        });
    }
  }, [editForm.bdcConnectionId, bdcConnections]);

  // Auto-fetch columns when editing asset changes
  useEffect(() => {
    if (!editForm.bdcConnectionId || !editForm.asset) {
      setEditColumnsList([]);
      return;
    }
    const conn = bdcConnections.find(c => c.ID === editForm.bdcConnectionId);
    if (conn) {
      setLoadingEditColumns(true);
      api.fetchBdcAssetColumns(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space, editForm.asset)
        .then(cols => {
          setEditColumnsList(cols);
        })
        .catch(e => {
          console.error('Failed to load edit columns:', e);
          setEditColumnsList([]);
          alert(`Failed to load edit columns: ${e.message}`);
        })
        .finally(() => {
          setLoadingEditColumns(false);
        });
    }
  }, [editForm.bdcConnectionId, editForm.asset, bdcConnections]);

  async function handleAddField() {
    const name = newFieldName.trim();
    if (!name) return;
    setLoading(true);
    try {
      const payload = {
        name,
        bdcConnection_ID: newBdcConnectionId || null,
        asset: newAsset || null,
        idColumns: newIdColumns.length > 0 ? JSON.stringify(newIdColumns) : null,
        textColumn: newTextColumn || null
      };
      await api.createRestrictionField(payload);
      
      setNewFieldName('');
      setNewBdcConnectionId('');
      setNewAsset('');
      setNewIdColumns([]);
      setNewTextColumn('');
      setShowAdd(false);
      await load();
    } catch (e) {
      alert(e.message);
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
        idColumns: editForm.idColumns.length > 0 ? JSON.stringify(editForm.idColumns) : null,
        textColumn: editForm.textColumn || null
      };
      await api.updateRestrictionField(id, payload);

      setEditingId(null);
      await load();
    } catch (e) {
      alert(e.message);
    }
    setLoading(false);
  }

  function startEdit(f) {
    let initialIds = [];
    try {
      initialIds = f.idColumns ? JSON.parse(f.idColumns) : [];
    } catch {
      initialIds = f.idColumns ? [f.idColumns] : [];
    }
    setEditingId(f.ID);
    setEditForm({
      name: f.name,
      bdcConnectionId: f.bdcConnection?.ID || '',
      asset: f.asset || '',
      idColumns: initialIds,
      textColumn: f.textColumn || ''
    });
    if (f.asset) {
      setEditAssetsList([f.asset]);
    } else {
      setEditAssetsList([]);
    }
  }

  async function handleDeleteField(id, name) {
    if (!confirm(`Remove restriction field "${name}"? Existing roles using this field name will not be deleted but it will no longer be available for new restrictions.`)) return;
    setLoading(true);
    try {
      await api.deleteRestrictionField(id);
      await load();
    } catch (e) {
      alert(e.message);
    }
    setLoading(false);
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
            <Grid item xs={12} sm={4}>
              <TextField
                label="Field Name"
                size="small"
                fullWidth
                placeholder="e.g. CostCenter"
                value={newFieldName}
                onChange={e => setNewFieldName(e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
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
            <Grid item xs={12} sm={4}>
              <FormControl size="small" fullWidth disabled={!newBdcConnectionId || loadingAssets}>
                <InputLabel id="asset-select-label">
                  {loadingAssets ? 'Loading Assets...' : 'Asset'}
                </InputLabel>
                <Select
                  labelId="asset-select-label"
                  label="Asset"
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

            {newBdcConnectionId && newAsset && (
              <>
                <Grid item xs={12} sm={6}>
                  <FormControl size="small" fullWidth disabled={loadingColumns || columnsList.length === 0}>
                    <InputLabel id="new-id-columns-label">ID Columns (Keys)</InputLabel>
                    <Select
                      labelId="new-id-columns-label"
                      multiple
                      value={newIdColumns}
                      onChange={e => setNewIdColumns(e.target.value)}
                      input={<OutlinedInput label="ID Columns (Keys)" />}
                      renderValue={selected => selected.join(', ')}
                    >
                      {columnsList.map(c => (
                        <MenuItem key={c} value={c}>
                          <Checkbox checked={newIdColumns.indexOf(c) > -1} size="small" />
                          <ListItemText primary={c} />
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl size="small" fullWidth disabled={loadingColumns || columnsList.length === 0}>
                    <InputLabel id="new-text-column-label">Text Column (Label)</InputLabel>
                    <Select
                      labelId="new-text-column-label"
                      label="Text Column (Label)"
                      value={newTextColumn}
                      onChange={e => setNewTextColumn(e.target.value)}
                    >
                      <MenuItem value=""><em>None</em></MenuItem>
                      {columnsList.map(c => (
                        <MenuItem key={c} value={c}>{c}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              </>
            )}
          </Grid>

          <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end', mt: 1 }}>
            <Button variant="outlined" color="inherit" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button variant="contained" onClick={handleAddField} disabled={loading || !newFieldName.trim()}>Save Field</Button>
          </Box>
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
                  <TableCell style={{ fontWeight: 600 }}>Asset</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Metadata Mapping</TableCell>
                  <TableCell align="right" style={{ width: 120, fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {fields.map(f => {
                  const isEditing = editingId === f.ID;
                  if (isEditing) {
                    return (
                      <TableRow key={f.ID}>
                        <TableCell colSpan={5} sx={{ bgcolor: 'rgba(0, 0, 0, 0.02)', p: 3 }}>
                          <Grid container spacing={2}>
                            <Grid item xs={12} sm={4}>
                              <TextField
                                label="Field Name"
                                size="small"
                                fullWidth
                                value={editForm.name}
                                onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                              />
                            </Grid>
                            <Grid item xs={12} sm={4}>
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
                            <Grid item xs={12} sm={4}>
                              <FormControl size="small" fullWidth disabled={!editForm.bdcConnectionId || loadingEditAssets}>
                                <InputLabel id="edit-asset-select-label">
                                  {loadingEditAssets ? 'Loading Assets...' : 'Asset'}
                                </InputLabel>
                                <Select
                                  labelId="edit-asset-select-label"
                                  label="Asset"
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

                            {editForm.bdcConnectionId && editForm.asset && (
                              <>
                                <Grid item xs={12} sm={6}>
                                  <FormControl size="small" fullWidth disabled={loadingEditColumns || editColumnsList.length === 0}>
                                    <InputLabel id="edit-id-columns-label">ID Columns (Keys)</InputLabel>
                                    <Select
                                      labelId="edit-id-columns-label"
                                      multiple
                                      value={editForm.idColumns}
                                      onChange={e => setEditForm(prev => ({ ...prev, idColumns: e.target.value }))}
                                      input={<OutlinedInput label="ID Columns (Keys)" />}
                                      renderValue={selected => selected.join(', ')}
                                    >
                                      {editColumnsList.map(c => (
                                        <MenuItem key={c} value={c}>
                                          <Checkbox checked={editForm.idColumns.indexOf(c) > -1} size="small" />
                                          <ListItemText primary={c} />
                                        </MenuItem>
                                      ))}
                                    </Select>
                                  </FormControl>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                  <FormControl size="small" fullWidth disabled={loadingEditColumns || editColumnsList.length === 0}>
                                    <InputLabel id="edit-text-column-label">Text Column (Label)</InputLabel>
                                    <Select
                                      labelId="edit-text-column-label"
                                      label="Text Column (Label)"
                                      value={editForm.textColumn}
                                      onChange={e => setEditForm(prev => ({ ...prev, textColumn: e.target.value }))}
                                    >
                                      <MenuItem value=""><em>None</em></MenuItem>
                                      {editColumnsList.map(c => (
                                        <MenuItem key={c} value={c}>{c}</MenuItem>
                                      ))}
                                    </Select>
                                  </FormControl>
                                </Grid>
                              </>
                            )}

                            <Grid item xs={12} sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', alignItems: 'center', mt: 1 }}>
                              <Button variant="contained" size="small" onClick={() => handleUpdateField(f.ID)} disabled={loading || !editForm.name.trim()} startIcon={<Check size={14} />}>
                                Save
                              </Button>
                              <Button variant="outlined" size="small" color="inherit" onClick={() => setEditingId(null)} startIcon={<X size={14} />}>
                                Cancel
                              </Button>
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
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                        {f.asset || '—'}
                      </TableCell>
                      <TableCell>
                        {f.bdcConnection ? (
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {f.idColumns && (
                              <Chip 
                                label={`Keys: ${(() => {
                                  try { return JSON.parse(f.idColumns).join(', '); } catch { return f.idColumns; }
                                })()}`} 
                                size="small" 
                                variant="outlined" 
                                sx={{ fontSize: 10, height: 20 }} 
                              />
                            )}
                            {f.textColumn && (
                              <Chip 
                                label={`Label: ${f.textColumn}`} 
                                size="small" 
                                variant="outlined" 
                                sx={{ fontSize: 10, height: 20 }} 
                              />
                            )}
                          </Box>
                        ) : '—'}
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

    </Box>
  );
}
