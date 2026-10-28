import { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  TablePagination,
  CircularProgress,
  InputAdornment,
  FormControlLabel,
  Checkbox
} from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { Eye, Search, RefreshCw, AlertCircle } from 'lucide-react';
import * as api from '../api';
import SearchableSelect from './SearchableSelect';
import AuditDetailsDispatcher from './AuditDetails';
import { consolidateAuditLogs, filterAuditLogs } from './AuditDetails/auditUtils';

export default function AuditLogsView() {
  const [logs, setLogs] = useState([]);
  const [roles, setRoles] = useState([]);
  const [accessDomains, setAccessDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters and Pagination
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [entityFilter, setEntityFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [actorFilter, setActorFilter] = useState('ALL');
  const [criticalFilter, setCriticalFilter] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // Dialog State
  const [selectedLog, setSelectedLog] = useState(null);

  const loadLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const [data, rolesData, domainsData] = await Promise.all([
        api.getAuditLogs(),
        api.getRoles(),
        api.getAccessDomainsFlat()
      ]);
      const consolidated = consolidateAuditLogs(data || []);
      setLogs(consolidated);
      setRoles(Array.isArray(rolesData) ? rolesData : (rolesData?.value || []));
      setAccessDomains(Array.isArray(domainsData) ? domainsData : (domainsData?.value || []));
    } catch (err) {
      setError(err.message || 'Failed to fetch audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const handlePageChange = (event, newPage) => {
    setPage(newPage);
  };

  const handleRowsPerPageChange = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const actorsList = [...new Set(logs.map(log => log.createdBy).filter(Boolean))].sort();

  const filteredLogs = filterAuditLogs(
    logs,
    {
      search,
      actionFilter,
      entityFilter,
      actorFilter,
      dateFilter,
      startDate,
      endDate,
      criticalFilter
    },
    roles
  );

  const paginatedLogs = filteredLogs.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const getActionChip = (action) => {
    switch (action) {
      case 'CREATE':
        return <Chip label="CREATE" size="small" color="success" />;
      case 'UPDATE':
        return <Chip label="UPDATE" size="small" color="info" />;
      case 'DELETE':
        return <Chip label="DELETE" size="small" color="error" />;
      default:
        return <Chip label={action} size="small" color="default" />;
    }
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary' }}>
              System Audit Logs
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Review security compliance logs and lifecycle changes for roles and assignments.
            </Typography>
          </Box>
          <Button
            variant="outlined"
            color="primary"
            onClick={loadLogs}
            startIcon={<RefreshCw size={16} />}
            disabled={loading}
          >
            Refresh
          </Button>
        </Box>

        {/* Filter Toolbar Card */}
        <Card sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', backgroundImage: 'none' }}>
          <CardContent sx={{ p: '20px !important' }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
                <TextField
                  placeholder="Search by Target, User, details..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  size="small"
                  sx={{ flexGrow: 1, minWidth: 260 }}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start" sx={{ color: 'text.secondary' }}>
                          <Search size={18} />
                        </InputAdornment>
                      ),
                    }
                  }}
                />

                <SearchableSelect
                  options={[
                    { value: 'ALL', label: 'All Time' },
                    { value: 'TODAY', label: 'Today' },
                    { value: 'WEEK', label: 'Past 7 Days' },
                    { value: 'MONTH', label: 'Past 30 Days' },
                    { value: 'CUSTOM', label: 'Custom Range...' }
                  ]}
                  value={dateFilter}
                  onChange={val => { setDateFilter(val); setPage(0); }}
                  label="Time Range"
                  sx={{ minWidth: 150 }}
                />

                {dateFilter === 'CUSTOM' && (
                  <>
                    <DatePicker
                      label="Start Date"
                      value={startDate}
                      onChange={(val) => { setStartDate(val); setPage(0); }}
                      slotProps={{ textField: { size: 'small', sx: { minWidth: 150 } } }}
                    />
                    <DatePicker
                      label="End Date"
                      value={endDate}
                      onChange={(val) => { setEndDate(val); setPage(0); }}
                      slotProps={{ textField: { size: 'small', sx: { minWidth: 150 } } }}
                    />
                  </>
                )}

                <SearchableSelect
                  options={[
                    { value: 'ALL', label: 'All Actions' },
                    { value: 'CREATE', label: 'CREATE' },
                    { value: 'UPDATE', label: 'UPDATE' },
                    { value: 'DELETE', label: 'DELETE' }
                  ]}
                  value={actionFilter}
                  onChange={val => { setActionFilter(val); setPage(0); }}
                  label="Action"
                  sx={{ minWidth: 150 }}
                />

                <SearchableSelect
                  options={[
                    { value: 'ALL', label: 'All Entities' },
                    { value: 'Roles', label: 'Roles' },
                    { value: 'RoleAssignments', label: 'Role Assignments' }
                  ]}
                  value={entityFilter}
                  onChange={val => { setEntityFilter(val); setPage(0); }}
                  label="Entity Type"
                  sx={{ minWidth: 180 }}
                />
              </Box>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', flexGrow: 1 }}>
                  <SearchableSelect
                    options={[
                      { value: 'ALL', label: 'All Performers' },
                      ...actorsList.map(actor => ({ value: actor, label: actor }))
                    ]}
                    value={actorFilter}
                    onChange={val => { setActorFilter(val); setPage(0); }}
                    label="Performed By"
                    sx={{ minWidth: 180 }}
                  />
                </Box>

                <FormControlLabel
                  control={
                    <Checkbox
                      checked={criticalFilter}
                      onChange={(e) => { setCriticalFilter(e.target.checked); setPage(0); }}
                      sx={{
                        color: 'text.secondary',
                        '&.Mui-checked': {
                          color: 'error.main',
                        },
                      }}
                    />
                  }
                  label={
                    <Typography variant="body2" sx={{ fontWeight: 600, color: criticalFilter ? 'error.main' : 'text.secondary' }}>
                      Critical Roles Only
                    </Typography>
                  }
                />
              </Box>
            </Box>
          </CardContent>
        </Card>

        {/* Main Table Card */}
        <Card>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
              <CircularProgress size={40} />
            </Box>
          ) : error ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8, gap: 1 }}>
              <AlertCircle size={40} color="#ba1a1a" />
              <Typography color="error">{error}</Typography>
              <Button variant="outlined" size="small" onClick={loadLogs} sx={{ mt: 1 }}>Try Again</Button>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell style={{ fontWeight: 600 }}>Entity</TableCell>
                      <TableCell style={{ fontWeight: 600 }}>Subject Identity</TableCell>
                      <TableCell style={{ fontWeight: 600 }}>Action</TableCell>
                      <TableCell style={{ fontWeight: 600 }}>Performed By</TableCell>
                      <TableCell style={{ fontWeight: 600 }}>Timestamp</TableCell>
                      <TableCell align="right" style={{ width: 120, fontWeight: 600 }}>Details</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {paginatedLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                          No audit logs found matching the filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedLogs.map((log) => (
                        <TableRow key={log.ID} hover>
                          <TableCell sx={{ color: 'text.primary', fontSize: '0.875rem', fontWeight: 500 }}>
                            {log.entityName}
                          </TableCell>
                          <TableCell sx={{
                            color: log.targetName ? 'text.primary' : 'text.secondary',
                            fontSize: log.targetName ? '0.875rem' : '0.8125rem',
                            fontWeight: log.targetName ? 500 : 'inherit'
                          }}>
                            {log.targetName || log.recordId}
                          </TableCell>
                          <TableCell>
                            {getActionChip(log.action)}
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
                            {log.createdBy}
                          </TableCell>
                          <TableCell sx={{ color: 'text.primary', fontSize: '0.875rem' }}>
                            {new Date(log.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell align="right">
                            <IconButton
                              onClick={() => setSelectedLog(log)}
                              size="small"
                              sx={{ color: 'primary.main', '&:hover': { bgcolor: 'primary.light', color: 'primary.contrastText' } }}
                            >
                              <Eye size={16} />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <TablePagination
                rowsPerPageOptions={[5, 10, 25, 50]}
                component="div"
                count={filteredLogs.length}
                rowsPerPage={rowsPerPage}
                page={page}
                onPageChange={handlePageChange}
                onRowsPerPageChange={handleRowsPerPageChange}
                sx={{ borderTop: '1px solid', borderColor: 'divider', color: 'text.secondary' }}
              />
            </Box>
          )}
        </Card>

        {/* JSON Details Dialog */}
        <Dialog
          open={Boolean(selectedLog)}
          onClose={() => setSelectedLog(null)}
          maxWidth="md"
          fullWidth
          PaperProps={{
            sx: {
              bgcolor: 'background.paper',
              backgroundImage: 'none',
              border: '1px solid',
              borderColor: 'divider',
            }
          }}
        >
          {selectedLog && (
            <>
              <DialogTitle sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Audit Details
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {selectedLog.entityName} · {selectedLog.action} · {new Date(selectedLog.createdAt).toLocaleString()}
                  </Typography>
                </Box>
              </DialogTitle>
              <DialogContent sx={{ mt: 2 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
                  Audit details for target record ID: <Box component="span" sx={{ color: 'text.primary' }}>{selectedLog.recordId}</Box>
                </Typography>
                <AuditDetailsDispatcher log={selectedLog} roles={roles} accessDomains={accessDomains} />
              </DialogContent>
              <DialogActions sx={{ borderTop: '1px solid', borderColor: 'divider', px: 3, py: 2 }}>
                <Button
                  onClick={() => setSelectedLog(null)}
                  variant="contained"
                  color="primary"
                >
                  Close
                </Button>
              </DialogActions>
            </>
          )}
        </Dialog>
      </Box>
    </LocalizationProvider>
  );
}
