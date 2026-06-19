import { useState, useEffect } from 'react';
import { Box, Card, Typography, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, CircularProgress, Alert, Snackbar } from '@mui/material';
import { RefreshCw, Play, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import * as api from '../api';

function formatDateTime(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  return date.toLocaleString(undefined, { 
    dateStyle: 'medium', 
    timeStyle: 'medium' 
  });
}

const STATUS_COLOR = {
  Success: 'success',
  Open: 'warning',
  Running: 'info',
  Failed: 'error'
};

const STATUS_ICON = {
  Success: CheckCircle2,
  Open: Clock,
  Running: RefreshCw,
  Failed: AlertCircle
};

export default function ReplicationsView() {
  const [replications, setReplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getReplications();
      setReplications(data || []);
    } catch (e) {
      console.error(e);
      setSnackbar({ open: true, message: `Failed to load replications: ${e.message}`, severity: 'error' });
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleStartReplication = async () => {
    setTriggering(true);
    setSnackbar({ open: true, message: 'Starting replication task chain...', severity: 'info' });
    try {
      const res = await api.triggerReplication();
      if (res && res.success) {
        setSnackbar({ open: true, message: res.message || 'Replication triggered successfully!', severity: 'success' });
      } else {
        setSnackbar({ open: true, message: res?.message || 'Replication triggered.', severity: 'success' });
      }
      await load();
    } catch (e) {
      console.error(e);
      setSnackbar({ open: true, message: `Replication failed: ${e.message}`, severity: 'error' });
    }
    setTriggering(false);
  };

  const handleRefreshStatus = async () => {
    setRefreshing(true);
    setSnackbar({ open: true, message: 'Checking execution status of running task chains...', severity: 'info' });
    try {
      const res = await api.checkReplicationStatuses();
      if (res && res.success) {
        setSnackbar({ open: true, message: res.message || 'Execution statuses refreshed successfully.', severity: 'success' });
      } else {
        setSnackbar({ open: true, message: res?.message || 'Execution status check completed.', severity: 'warning' });
      }
      await load();
    } catch (e) {
      console.error(e);
      setSnackbar({ open: true, message: `Failed to check task chain status: ${e.message}`, severity: 'error' });
    }
    setRefreshing(false);
  };

  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnackbar(prev => ({ ...prev, open: false }));
  };

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
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Data Replication Tracker</Typography>
          <Typography variant="body2" color="text.secondary">
            Monitor authorization role synchronization status and trigger task chains defined in your BDC Connection
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button
            variant="outlined"
            onClick={handleRefreshStatus}
            disabled={refreshing || loading}
            startIcon={refreshing ? <CircularProgress size={16} /> : <RefreshCw size={15} />}
          >
            {refreshing ? 'Refreshing...' : 'Refresh Status'}
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleStartReplication}
            disabled={triggering || loading}
            startIcon={triggering ? <CircularProgress size={16} color="inherit" /> : <Play size={15} />}
          >
            {triggering ? 'Replicating...' : 'Start Replication'}
          </Button>
        </Box>
      </Box>

      {loading && replications.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={40} />
        </Box>
      ) : replications.length === 0 ? (
        <Card sx={{ p: 6, textAlign: 'center' }}>
          <Box sx={{ opacity: 0.5, mb: 2 }}><RefreshCw size={40} /></Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>No replication history found</Typography>
          <Typography variant="body2" color="text.secondary">
            Replication records will be created automatically when roles are modified.
          </Typography>
        </Card>
      ) : (
        <Card sx={{ border: '1px solid', borderColor: 'divider' }}>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell style={{ fontWeight: 600 }}>Replication Date</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Environment</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Replication Status</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Start Time</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>End Time</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Replicated Roles / Changes</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Triggered By</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {replications.map(item => {
                  const Color = STATUS_COLOR[item.status] || 'default';
                  const Icon = STATUS_ICON[item.status] || Clock;
                  
                  const envLabels = { P: 'Production', Q: 'QA', D: 'Development' };
                  const envColors = { P: 'error', Q: 'warning', D: 'info' };

                  return (
                    <TableRow key={item.ID} hover>
                      <TableCell sx={{ color: 'text.secondary' }}>
                        {formatDateTime(item.replicationDate)}
                      </TableCell>
                      <TableCell>
                        {item.environment_ID ? (
                          <Chip
                            label={envLabels[item.environment_ID] || item.environment_ID}
                            size="small"
                            color={envColors[item.environment_ID] || 'default'}
                            sx={{ height: 20, fontSize: 11, fontWeight: 500 }}
                          />
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        <Chip
                          icon={<Icon size={12} />}
                          label={item.status}
                          size="small"
                          color={Color}
                          sx={{ fontWeight: 600, textTransform: 'capitalize' }}
                        />
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
                        {formatDateTime(item.startTime)}
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
                        {formatDateTime(item.endTime)}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600, color: 'text.primary', fontSize: '0.8125rem' }}>
                        {item.replicationRoles}
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600, color: 'text.primary', fontSize: '0.8125rem' }}>
                        {item.user || 'system'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}
    </Box>
  );
}
