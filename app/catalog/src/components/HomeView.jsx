import { useState, useEffect } from 'react';
import { Box, Card, Typography, Grid, CircularProgress, Alert } from '@mui/material';
import * as api from '../api';
import { usePermissions } from '../context/PermissionsContext';
import { filterRolesByPermissions } from '../utils/helpers';

// Import newly extracted subcomponents
import RolesHealth from './Home/RolesHealth';
import UserAssignment from './Home/UserAssignment';
import OrganizationalNodes from './Home/OrganizationalNodes';
import RecentlyCreatedRoles from './Home/RecentlyCreatedRoles';
import GlobalParameters from './Home/GlobalParameters';

/**
 * Orchestrator View for Governance Center Homepage.
 * Fetches dashboard statistics and metrics and lays out subcomponents in a modern grid.
 */
export default function HomeView({ setActiveNav, navigateToRoles }) {
  const { permissions } = usePermissions();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadStats() {
    setLoading(true);
    setError('');
    try {
      const [kpisResponse, rawRecentRoles] = await Promise.all([
        api.getDashboardKpis(),
        api.getRecentRoles()
      ]);

      const kpis = JSON.parse(kpisResponse);
      const recentRoles = filterRolesByPermissions(rawRecentRoles, permissions);

      setStats({
        ...kpis,
        recentRoles
      });
    } catch (e) {
      setError(`Failed to load dashboard statistics: ${e.message}`);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadStats();
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress size={40} />
      </Box>
    );
  }

  return (
    <Box sx={{ animation: 'fadeIn 0.3s', display: 'flex', flexDirection: 'column', gap: 3.5 }}>
      {/* Welcome Hero Panel */}
      <Card 
        sx={{
          p: 4,
          background: 'linear-gradient(135deg, rgba(59,130,246,0.06) 0%, rgba(167,139,250,0.06) 100%)',
          border: '1px solid rgba(255,255,255,0.05)',
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 4
        }}
      >
        <Box sx={{ position: 'relative', zIndex: 2 }}>
          <Typography variant="h4" sx={{ fontWeight: 900, mb: 1, color: 'text.primary', letterSpacing: '-0.02em' }}>
            Authorization Governance Center
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 650 }}>
            Manage role-based permissions, inheritances, and organizational restrictions dynamically. Create org nodes, map custom restriction fields, and simulate data access configurations.
          </Typography>
        </Box>
        {/* Decorative background element */}
        <Box sx={{
          position: 'absolute',
          right: -50,
          bottom: -50,
          width: 250,
          height: 250,
          borderRadius: '50%',
          bgcolor: 'rgba(59,130,246,0.03)',
          filter: 'blur(50px)',
          zIndex: 1
        }} />
      </Card>

      {error && (
        <Alert severity="error" onClose={loadStats} sx={{ border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          {error}
        </Alert>
      )}

      {/* KPI Stats Grid - Roles Health */}
      <Box sx={{ width: '100%' }}>
        <RolesHealth 
          stats={stats} 
          setActiveNav={setActiveNav} 
          navigateToRoles={navigateToRoles} 
        />
      </Box>

      {/* Secondary metrics row: User assignments & Org structure */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: 3.5,
          width: '100%'
        }}
      >
        <UserAssignment stats={stats} setActiveNav={setActiveNav} />
        <OrganizationalNodes stats={stats} setActiveNav={setActiveNav} />
      </Box>

      {/* Details sections row: Recent roles & Configuration parameter widgets */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '7fr 5fr' },
          gap: 3.5,
          width: '100%'
        }}
      >
        <RecentlyCreatedRoles stats={stats} setActiveNav={setActiveNav} />
        <GlobalParameters stats={stats} setActiveNav={setActiveNav} />
      </Box>
    </Box>
  );
}
