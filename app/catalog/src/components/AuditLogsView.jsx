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
  Paper,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  TablePagination,
  CircularProgress,
  InputAdornment,
  FormControlLabel,
  Checkbox
} from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import { Eye, Search, RefreshCw, AlertCircle } from 'lucide-react';
import { getAuditLogs, getRoles } from '../api';
import AuditDetailsDispatcher from './AuditDetails';

export default function AuditLogsView() {
  const [logs, setLogs] = useState([]);
  const [roles, setRoles] = useState([]);
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

  const consolidateLogs = (rawLogs) => {
    const consolidated = [];
    const sorted = [...rawLogs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    for (const log of sorted) {
      const match = consolidated.find(c =>
        c.recordId === log.recordId &&
        c.action === log.action &&
        c.createdBy === log.createdBy &&
        Math.abs(new Date(c.createdAt) - new Date(log.createdAt)) < 5000
      );

      if (match) {
        try {
          const matchParsed = JSON.parse(match.details);
          const logParsed = JSON.parse(log.details);
          const merged = { ...logParsed };
          for (const [k, v] of Object.entries(matchParsed)) {
            if (merged[k] !== undefined) {
              let counter = 1;
              while (merged[`${k}_${counter}`] !== undefined) {
                counter++;
              }
              merged[`${k}_${counter}`] = v;
            } else {
              merged[k] = v;
            }
          }
          match.details = JSON.stringify(merged);
        } catch (e) {
          console.warn('[AuditLogsView] Failed to merge duplicate log details:', e.message);
          // Fall back: keep the log unmerged
          consolidated.push({ ...log });
        }
      } else {
        consolidated.push({ ...log });
      }
    }

    const finalLogs = [];
    for (const log of consolidated) {
      try {
        const parsed = JSON.parse(log.details);
        const keys = Object.keys(parsed);
        const addedKeys = keys.filter(k => k.startsWith('Restriction Added'));
        const deletedKeys = keys.filter(k => k.startsWith('Restriction Deleted'));
        const removedKeys = new Set();

        for (const aKey of addedKeys) {
          const aNew = parsed[aKey].new || '';
          const aField = aNew.match(/Field:\s*([^,]+)/)?.[1];
          const aType = aNew.match(/Type:\s*([^,]+)/)?.[1];
          const aVal = aNew.match(/Value:\s*(.+)$/)?.[1];

          for (const dKey of deletedKeys) {
            if (removedKeys.has(dKey)) continue;
            const dOld = parsed[dKey].old || '';
            const dField = dOld.match(/Field:\s*([^,]+)/)?.[1];
            const dType = dOld.match(/Type:\s*([^,]+)/)?.[1];
            const dVal = dOld.match(/Value:\s*(.+)$/)?.[1];

            if (aField && dField && aField === dField && aType === dType && aVal === dVal) {
              removedKeys.add(aKey);
              removedKeys.add(dKey);
              break;
            }
          }
        }

        const filteredDetails = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (!removedKeys.has(k)) {
            filteredDetails[k] = v;
          }
        }

        if (Object.keys(filteredDetails).length > 0) {
          log.details = JSON.stringify(filteredDetails);
          finalLogs.push(log);
        }
      } catch (e) {
        finalLogs.push(log);
      }
    }
    return finalLogs;
  };

  const loadLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const [data, rolesData] = await Promise.all([getAuditLogs(), getRoles()]);
      const consolidated = consolidateLogs(data || []);
      setLogs(consolidated);
      setRoles(rolesData || []);
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

  // Get unique list of actors from all logs
  const actorsList = [...new Set(logs.map(log => log.createdBy).filter(Boolean))].sort();

  // Filter Logic
  const filteredLogs = logs.filter(log => {
    const matchesSearch =
      log.recordId?.toLowerCase().includes(search.toLowerCase()) ||
      log.targetName?.toLowerCase().includes(search.toLowerCase()) ||
      log.details?.toLowerCase().includes(search.toLowerCase()) ||
      log.createdBy?.toLowerCase().includes(search.toLowerCase());

    const matchesAction = actionFilter === 'ALL' || log.action === actionFilter;
    const matchesEntity = entityFilter === 'ALL' || log.entityName === entityFilter;

    // Performed By (Actor) filter
    const matchesActor = actorFilter === 'ALL' || log.createdBy === actorFilter;

    // Time Range filter
    let matchesDate = true;
    if (dateFilter !== 'ALL') {
      const logDate = new Date(log.createdAt);
      const today = new Date();
      if (dateFilter === 'TODAY') {
        matchesDate = logDate.getDate() === today.getDate() &&
          logDate.getMonth() === today.getMonth() &&
          logDate.getFullYear() === today.getFullYear();
      } else if (dateFilter === 'WEEK') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        matchesDate = logDate >= weekAgo;
      } else if (dateFilter === 'MONTH') {
        const monthAgo = new Date();
        monthAgo.setDate(monthAgo.getDate() - 30);
        matchesDate = logDate >= monthAgo;
      } else if (dateFilter === 'CUSTOM') {
        if (startDate) {
          const start = startDate.startOf('day').toDate();
          if (logDate < start) matchesDate = false;
        }
        if (endDate) {
          const end = endDate.endOf('day').toDate();
          if (logDate > end) matchesDate = false;
        }
      }
    }

    // Critical Roles Only filter
    let matchesCritical = true;
    if (criticalFilter) {
      let roleId = null;
      if (log.entityName === 'Roles') {
        roleId = log.recordId;
      } else if (log.entityName === 'RoleAssignments') {
        try {
          const parsed = JSON.parse(log.details);
          if (parsed.role_ID) {
            roleId = parsed.role_ID;
          } else if (parsed.role && parsed.role.ID) {
            roleId = parsed.role.ID;
          } else if (parsed.role_ID?.new) {
            roleId = parsed.role_ID.new;
          } else if (parsed.role_ID?.old) {
            roleId = parsed.role_ID.old;
          }
        } catch (e) { }
      }
      if (roleId) {
        const role = roles.find(r => r.ID === roleId);
        matchesCritical = role ? role.critical : false;
      } else {
        matchesCritical = false;
      }
    }

    return matchesSearch && matchesAction && matchesEntity && matchesActor && matchesDate && matchesCritical;
  });

  const paginatedLogs = filteredLogs.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const getActionChip = (action) => {
    switch (action) {
      case 'CREATE':
        return <Chip label="CREATE" size="small" sx={{ bgcolor: 'success.light', color: 'success.dark', border: '1px solid', borderColor: 'success.main', fontWeight: 600 }} />;
      case 'UPDATE':
        return <Chip label="UPDATE" size="small" sx={{ bgcolor: 'info.light', color: 'info.dark', border: '1px solid', borderColor: 'info.main', fontWeight: 600 }} />;
      case 'DELETE':
        return <Chip label="DELETE" size="small" sx={{ bgcolor: 'error.light', color: 'error.dark', border: '1px solid', borderColor: 'error.main', fontWeight: 600 }} />;
      default:
        return <Chip label={action} size="small" />;
    }
  };

  const formatJSON = (jsonStr) => {
    try {
      const obj = JSON.parse(jsonStr);
      return JSON.stringify(obj, null, 2);
    } catch {
      return jsonStr;
    }
  };

  const formatRestrictionValue = (rawStr) => {
    if (!rawStr || rawStr === '—' || rawStr === '') return '—';
    const typeMatch = rawStr.match(/Type:\s*([^,]+)/);
    const type = typeMatch ? typeMatch[1].trim() : '';
    const valMatch = rawStr.match(/Value:\s*(.+)$/);
    if (!valMatch) return rawStr;
    let val = valMatch[1].trim();

    if (type === 'SINGLE_VALUE') {
      return val;
    } else if (type === 'RANGE') {
      try {
        const parsed = JSON.parse(val);
        if (parsed && typeof parsed === 'object') {
          return `${parsed.from} - ${parsed.to}`;
        }
      } catch { }
    } else if (type === 'MULTI_VALUE') {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) {
          return parsed.join(', ');
        }
      } catch { }
    } else if (type === 'PATTERN' || type === 'CP') {
      return `Pattern: ${val}`;
    }
    return val;
  };

  const renderDetailsTable = (log) => {
    try {
      const parsed = JSON.parse(log.details);

      if (log.action === 'UPDATE') {
        const entries = Object.entries(parsed);
        const generalRows = [];
        const restrictionRows = [];
        console.log(log.details);
        for (const [key, diff] of entries) {
          const oldValRaw = diff && typeof diff === 'object' && 'old' in diff ? String(diff.old) : String(diff);
          const newValRaw = diff && typeof diff === 'object' && 'new' in diff ? String(diff.new) : '';

          if (key.toLowerCase().includes('restriction')) {
            let fieldName = '—';
            let action = 'Changed';
            let oldDisp = oldValRaw;
            let newDisp = newValRaw;

            if (key.startsWith('Restriction Added')) {
              action = 'Added';
              const match = newValRaw.match(/Field:\s*([^,]+)/);
              if (match) fieldName = match[1].trim();
              oldDisp = '—';
              newDisp = formatRestrictionValue(newValRaw);
            } else if (key.startsWith('Restriction Deleted')) {
              action = 'Deleted';
              const match = oldValRaw.match(/Field:\s*([^,]+)/);
              if (match) fieldName = match[1].trim();
              oldDisp = formatRestrictionValue(oldValRaw);
              newDisp = '—';
            } else if (key.startsWith('Restriction Changed')) {
              action = 'Changed';
              const match = key.match(/Restriction Changed \(([^)]+)\)/);
              if (match) fieldName = match[1].trim();
              oldDisp = formatRestrictionValue(oldValRaw);
              newDisp = formatRestrictionValue(newValRaw);
            } else {
              fieldName = key;
              oldDisp = oldValRaw;
              newDisp = newValRaw;
            }

            restrictionRows.push({
              fieldName,
              action,
              oldVal: oldDisp,
              newVal: newDisp
            });
          } else {
            generalRows.push({
              field: key,
              oldVal: oldValRaw,
              newVal: newValRaw
            });
          }
        }
        const renderSectionTable = (title, rows, emptyMessage, isRestriction = false) => (
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}>
              {title}
            </Typography>
            {rows.length > 0 ? (
              <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small">
                  <TableHead sx={{ bgcolor: '#f7f9fb' }}>
                    <TableRow>
                      {isRestriction ? (
                        <>
                          <TableCell sx={{ fontWeight: 600 }}>Restriction Field</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Action</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Old Value</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>New Value</TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell sx={{ fontWeight: 600 }}>Property</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Old Value</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>New Value</TableCell>
                        </>
                      )}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row, index) => (
                      <TableRow key={isRestriction ? index : row.field} hover>
                        {isRestriction ? (
                          <>
                            <TableCell sx={{ fontWeight: 500 }}>{row.fieldName}</TableCell>
                            <TableCell>
                              <Chip
                                label={row.action}
                                size="small"
                                sx={{
                                  fontWeight: 600,
                                  fontSize: 10,
                                  height: 20,
                                  bgcolor: row.action === 'Added' ? 'success.light' : row.action === 'Deleted' ? 'error.light' : 'info.light',
                                  color: row.action === 'Added' ? 'success.dark' : row.action === 'Deleted' ? 'error.dark' : 'info.dark',
                                  border: '1px solid',
                                  borderColor: row.action === 'Added' ? 'success.main' : row.action === 'Deleted' ? 'error.main' : 'info.main'
                                }}
                              />
                            </TableCell>
                            <TableCell sx={{ color: 'error.main', textDecoration: row.action === 'Changed' ? 'line-through' : 'none' }}>{row.oldVal}</TableCell>
                            <TableCell sx={{ color: 'success.main' }}>{row.newVal}</TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell sx={{ fontWeight: 500 }}>{row.field}</TableCell>
                            <TableCell sx={{ color: 'error.main', textDecoration: 'line-through' }}>{row.oldVal || '—'}</TableCell>
                            <TableCell sx={{ color: 'success.main' }}>{row.newVal || '—'}</TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', pl: 1 }}>
                {emptyMessage}
              </Typography>
            )}
          </Box>
        );

        return (
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {renderSectionTable("General Information", generalRows, "No general information changes.", false)}
            {renderSectionTable("Restriction", restrictionRows, "No restriction changes.", true)}
          </Box>
        );
      } else {
        const rows = Object.entries(parsed).map(([field, val]) => ({
          field,
          value: typeof val === 'object' ? JSON.stringify(val) : String(val)
        }));

        return (
          <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: '#f7f9fb' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Property</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.field} hover>
                    <TableCell sx={{ fontWeight: 500, width: '30%' }}>{row.field}</TableCell>
                    <TableCell sx={{ color: 'text.primary', wordBreak: 'break-all' }}>{row.value}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        );
      }
    } catch {
      return (
        <Paper variant="outlined" sx={{ p: 2, bgcolor: '#f2f4f6', borderColor: 'divider', backgroundImage: 'none' }}>
          <pre style={{ margin: 0, fontSize: '0.8125rem', color: '#191c1e', whiteSpace: 'pre-wrap' }}>
            {log.details}
          </pre>
        </Paper>
      );
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
            onClick={loadLogs}
            startIcon={<RefreshCw size={16} />}
            disabled={loading}
            sx={{ borderColor: 'divider', color: 'text.secondary', '&:hover': { borderColor: '#3b82f6', color: '#60a5fa' } }}
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

                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>Time Range</InputLabel>
                  <Select
                    value={dateFilter}
                    label="Time Range"
                    onChange={(e) => { setDateFilter(e.target.value); setPage(0); }}
                  >
                    <MenuItem value="ALL">All Time</MenuItem>
                    <MenuItem value="TODAY">Today</MenuItem>
                    <MenuItem value="WEEK">Past 7 Days</MenuItem>
                    <MenuItem value="MONTH">Past 30 Days</MenuItem>
                    <MenuItem value="CUSTOM">Custom Range...</MenuItem>
                  </Select>
                </FormControl>

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

                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>Action</InputLabel>
                  <Select
                    value={actionFilter}
                    label="Action"
                    onChange={(e) => { setActionFilter(e.target.value); setPage(0); }}
                  >
                    <MenuItem value="ALL">All Actions</MenuItem>
                    <MenuItem value="CREATE">CREATE</MenuItem>
                    <MenuItem value="UPDATE">UPDATE</MenuItem>
                    <MenuItem value="DELETE">DELETE</MenuItem>
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>Entity Type</InputLabel>
                  <Select
                    value={entityFilter}
                    label="Entity Type"
                    onChange={(e) => { setEntityFilter(e.target.value); setPage(0); }}
                  >
                    <MenuItem value="ALL">All Entities</MenuItem>
                    <MenuItem value="Roles">Roles</MenuItem>
                    <MenuItem value="RoleAssignments">Role Assignments</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', flexGrow: 1 }}>
                  <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel id="actor-filter-label">Performed By</InputLabel>
                    <Select
                      labelId="actor-filter-label"
                      id="actor-filter-select"
                      value={actorFilter}
                      label="Performed By"
                      onChange={(e) => { setActorFilter(e.target.value); setPage(0); }}
                    >
                      <MenuItem value="ALL">All Performers</MenuItem>
                      {actorsList.map(actor => (
                        <MenuItem key={actor} value={actor}>{actor}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>

                <FormControlLabel
                  control={
                    <Checkbox
                      checked={criticalFilter}
                      onChange={(e) => { setCriticalFilter(e.target.checked); setPage(0); }}
                      sx={{
                        color: 'rgba(255,255,255,0.3)',
                        '&.Mui-checked': {
                          color: '#f87171',
                        },
                      }}
                    />
                  }
                  label={
                    <Typography variant="body2" sx={{ fontWeight: 500, color: criticalFilter ? '#f87171' : 'text.secondary' }}>
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
              <AlertCircle size={40} color="#f87171" />
              <Typography color="error">{error}</Typography>
              <Button size="small" onClick={loadLogs} sx={{ mt: 1 }}>Try Again</Button>
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
                <AuditDetailsDispatcher log={selectedLog} roles={roles} />
              </DialogContent>
              <DialogActions sx={{ borderTop: '1px solid', borderColor: 'divider', px: 3, py: 2 }}>
                <Button
                  onClick={() => setSelectedLog(null)}
                  variant="contained"
                  sx={{ bgcolor: '#3b82f6', '&:hover': { bgcolor: '#2563eb' } }}
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
