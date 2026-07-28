import React from 'react';
import { Card, Typography, Box, Chip } from '@mui/material';
import { Building2 } from 'lucide-react';

/**
 * OrganizationalNodes subcomponent for Governance Center Homepage.
 * Displays overall org nodes count and distribution by category tags.
 */
export default function OrganizationalNodes({ stats, setActiveNav }) {
  if (!stats) return null;

  const typeCounts = stats.nodeTypeCounts || {};

  return (
    <Card
      onClick={() => setActiveNav('org')}
      sx={{
        p: 3,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 3,
        cursor: 'pointer',
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'all 0.25s ease-in-out',
        '&:hover': {
          transform: 'translateY(-4px)',
          borderColor: 'rgba(167, 139, 250, 0.4)',
          boxShadow: '0 8px 30px rgba(167, 139, 250, 0.04)'
        }
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ 
            p: 1, 
            borderRadius: 2, 
            bgcolor: 'rgba(167, 139, 250, 0.1)', 
            border: '1px solid rgba(167, 139, 250, 0.2)' 
          }}>
            <Building2 size={18} color="#a78bfa" />
          </Box>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Organizational Structure</Typography>
            <Typography variant="caption" color="text.secondary">Hierarchy nodes and business categories</Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Typography variant="h3" sx={{ fontWeight: 900, color: 'text.primary', lineHeight: 1 }}>
            {stats.nodeCount || 0}
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>
            Total Nodes
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
          {Object.entries(typeCounts).length > 0 ? (
            Object.entries(typeCounts).map(([type, count]) => (
              <Chip
                key={type}
                label={`${type}: ${count}`}
                size="small"
                sx={{
                  fontSize: 10,
                  fontWeight: 600,
                  height: 22,
                  bgcolor: 'rgba(167, 139, 250, 0.05)',
                  border: '1px solid rgba(167, 139, 250, 0.15)',
                  color: '#a78bfa',
                  px: 0.5,
                  borderRadius: 1.5
                }}
              />
            ))
          ) : (
            <Typography variant="caption" color="text.secondary">
              No organizational nodes defined yet.
            </Typography>
          )}
        </Box>
      </Box>
    </Card>
  );
}
