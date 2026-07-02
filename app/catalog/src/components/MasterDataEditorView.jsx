import { useState, useEffect } from 'react';
import { 
  Box, Button, Card, Table, TableBody, TableCell, TableContainer, 
  TableHead, TableRow, Typography, Dialog, DialogTitle, DialogContent, 
  DialogActions, TextField, Autocomplete, IconButton, Snackbar, Alert, 
  CircularProgress
} from '@mui/material';
import { Plus, Edit, Trash2, RefreshCw } from 'lucide-react';
import * as api from '../api';

export default function MasterDataEditorView() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  
  const [form, setForm] = useState({
    ID: '',
    name: '',
    responsibleUser: '',
    status: 'ACTIVE'
  });

  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const data = await api.getCustomers();
      setCustomers(data || []);
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const handleOpenCreate = () => {
    setEditingCustomer(null);
    setForm({
      ID: '',
      name: '',
      responsibleUser: '',
      status: 'ACTIVE'
    });
    setOpen(true);
  };

  const handleOpenEdit = (cust) => {
    setEditingCustomer(cust);
    setForm({
      ID: cust.ID,
      name: cust.name || '',
      responsibleUser: cust.responsibleUser || '',
      status: cust.status
    });
    setOpen(true);
  };

  const handleClose = () => setOpen(false);

  const handleSave = async () => {
    if (!form.ID.trim() || !form.responsibleUser.trim()) {
      setSnackbar({ open: true, message: 'Customer ID and Responsible User are required', severity: 'error' });
      return;
    }
    try {
      if (editingCustomer) {
        await api.updateCustomer(editingCustomer.ID, form);
        setSnackbar({ open: true, message: 'Customer updated (automated dynamic sync triggered)', severity: 'success' });
      } else {
        await api.createCustomer(form);
        setSnackbar({ open: true, message: 'Customer created (automated dynamic sync triggered)', severity: 'success' });
      }
      handleClose();
      loadCustomers();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this customer?')) return;
    try {
      await api.deleteCustomer(id);
      setSnackbar({ open: true, message: 'Customer deleted (automated dynamic sync triggered)', severity: 'success' });
      loadCustomers();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>Master Data: Customers</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" onClick={loadCustomers} startIcon={<RefreshCw size={15} />}>Refresh</Button>
          <Button variant="contained" onClick={handleOpenCreate} startIcon={<Plus size={15} />}>Add Customer</Button>
        </Box>
      </Box>

      <TableContainer component={Card} variant="outlined" sx={{ borderRadius: 2 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Customer ID</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Customer Name</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Responsible User (Email)</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {customers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ color: 'text.secondary', py: 4 }}>No customer master records found.</TableCell>
                </TableRow>
              ) : (
                customers.map((cust) => (
                  <TableRow key={cust.ID}>
                    <TableCell sx={{ fontWeight: 600 }}>{cust.ID}</TableCell>
                    <TableCell>{cust.name || 'N/A'}</TableCell>
                    <TableCell>{cust.responsibleUser}</TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ px: 1, py: 0.5, color: cust.status === 'ACTIVE' ? 'success.main' : 'text.disabled', bgcolor: cust.status === 'ACTIVE' ? 'success.light' : 'action.selected', borderRadius: 1, fontWeight: 700 }}>
                        {cust.status}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                        <IconButton size="small" onClick={() => handleOpenEdit(cust)}><Edit size={16} /></IconButton>
                        <IconButton size="small" color="error" onClick={() => handleDelete(cust.ID)}><Trash2 size={16} /></IconButton>
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
      <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{editingCustomer ? 'Edit Customer Record' : 'Add Customer Record'}</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Customer ID / Code"
              size="small"
              value={form.ID}
              onChange={(e) => setForm(p => ({ ...p, ID: e.target.value }))}
              disabled={!!editingCustomer}
              placeholder="e.g. C1001"
              fullWidth
            />
            <TextField
              label="Customer Name"
              size="small"
              value={form.name}
              onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Responsible User (ID or Email)"
              size="small"
              value={form.responsibleUser}
              onChange={(e) => setForm(p => ({ ...p, responsibleUser: e.target.value }))}
              placeholder="e.g. alice@company.com"
              fullWidth
            />
            <TextField
              label="Status"
              size="small"
              value={form.status}
              onChange={(e) => setForm(p => ({ ...p, status: e.target.value }))}
              placeholder="e.g. ACTIVE"
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>Save Record</Button>
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
