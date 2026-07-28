import React from 'react';
import { Card, Typography, Box, Button } from '@mui/material';
import { Settings, Network, Sliders, Cloud } from 'lucide-react';

/**
 * GlobalParameters subcomponent for Governance Center Homepage.
 * Renders global system thresholds and endpoints configurations.
 */
export default function GlobalParameters({ stats, setActiveNav }) {
  if (!stats) return null;

  const parameters = [
    {
      label: 'Access Domains',
      value: stats.accessDomainCount || 0,
      icon: Network,
      color: '#3b82f6'
    },
    {
      label: 'Restriction Fields',
      value: stats.fieldCount || 0,
      icon: Sliders,
      color: '#a78bfa'
    },
    {
      label: 'BDC System Connections',
      value: stats.bdcCount || 0,
      icon: Cloud,
      color: '#10b981'
    }
  ];

  return (
    <Card
      sx={{
        p: 3,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 3,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 2.5
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ 
          p: 1, 
          borderRadius: 2, 
          bgcolor: 'rgba(59, 130, 246, 0.1)', 
          border: '1px solid rgba(59, 130, 246, 0.2)' 
        }}>
          <Settings size={18} color="#3b82f6" />
        </Box>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Global Parameters</Typography>
          <Typography variant="caption" color="text.secondary">System boundaries and external connections</Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {parameters.map((param) => {
          const Icon = param.icon;
          return (
            <Box 
              key={param.label}
              sx={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                p: 1.5,
                borderRadius: 2,
                bgcolor: 'rgba(255,255,255,0.01)',
                border: '1px solid rgba(255,255,255,0.04)'
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ 
                  p: 0.75, 
                  borderRadius: 1, 
                  bgcolor: `${param.color}10` 
                }}>
                  <Icon size={14} color={param.color} />
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                  {param.label}
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 800, color: param.color }}>
                {param.value}
              </Typography>
            </Box>
          );
        })}
      </Box>

      <Button
        variant="outlined"
        color="inherit"
        fullWidth
        onClick={() => setActiveNav('admin')}
        startIcon={<Settings size={14} />}
        sx={{ 
          mt: 'auto', 
          borderColor: 'rgba(255,255,255,0.12)', 
          '&:hover': {
            borderColor: 'text.secondary',
            bgcolor: 'rgba(255,255,255,0.02)'
          }
        }}
      >
        Configure Settings
      </Button>
    </Card>
  );
}
