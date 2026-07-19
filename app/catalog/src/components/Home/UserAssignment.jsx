import React from 'react';
import { Card, Typography, Box, Grid } from '@mui/material';
import { Users, UserCheck, ShieldAlert } from 'lucide-react';

/**
 * UserAssignment subcomponent for Governance Center Homepage.
 * Displays overall user and assignment metrics with premium aesthetics.
 */
export default function UserAssignment({ stats, setActiveNav }) {
  if (!stats) return null;

  const dataItems = [
    {
      label: 'Unique Users',
      value: stats.userCount,
      color: '#10b981',
      bg: 'rgba(16, 185, 129, 0.04)',
      border: 'rgba(16, 185, 129, 0.15)',
      icon: Users
    },
    {
      label: 'Direct Assignments',
      value: stats.assignmentCount,
      color: '#3b82f6',
      bg: 'rgba(59, 130, 246, 0.04)',
      border: 'rgba(59, 130, 246, 0.15)',
      icon: UserCheck
    },
    {
      label: 'Users with Critical Roles',
      value: stats.usersWithCritical,
      color: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.04)',
      border: 'rgba(239, 68, 68, 0.15)',
      icon: ShieldAlert
    }
  ];

  return (
    <Card
      onClick={() => setActiveNav('assignments')}
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
          borderColor: 'rgba(16, 185, 129, 0.4)',
          boxShadow: '0 8px 30px rgba(16, 185, 129, 0.04)'
        }
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ 
            p: 1, 
            borderRadius: 2, 
            bgcolor: 'rgba(16, 185, 129, 0.1)', 
            border: '1px solid rgba(16, 185, 129, 0.2)' 
          }}>
            <Users size={18} color="#10b981" />
          </Box>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Users & Assignments</Typography>
            <Typography variant="caption" color="text.secondary">Identity assignments and authorization scope</Typography>
          </Box>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(3, 1fr)'
          },
          gap: 2,
          width: '100%'
        }}
      >
        {dataItems.map((item) => {
          const Icon = item.icon;
          return (
            <Box
              key={item.label}
              sx={{
                p: 2,
                bgcolor: item.bg,
                border: '1px solid',
                borderColor: item.border,
                borderRadius: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                height: '100%'
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {item.label}
                </Typography>
                <Icon size={12} color={item.color} />
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 900, mt: 'auto', color: item.label.includes('Critical') && item.value > 0 ? item.color : 'text.primary' }}>
                {item.value}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Card>
  );
}
