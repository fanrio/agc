import { useState, useEffect } from 'react';
import { Box, Card, Typography, Grid, CircularProgress, Button, List, ListItem, ListItemIcon, ListItemText, Alert, Chip } from '@mui/material';
import { Shield, Users, Building2, Network, Settings, ChevronRight, Zap, Play, Cloud, Activity } from 'lucide-react';
import * as api from '../api';
import { usePermissions } from '../context/PermissionsContext';
import { filterRolesByPermissions } from '../utils/helpers';

export default function HomeView({ setActiveNav, onCreateRole, navigateToRoles }) {
  const { permissions } = usePermissions();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadStats() {
    setLoading(true);
    setError('');
    try {
      const [rawRoles, nodes, assignments, streams, fields, bdcSettings] = await Promise.all([
        api.getRoles(),
        api.getAllOrgNodesFlat(),
        api.getAssignments(),
        api.getStreamsFlat(),
        api.getRestrictionFields(),
        api.getBdcSettings()
      ]);

      const roles = filterRolesByPermissions(rawRoles, permissions);

      // Calculate unique users
      const uniqueUsers = new Set(assignments.map(a => a.userId));

      // Calculate unique users with critical roles
      const usersWithCritical = new Set(
        assignments
          .filter(a => {
            const role = roles.find(r => r.ID === a.role_ID);
            return role && role.critical;
          })
          .map(a => a.userId)
      );

      // Calculate recent roles (sort by createdAt if present, or take last 3)
      const sortedRoles = [...roles]
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, 3);

      const nodeTypeCounts = {};
      nodes.forEach(node => {
        const type = node.type?.name || 'UNKNOWN';
        nodeTypeCounts[type] = (nodeTypeCounts[type] || 0) + 1;
      });

      let rolesWithoutRestriction = 0;
      let rolesWithoutApprover = 0;
      let rolesWithoutAssignment = 0;
      let criticalRoles = 0;

      roles.forEach(role => {
        if (!role.ownRestrictions || role.ownRestrictions.length === 0) {
          rolesWithoutRestriction++;
        }
        if (!role.approvers || role.approvers.length === 0) {
          rolesWithoutApprover++;
        }
        if (!role.assignments || role.assignments.length === 0) {
          rolesWithoutAssignment++;
        }
        if (role.critical) {
          criticalRoles++;
        }
      });

      setStats({
        roleCount: roles.length,
        rolesWithoutRestriction,
        rolesWithoutApprover,
        rolesWithoutAssignment,
        criticalRoles,
        usersWithCritical: usersWithCritical.size,
        nodeCount: nodes.length,
        nodeTypeCounts,
        assignmentCount: assignments.length,
        userCount: uniqueUsers.size,
        streamCount: streams.length,
        fieldCount: fields.length,
        bdcCount: bdcSettings.length,
        recentRoles: sortedRoles
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

  const cards = [
    { label: 'Roles health overview', icon: Activity, color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.04)', border: 'rgba(59, 130, 246, 0.15)', tab: 'roles', size: 12 },
    { label: 'Users & assignments overview', icon: Users, color: '#10b981', bg: 'rgba(16, 185, 129, 0.04)', border: 'rgba(16, 185, 129, 0.15)', tab: 'assignments', size: 8 },
    { label: 'Organizational Nodes', value: stats?.nodeCount || 0, icon: Building2, color: '#a78bfa', bg: 'rgba(167, 139, 250, 0.04)', border: 'rgba(167, 139, 250, 0.15)', tab: 'org', size: 4 },
  ];

  return (
    <Box sx={{ animation: 'fadeIn 0.3s', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Welcome Hero Panel */}
      <Card sx={{ 
        p: 4, 
        background: 'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(167,139,250,0.08) 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <Box sx={{ position: 'relative', zIndex: 2 }}>
          <Typography variant="h4" sx={{ fontWeight: 800, mb: 1, color: 'text.primary' }}>
            Authorization Governance Center
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 650, mb: 3 }}>
            Manage role-based permissions, inheritances, and organizational restrictions dynamically. Create org nodes, map custom restriction fields, and simulate data access configurations.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={onCreateRole} startIcon={<Zap size={15} />}>
              Create Role Wizard
            </Button>
            <Button variant="outlined" onClick={() => setActiveNav('org')} startIcon={<Building2 size={15} />}>
              Manage Org Structure
            </Button>
          </Box>
        </Box>
        {/* Decorative background element */}
        <Box sx={{ 
          position: 'absolute', 
          right: -50, 
          bottom: -50, 
          width: 250, 
          height: 250, 
          borderRadius: '50%', 
          bgcolor: 'rgba(59,130,246,0.05)', 
          filter: 'blur(40px)',
          zIndex: 1
        }} />
      </Card>

      {error && (
        <Alert severity="error" onClose={loadStats} sx={{ border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          {error}
        </Alert>
      )}

      {/* KPI Stats Grid */}
      <Grid container spacing={3} alignItems="stretch">
        {cards.map(card => {
          const Icon = card.icon;
          const isHealthCard = card.label === 'Roles health overview';
          const isUsersCard = card.label === 'Users & assignments overview';
          const isOrgCard = card.label === 'Organizational Nodes';
          return (
            <Grid item xs={12} sm={card.size === 12 ? 12 : 6} md={card.size || 3} key={card.label} sx={{ display: 'flex' }}>
              <Card 
                onClick={() => setActiveNav(card.tab)}
                sx={{ 
                  p: 3, 
                  bgcolor: card.bg, 
                  borderColor: card.border,
                  cursor: 'pointer',
                  height: '100%',
                  width: '100%',
                  minHeight: 155,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    borderColor: card.color,
                    boxShadow: `0 4px 20px -5px ${card.color}25`
                  }
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
                    {card.label}
                  </Typography>
                  <Icon size={20} color={card.color} />
                </Box>
                {isHealthCard && stats ? (
                  <Box sx={{ mt: 1.5 }}>
                    <Grid container spacing={3}>
                      {/* Total Roles */}
                      <Grid 
                        item xs={12} md={2.4} 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (navigateToRoles) navigateToRoles(null);
                          else setActiveNav('roles');
                        }}
                        sx={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: 1,
                          cursor: 'pointer',
                          p: 1.5,
                          borderRadius: 1,
                          transition: 'all 0.2s',
                          '&:hover': {
                            bgcolor: 'rgba(59, 130, 246, 0.08)'
                          }
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}>
                          Total Roles
                        </Typography>
                        <Typography variant="h3" sx={{ fontWeight: 800, color: 'text.primary' }}>
                          {stats.roleCount}
                        </Typography>
                      </Grid>

                      {/* Critical */}
                      <Grid 
                        item xs={12} md={2.4} 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (navigateToRoles) navigateToRoles('critical');
                          else setActiveNav('roles');
                        }}
                        sx={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: 1,
                          cursor: 'pointer',
                          p: 1.5,
                          borderRadius: 1,
                          transition: 'all 0.2s',
                          borderLeft: { xs: 'none', md: '1px solid #e2e8f0' },
                          pl: { xs: 1.5, md: 3 },
                          '&:hover': {
                            bgcolor: 'rgba(59, 130, 246, 0.08)'
                          }
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'error.main' }}>
                          Critical
                        </Typography>
                        <Typography variant="h3" sx={{ fontWeight: 800, color: 'error.main' }}>
                          {stats.criticalRoles}
                        </Typography>
                      </Grid>

                      {/* Unrestricted */}
                      <Grid 
                        item xs={12} md={2.4} 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (navigateToRoles) navigateToRoles('unrestricted');
                          else setActiveNav('roles');
                        }}
                        sx={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: 1,
                          cursor: 'pointer',
                          p: 1.5,
                          borderRadius: 1,
                          transition: 'all 0.2s',
                          borderLeft: { xs: 'none', md: '1px solid #e2e8f0' },
                          pl: { xs: 1.5, md: 3 },
                          '&:hover': {
                            bgcolor: 'rgba(59, 130, 246, 0.08)'
                          }
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}>
                          Unrestricted
                        </Typography>
                        <Typography variant="h3" sx={{ fontWeight: 800, color: 'text.primary' }}>
                          {stats.rolesWithoutRestriction}
                        </Typography>
                      </Grid>
                      
                      {/* No Users */}
                      <Grid 
                        item xs={12} md={2.4} 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (navigateToRoles) navigateToRoles('no-users');
                          else setActiveNav('roles');
                        }}
                        sx={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: 1, 
                          borderLeft: { xs: 'none', md: '1px solid #e2e8f0' }, 
                          pl: { xs: 1.5, md: 3 },
                          cursor: 'pointer',
                          p: 1.5,
                          borderRadius: 1,
                          transition: 'all 0.2s',
                          '&:hover': {
                            bgcolor: 'rgba(59, 130, 246, 0.08)'
                          }
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}>
                          No Users
                        </Typography>
                        <Typography variant="h3" sx={{ fontWeight: 800, color: 'text.primary' }}>
                          {stats.statsWithoutAssignment || stats.rolesWithoutAssignment}
                        </Typography>
                      </Grid>
                      
                      {/* No Approver */}
                      <Grid 
                        item xs={12} md={2.4} 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (navigateToRoles) navigateToRoles('no-approver');
                          else setActiveNav('roles');
                        }}
                        sx={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: 1, 
                          borderLeft: { xs: 'none', md: '1px solid #e2e8f0' }, 
                          pl: { xs: 1.5, md: 3 },
                          cursor: 'pointer',
                          p: 1.5,
                          borderRadius: 1,
                          transition: 'all 0.2s',
                          '&:hover': {
                            bgcolor: 'rgba(59, 130, 246, 0.08)'
                          }
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}>
                          No Approver
                        </Typography>
                        <Typography variant="h3" sx={{ fontWeight: 800, color: 'text.primary' }}>
                          {stats.rolesWithoutApprover}
                        </Typography>
                      </Grid>
                    </Grid>
                  </Box>
                ) : isUsersCard && stats ? (
                  <Box sx={{ mt: 1.5 }}>
                    <Grid container spacing={3}>
                      {/* Unique Users */}
                      <Grid 
                        item xs={12} md={4} 
                        sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}>
                          Unique Users
                        </Typography>
                        <Typography variant="h3" sx={{ fontWeight: 800, color: 'text.primary' }}>
                          {stats.userCount}
                        </Typography>
                      </Grid>

                      {/* Role Assignments */}
                      <Grid 
                        item xs={12} md={4} 
                        sx={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: 1,
                          borderLeft: { xs: 'none', md: '1px solid #e2e8f0' },
                          pl: { xs: 1.5, md: 3 }
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}>
                          Role Assignments
                        </Typography>
                        <Typography variant="h3" sx={{ fontWeight: 800, color: 'text.primary' }}>
                          {stats.assignmentCount}
                        </Typography>
                      </Grid>

                      {/* Users with Critical Roles */}
                      <Grid 
                        item xs={12} md={4} 
                        sx={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: 1,
                          borderLeft: { xs: 'none', md: '1px solid #e2e8f0' },
                          pl: { xs: 1.5, md: 3 }
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'error.main' }}>
                          Users with Critical Roles
                        </Typography>
                        <Typography variant="h3" sx={{ fontWeight: 800, color: 'error.main' }}>
                          {stats.usersWithCritical}
                        </Typography>
                      </Grid>
                    </Grid>
                  </Box>
                ) : isOrgCard && stats?.nodeTypeCounts ? (
                  <Box>
                    <Typography variant="h3" sx={{ fontWeight: 800, color: 'text.primary', mb: 1.5 }}>
                      {card.value}
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {Object.entries(stats.nodeTypeCounts).map(([type, count]) => (
                        <Chip 
                          key={type} 
                          label={`${type}: ${count}`} 
                          size="small" 
                          sx={{ 
                            fontSize: 9, 
                            height: 16, 
                            bgcolor: 'rgba(255,255,255,0.03)', 
                            border: '1px solid rgba(255,255,255,0.06)',
                            color: 'text.secondary' 
                          }} 
                        />
                      ))}
                    </Box>
                  </Box>
                ) : (
                  <Typography variant="h3" sx={{ fontWeight: 800, color: 'text.primary' }}>
                    {card.value}
                  </Typography>
                )}
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {/* Detail Sections */}
      <Grid container spacing={3}>
        {/* Recent Roles */}
        <Grid item xs={12} md={7}>
          <Card sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Recently Created Roles
            </Typography>
            {stats?.recentRoles && stats.recentRoles.length > 0 ? (
              <List sx={{ p: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {stats.recentRoles.map(role => (
                  <ListItem 
                    key={role.ID}
                    onClick={() => setActiveNav('roles')}
                    sx={{ 
                      p: 2, 
                      borderRadius: 1, 
                      bgcolor: 'rgba(255,255,255,0.01)', 
                      border: '1px solid rgba(255,255,255,0.05)',
                      cursor: 'pointer',
                      '&:hover': {
                        borderColor: 'rgba(59,130,246,0.3)',
                        bgcolor: 'rgba(255,255,255,0.02)'
                      }
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <Shield size={16} color={role.type === 'ORG_BASED' ? '#3b82f6' : '#a78bfa'} />
                    </ListItemIcon>
                    <ListItemText 
                      primary={role.name} 
                      primaryTypographyProps={{ fontWeight: 700, fontSize: 13 }}
                      secondary={role.description || 'No description provided'}
                      secondaryTypographyProps={{ fontSize: 11, color: 'text.secondary' }}
                    />
                    <ChevronRight size={15} color="rgba(255,255,255,0.3)" />
                  </ListItem>
                ))}
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No roles created yet. Use the wizard to deploy roles.
              </Typography>
            )}
          </Card>
        </Grid>

        {/* Global Configuration summary */}
        <Grid item xs={12} md={5}>
          <Card sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, height: '100%' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Global Parameters
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Network size={16} color="#3b82f6" />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Streams</Typography>
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {stats?.streamCount || 0}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Settings size={16} color="#a78bfa" />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Restriction Fields</Typography>
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {stats?.fieldCount || 0}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Cloud size={16} color="#10b981" />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>BDC System Connections</Typography>
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {stats?.bdcCount || 0}
                </Typography>
              </Box>
            </Box>
            <Button 
              variant="outlined" 
              color="inherit" 
              fullWidth
              onClick={() => setActiveNav('admin')}
              startIcon={<Settings size={14} />}
              sx={{ mt: 'auto' }}
            >
              Configure Settings
            </Button>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
