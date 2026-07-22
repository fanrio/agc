import React from 'react';
import { 
  Box, 
  Typography, 
  Table, 
  TableBody, 
  TableCell, 
  TableContainer, 
  TableHead, 
  TableRow, 
  Chip, 
  Paper 
} from '@mui/material';
import AuditHeader from './AuditHeader';

function formatValue(val) {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'True' : 'False';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export default function RoleAssignmentAuditDetails({ log, roles = [] }) {
  let details = {};
  try {
    details = typeof log.details === 'string' ? JSON.parse(log.details) : (log.details || {});
  } catch (e) {
    details = { raw: log.details };
  }

  const action = log.action;

  // Determine user ID and user name
  const userId = details.userId || (log.targetName && log.targetName.includes('@') ? log.targetName : log.recordId);
  let userName = details.userName || details.user_ID;
  if (!userName && log.targetName && !log.targetName.includes('@')) {
    userName = log.targetName;
  }
  if (!userName) {
    userName = userId;
  }

  // Determine role name (lookup from roles list if details only has UUID)
  let roleName = details.roleName || details.role_name || details.role?.name;
  const roleId = details.role_ID || details.roleId;

  if (!roleName && roleId && Array.isArray(roles) && roles.length > 0) {
    const matchedRole = roles.find(r => r.ID === roleId);
    if (matchedRole) {
      roleName = matchedRole.name;
    }
  }

  if (!roleName && log.targetName && log.targetName !== userName && log.targetName !== userId && !log.targetName.includes('@')) {
    roleName = log.targetName;
  }

  const rows = [
    { label: 'User Name', val: userName },
    { label: 'User ID', val: userId },
    { label: 'Role Name', val: roleName || roleId || '—' }
  ].filter(r => r.val !== '—');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <AuditHeader 
        log={log} 
        title="Role Assignment Event" 
        subtitle={`Assignment Record ID: ${log.recordId}`}
      />
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
          <Typography 
            variant="subtitle2" 
            sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}
          >
            Role Assignment Event
          </Typography>
          <Chip 
            label={action === 'CREATE' ? 'Assigned' : action === 'DELETE' ? 'Unassigned' : action}
            size="small"
            sx={{
              fontWeight: 600,
              bgcolor: action === 'CREATE' ? 'success.light' : action === 'DELETE' ? 'error.light' : 'info.light',
              color: action === 'CREATE' ? 'success.dark' : action === 'DELETE' ? 'error.dark' : 'info.dark',
              border: '1px solid',
              borderColor: action === 'CREATE' ? 'success.main' : action === 'DELETE' ? 'error.main' : 'info.main'
            }}
          />
        </Box>

        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
          <Table size="small">
            <TableHead sx={{ bgcolor: 'action.hover' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, width: '35%' }}>Property</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Value</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row, idx) => (
                <TableRow key={idx} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{row.label}</TableCell>
                  <TableCell sx={{ color: 'text.primary' }}>{formatValue(row.val)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      {/* Raw diff fields if UPDATE */}
      {action === 'UPDATE' && typeof details === 'object' && (
        <Box>
          <Typography 
            variant="subtitle2" 
            sx={{ fontWeight: 700, mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}
          >
            Modified Fields
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: 'action.hover' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Field</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Old Value</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>New Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(details).filter(([k]) => k !== 'roleName').map(([key, diff], idx) => {
                  const oldVal = diff && typeof diff === 'object' && 'old' in diff ? diff.old : undefined;
                  const newVal = diff && typeof diff === 'object' && 'new' in diff ? diff.new : diff;
                  return (
                    <TableRow key={idx} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{key}</TableCell>
                      <TableCell sx={{ color: 'error.main' }}>{formatValue(oldVal)}</TableCell>
                      <TableCell sx={{ color: 'success.main' }}>{formatValue(newVal)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </Box>
  );
}
