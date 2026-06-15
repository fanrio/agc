import { useState, useEffect } from 'react';
import { Box, Button, TextField, Card, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton, CircularProgress, Alert, Collapse, Snackbar } from '@mui/material';
import { Plus, Trash2, Edit3, X, Check, Network } from 'lucide-react';
import * as api from '../api';

export default function StreamsView() {
  const [streams, setStreams]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [editingId, setEditingId] = useState(null);

  // Form states
  const [form, setForm] = useState({ ID: '', abbreviation: '', name: '' });
  const [editForm, setEditForm] = useState({ abbreviation: '', name: '' });
  const [error, setError] = useState(''); // kept for backward compatibility if any local helper checks it, but we can also use snackbar
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'error' });

  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  async function load() {
    setLoading(true);
    try {
      const data = await api.getStreams();
      setStreams(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function validate(ID, abbreviation, name) {
    if (ID !== undefined) {
      if (ID.trim().length !== 2) return 'ID must be exactly 2 characters.';
    }
    if (abbreviation.trim().length !== 3) return 'Abbreviation must be exactly 3 characters.';
    if (!name.trim()) return 'Name is required.';
    if (name.length > 150) return 'Name cannot exceed 150 characters.';
    return '';
  }

  async function handleCreate() {
    const validationErr = validate(form.ID, form.abbreviation, form.name);
    if (validationErr) {
      setSnackbar({ open: true, message: validationErr, severity: 'error' });
      return;
    }

    const payload = {
      ID: form.ID.toUpperCase().trim(),
      abbreviation: form.abbreviation.toUpperCase().trim(),
      name: form.name.trim()
    };

    setLoading(true);
    try {
      await api.createStream(payload);
      setForm({ ID: '', abbreviation: '', name: '' });
      setShowAdd(false);
      await load();
    } catch (e) {
      setSnackbar({ open: true, message: e.message, severity: 'error' });
    }
    setLoading(false);
  }

  async function handleUpdate(id) {
    const validationErr = validate(undefined, editForm.abbreviation, editForm.name);
    if (validationErr) {
      setSnackbar({ open: true, message: validationErr, severity: 'error' });
      return;
    }

    const payload = {
      abbreviation: editForm.abbreviation.toUpperCase().trim(),
      name: editForm.name.trim()
    };

    setLoading(true);
    try {
      await api.updateStream(id, payload);
      setEditingId(null);
      await load();
    } catch (e) {
      setSnackbar({ open: true, message: e.message, severity: 'error' });
    }
    setLoading(false);
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete stream "${name}" (${id})?`)) return;
    setLoading(true);
    try {
      await api.deleteStream(id);
      await load();
    } catch (e) {
      setSnackbar({ open: true, message: e.message, severity: 'error' });
    }
    setLoading(false);
  }

  function startEdit(s) {
    setEditingId(s.ID);
    setEditForm({ abbreviation: s.abbreviation, name: s.name });
    setSnackbar(prev => ({ ...prev, open: false }));
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Streams Management</Typography>
          <Typography variant="body2" color="text.secondary">Configure operational Business Data Cloud streams</Typography>
        </Box>
        <Button variant="contained" onClick={() => { setShowAdd(s => !s); setError(''); }} startIcon={<Plus size={15} />}>
          Add Stream
        </Button>
      </Box>

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

      <Collapse in={showAdd}>
        <Card sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '80px 120px 1fr auto' }, gap: 2, alignItems: 'end' }}>
            <TextField
              label="ID (2 Chars)"
              size="small"
              inputProps={{ maxLength: 2 }}
              value={form.ID}
              onChange={e => setForm(f => ({ ...f, ID: e.target.value }))}
            />
            <TextField
              label="Abbreviation"
              size="small"
              inputProps={{ maxLength: 3 }}
              value={form.abbreviation}
              onChange={e => setForm(f => ({ ...f, abbreviation: e.target.value }))}
            />
            <TextField
              label="Name"
              size="small"
              inputProps={{ maxLength: 150 }}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="contained" onClick={handleCreate} disabled={loading} startIcon={<Check size={14} />}>
                Save
              </Button>
              <IconButton onClick={() => setShowAdd(false)} size="small"><X size={16} /></IconButton>
            </Box>
          </Box>
        </Card>
      </Collapse>

      <Card>
        {loading && streams.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress size={30} /></Box>
        ) : streams.length === 0 ? (
          <Box sx={{ py: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <Box sx={{ opacity: 0.5, mb: 2 }}><Network size={40} /></Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>No operational streams configured</Typography>
            <Typography variant="body2" color="text.secondary">Click "Add Stream" to configure a stream (e.g. FI / Finance).</Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell style={{ width: 80, fontWeight: 600 }}>ID</TableCell>
                  <TableCell style={{ width: 140, fontWeight: 600 }}>Abbreviation</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Name</TableCell>
                  <TableCell align="right" style={{ width: 120, fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {streams.map(s => (
                  <TableRow key={s.ID} hover>
                    <TableCell sx={{ fontWeight: 700, color: 'primary.main', fontFamily: 'monospace', fontSize: '1rem' }}>
                      {s.ID}
                    </TableCell>
                    {editingId === s.ID ? (
                      <>
                        <TableCell>
                          <TextField
                            size="small"
                            inputProps={{ maxLength: 3 }}
                            value={editForm.abbreviation}
                            onChange={e => setEditForm(f => ({ ...f, abbreviation: e.target.value }))}
                            sx={{ '& input': { py: 0.5, px: 1, fontSize: 13, fontFamily: 'monospace' } }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            inputProps={{ maxLength: 150 }}
                            value={editForm.name}
                            onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                            sx={{ '& input': { py: 0.5, px: 1, fontSize: 13 } }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Box sx={{ display: 'inline-flex', gap: 1 }}>
                            <IconButton color="primary" onClick={() => handleUpdate(s.ID)} disabled={loading} size="small">
                              <Check size={16} />
                            </IconButton>
                            <IconButton onClick={() => setEditingId(null)} size="small">
                              <X size={16} />
                            </IconButton>
                          </Box>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {s.abbreviation}
                        </TableCell>
                        <TableCell sx={{ fontWeight: 500 }}>
                          {s.name}
                        </TableCell>
                        <TableCell align="right">
                          <Box sx={{ display: 'inline-flex', gap: 1 }}>
                            <IconButton onClick={() => startEdit(s)} size="small" color="inherit">
                              <Edit3 size={15} />
                            </IconButton>
                            <IconButton color="error" onClick={() => handleDelete(s.ID, s.name)} disabled={loading} size="small">
                              <Trash2 size={15} />
                            </IconButton>
                          </Box>
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </Box>
  );
}
