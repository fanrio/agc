import React from 'react';
import { Card, Typography, Box, Grid, CircularProgress } from '@mui/material';
import { Activity, Shield, ShieldAlert, Ban, UserX, UserCheck } from 'lucide-react';

/**
 * RolesHealth subcomponent for Governance Center Homepage.
 * Displays overall roles database integrity, warnings, and interactive health filters in a single row.
 */
export default function RolesHealth({ stats, setActiveNav, navigateToRoles }) {
  if (!stats) return null;

  // Calculate health score: percentage of roles that have both restrictions and approvers
  const total = stats.roleCount || 0;
  const missingBoth = stats.rolesWithoutRestriction + stats.rolesWithoutApprover;
  const healthPercentage = total 
    ? Math.max(0, Math.round(((total - (missingBoth / 2)) / total) * 100))
    : 100;

  const handleNav = (filter) => {
    if (navigateToRoles) navigateToRoles(filter);
    else setActiveNav('roles');
  };

  const healthItems = [
    {
      label: 'Total Active Roles',
      value: stats.roleCount,
      color: '#3b82f6',
      bg: 'rgba(59, 130, 246, 0.04)',
      border: 'rgba(59, 130, 246, 0.15)',
      icon: Shield,
      filter: null
    },
    {
      label: 'Critical Roles',
      value: stats.criticalRoles,
      color: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.05)',
      border: 'rgba(239, 68, 68, 0.25)',
      icon: ShieldAlert,
      filter: 'critical'
    },
    {
      label: 'Unrestricted Roles',
      value: stats.rolesWithoutRestriction,
      color: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.05)',
      border: 'rgba(245, 158, 11, 0.25)',
      icon: Ban,
      filter: 'unrestricted'
    },
    {
      label: 'No Assigned Users',
      value: stats.statsWithoutAssignment || stats.rolesWithoutAssignment,
      color: '#3b82f6',
      bg: 'rgba(59, 130, 246, 0.05)',
      border: 'rgba(59, 130, 246, 0.25)',
      icon: UserX,
      filter: 'no-users'
    },
    {
      label: 'No Approvers Set',
      value: stats.rolesWithoutApprover,
      color: '#10b981',
      bg: 'rgba(16, 185, 129, 0.05)',
      border: 'rgba(16, 185, 129, 0.25)',
      icon: UserCheck,
      filter: 'no-approver'
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
        width: '100%'
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ 
            p: 1, 
            borderRadius: 2, 
            bgcolor: 'rgba(59, 130, 246, 0.1)', 
            border: '1px solid rgba(59, 130, 246, 0.2)' 
          }}>
            <Activity size={18} color="#3b82f6" />
          </Box>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Roles Health Status</Typography>
            <Typography variant="caption" color="text.secondary">Database integrity and exception coverage</Typography>
          </Box>
        </Box>

        {/* Health Score circular indicator */}
        <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <CircularProgress
              variant="determinate"
              value={100}
              size={36}
              thickness={4}
              sx={{ color: 'rgba(255,255,255,0.05)' }}
            />
            <CircularProgress
              variant="determinate"
              value={healthPercentage}
              size={36}
              thickness={4}
              sx={{
                color: healthPercentage > 80 ? '#10b981' : healthPercentage > 50 ? '#f59e0b' : '#ef4444',
                position: 'absolute',
                left: 0
              }}
            />
            <Box
              sx={{
                top: 0,
                left: 0,
                bottom: 0,
                right: 0,
                position: 'absolute',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography variant="caption" sx={{ fontSize: 9, fontWeight: 800 }}>
                {healthPercentage}%
              </Typography>
            </Box>
          </Box>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
            Health Score
          </Typography>
        </Box>
      </Box>

      {/* CSS Grid layout that spans exactly 5 equal columns on desktop, filling 100% width */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            md: 'repeat(5, 1fr)'
          },
          gap: 2,
          width: '100%'
        }}
      >
        {healthItems.map((item) => {
          const Icon = item.icon;
          return (
            <Card
              key={item.label}
              onClick={() => handleNav(item.filter)}
              sx={{
                p: 2,
                height: '100%',
                cursor: 'pointer',
                bgcolor: item.bg,
                border: '1px solid',
                borderColor: item.border,
                borderRadius: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'all 0.2s ease-in-out',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  borderColor: item.color,
                  boxShadow: `0 4px 15px ${item.color}10`
                }
              }}
            >
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, display: 'block', minHeight: 18, lineHeight: 1.1 }}>
                  {item.label}
                </Typography>
                <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5, color: item.value > 0 && item.filter ? item.color : 'text.primary' }}>
                  {item.value}
                </Typography>
              </Box>
              <Box sx={{ 
                p: 1, 
                borderRadius: 1.5, 
                bgcolor: `${item.color}15`, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center' 
              }}>
                <Icon size={16} color={item.color} />
              </Box>
            </Card>
          );
        })}
      </Box>
    </Card>
  );
}
