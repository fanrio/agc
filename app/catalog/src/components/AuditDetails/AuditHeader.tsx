import React from 'react';
import { Box, Typography, Chip, Paper } from '@mui/material';
import { User, Clock } from 'lucide-react';

export default function AuditHeader({ log, title, subtitle }) {
  const timestamp = log?.createdAt ? new Date(log.createdAt).toLocaleString() : '—';
  const performedBy = log?.createdBy || 'System';
  const action = log?.action || 'EVENT';

  return (
    <Paper 
      variant="outlined" 
      sx={{ 
        p: 2, 
        mb: 3, 
        bgcolor: 'action.hover', 
        borderRadius: 1.5, 
        borderColor: 'divider',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 2
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
            {title || `${log?.entityName || 'Entity'} Event`}
          </Typography>
          <Chip 
            label={action} 
            size="small"
            sx={{
              fontWeight: 700,
              fontSize: 11,
              height: 22,
              bgcolor: action === 'CREATE' ? 'success.light' : action === 'DELETE' ? 'error.light' : 'info.light',
              color: action === 'CREATE' ? 'success.dark' : action === 'DELETE' ? 'error.dark' : 'info.dark',
              border: '1px solid',
              borderColor: action === 'CREATE' ? 'success.main' : action === 'DELETE' ? 'error.main' : 'info.main'
            }}
          />
        </Box>
        {subtitle && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <User size={16} color="#60a5fa" />
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1 }}>
              Performed By
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
              {performedBy}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Clock size={16} color="#60a5fa" />
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1 }}>
              Timestamp
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
              {timestamp}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}
