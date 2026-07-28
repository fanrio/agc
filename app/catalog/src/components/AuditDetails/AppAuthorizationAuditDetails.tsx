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

export default function AppAuthorizationAuditDetails({ log }) {
  let details = {};
  try {
    details = typeof log.details === 'string' ? JSON.parse(log.details) : (log.details || {});
  } catch (e) {
    details = { raw: log.details };
  }

  const action = log.action;
  const targetUser = details.userId || log.targetName || log.recordId;

  // Split into permission flags and metadata
  const flagEntries = [];
  const metaEntries = [];

  for (const [key, val] of Object.entries(details)) {
    if (key.startsWith('can') || key.startsWith('is') || key === 'allowedEnvironments') {
      flagEntries.push({ key, val });
    } else {
      metaEntries.push({ key, val });
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <AuditHeader 
        log={log} 
        title={`App Authorizations: ${targetUser}`} 
        subtitle={`Record ID: ${log.recordId}`}
      />

      {/* Permission Flags Table */}
      {flagEntries.length > 0 && (
        <Box>
          <Typography 
            variant="subtitle2" 
            sx={{ fontWeight: 700, mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}
          >
            Permission Flags & Scopes
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: 'action.hover' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Permission Flag</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>
                    {action === 'UPDATE' ? 'Old Value' : 'Status / Value'}
                  </TableCell>
                  {action === 'UPDATE' && <TableCell sx={{ fontWeight: 600 }}>New Value</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {flagEntries.map(({ key, val }, idx) => {
                  const oldVal = val && typeof val === 'object' && 'old' in val ? val.old : val;
                  const newVal = val && typeof val === 'object' && 'new' in val ? val.new : undefined;
                  const displayVal = action === 'UPDATE' ? oldVal : val;

                  return (
                    <TableRow key={idx} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{key}</TableCell>
                      <TableCell>
                        {typeof displayVal === 'boolean' ? (
                          <Chip 
                            label={displayVal ? 'Granted' : 'Revoked'} 
                            size="small"
                            sx={{
                              fontWeight: 600,
                              height: 20,
                              fontSize: 10,
                              bgcolor: displayVal ? 'success.light' : 'action.disabledBackground',
                              color: displayVal ? 'success.dark' : 'text.disabled'
                            }}
                          />
                        ) : (
                          formatValue(displayVal)
                        )}
                      </TableCell>
                      {action === 'UPDATE' && (
                        <TableCell>
                          {typeof newVal === 'boolean' ? (
                            <Chip 
                              label={newVal ? 'Granted' : 'Revoked'} 
                              size="small"
                              sx={{
                                fontWeight: 600,
                                height: 20,
                                fontSize: 10,
                                bgcolor: newVal ? 'success.light' : 'action.disabledBackground',
                                color: newVal ? 'success.dark' : 'text.disabled'
                              }}
                            />
                          ) : (
                            formatValue(newVal)
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* Metadata Entries */}
      {metaEntries.length > 0 && (
        <Box>
          <Typography 
            variant="subtitle2" 
            sx={{ fontWeight: 700, mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}
          >
            Record Metadata
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: 'action.hover' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, width: '35%' }}>Property</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {metaEntries.map(({ key, val }, idx) => (
                  <TableRow key={idx} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{key}</TableCell>
                    <TableCell sx={{ color: 'text.primary' }}>{formatValue(val)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </Box>
  );
}
