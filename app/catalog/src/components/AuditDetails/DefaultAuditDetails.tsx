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
  Paper,
  Chip
} from '@mui/material';
import AuditHeader from './AuditHeader';
import { parseLogDetails, formatAuditValue } from './auditUtils';

const formatVal = (val) => formatAuditValue(val, true);

export default function DefaultAuditDetails({ log }) {
  const details = parseLogDetails(log);

  const entries = Object.entries(details);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <AuditHeader 
        log={log} 
        title={`${log.entityName || 'Entity'} Event`} 
        subtitle={`Record ID: ${log.recordId}`}
      />

      {entries.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          No additional detail properties recorded.
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
          <Table size="small">
            <TableHead sx={{ bgcolor: 'action.hover' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, width: '35%' }}>Property</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Value</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map(([key, val], idx) => (
                <TableRow key={idx} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{key}</TableCell>
                  <TableCell sx={{ color: 'text.primary', wordBreak: 'break-word' }}>
                    {formatVal(val)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
