import { useState } from 'react';
import { Box, AppBar, Toolbar, Typography, Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText, FormControl, Select, MenuItem, CircularProgress } from '@mui/material';
import { Home, Building2, Shield, Settings, Users, Network, History, RefreshCw } from 'lucide-react';
import HomeView from './components/HomeView';
import OrgStructureView from './components/OrgStructureView';
import RolesDashboard from './components/RolesDashboard';
import Wizard from './components/Wizard';
import RoleAssignmentsView from './components/RoleAssignmentsView';
import AdministrationView from './components/AdministrationView';
import AuditLogsView from './components/AuditLogsView';
import ReplicationsView from './components/ReplicationsView';
import { PermissionsProvider, usePermissions } from './context/PermissionsContext';

const DRAWER_WIDTH = 240;

const NAV = [
  { id: 'home',        label: 'Home Dashboard',      icon: Home },
  { id: 'org',         label: 'Organization',        icon: Building2 },
  { id: 'roles',       label: 'Roles',               icon: Shield },
  { id: 'assignments', label: 'Role Assignments',    icon: Users },
  { id: 'replications',label: 'Replications',         icon: RefreshCw },
  { id: 'audit',       label: 'Audit Logs',          icon: History },
  { id: 'admin',       label: 'Administration',      icon: Settings },
];

function AppContent({ simulatedUser, setSimulatedUser }) {
  const [activeNav, setActiveNav]         = useState('home');
  const [wizardContext, setWizardContext] = useState(null); // { parentRoleId?, orgNodeId? }
  const [rolesFilter, setRolesFilter]     = useState(null);
  
  const { permissions, loading } = usePermissions();

  function navigateToRoles(filter = null) {
    setRolesFilter(filter);
    setActiveNav('roles');
  }

  function openWizard(ctx = {}) {
    setWizardContext(ctx);
    setActiveNav('wizard');
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', bgcolor: 'background.default' }}>
        <CircularProgress size={40} />
      </Box>
    );
  }

  // Filter NAV items based on permissions
  const filteredNav = NAV.filter(item => {
    if (permissions?.isSuperAdmin) return true;
    if (item.id === 'replications') return !!permissions?.canManageReplications;
    if (item.id === 'audit') return !!permissions?.canViewAuditLogs;
    if (item.id === 'admin') return !!permissions?.canManageSettings || !!permissions?.canManageAppUsers;
    return true;
  });

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Topbar */}
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, bgcolor: 'background.paper', backgroundImage: 'none', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar sx={{ display: 'flex', justifyContent: 'space-between', minHeight: 64 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Network size={20} color="#0F172A" />
            <Typography variant="h6" component="div" sx={{ fontWeight: 700, letterSpacing: '0.02em', display: 'flex', alignItems: 'center', color: 'primary.main' }}>
              cortex <Box component="span" sx={{ fontWeight: 300, color: 'text.secondary', ml: 0.5 }}>/ BDC Auth Wizard</Box>
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <Select
                value={simulatedUser}
                onChange={(e) => {
                  setSimulatedUser(e.target.value);
                  setActiveNav('home'); // Go to home when user switches to refresh state
                }}
                sx={{ 
                  height: 32, 
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  bgcolor: 'background.default',
                  '& .MuiSelect-select': { py: 0.5 }
                }}
              >
                <MenuItem value="jdoe">John Doe (jdoe)</MenuItem>
                <MenuItem value="asmith">Alice Smith (asmith)</MenuItem>
                <MenuItem value="bobm">Bob Martin (bobm)</MenuItem>
                <MenuItem value="cwhite">Charlie White (cwhite)</MenuItem>
                <MenuItem value="admin">System Admin (admin)</MenuItem>
              </Select>
            </FormControl>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#10b981', display: 'inline-block' }} />
              <Typography variant="body2" color="text.secondary">CAP Connected · SQLite (mock)</Typography>
            </Box>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Sidebar */}
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: DRAWER_WIDTH, boxSizing: 'border-box', bgcolor: 'background.paper', borderRight: '1px solid', borderColor: 'divider' },
        }}
      >
        <Toolbar /> {/* Spacer below topbar */}
        <Box sx={{ overflow: 'auto', p: 2 }}>
          <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: 'text.secondary', fontWeight: 600, display: 'block', mb: 2, px: 1 }}>
            Navigation
          </Typography>
          <List sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, p: 0 }}>
            {filteredNav.map(item => {
              const isActive = activeNav === item.id;
              return (
                <ListItem key={item.id} disablePadding>
                  <ListItemButton
                     onClick={() => { setActiveNav(item.id); if (item.id !== 'wizard') setWizardContext(null); }}
                    sx={{
                      borderRadius: 1,
                      py: 1,
                      px: 1.5,
                      bgcolor: isActive ? '#f2f4f6' : 'transparent',
                      border: '1px solid',
                      borderColor: isActive ? 'divider' : 'transparent',
                      color: isActive ? 'primary.main' : 'text.secondary',
                      transition: 'all 0.15s ease-in-out',
                      '&:hover': {
                        bgcolor: isActive ? '#eceef0' : 'rgba(0, 0, 0, 0.04)',
                        color: isActive ? 'primary.main' : 'text.primary',
                      }
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}>
                      <item.icon size={18} />
                    </ListItemIcon>
                    <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: '0.875rem', fontWeight: isActive ? 600 : 500 }} />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        </Box>
      </Drawer>

      {/* Main Content */}
      <Box component="main" sx={{ flexGrow: 1, p: 4, width: `calc(100% - ${DRAWER_WIDTH}px)`, mt: 8 }}>
        {activeNav === 'home'        && <HomeView setActiveNav={setActiveNav} navigateToRoles={navigateToRoles} onCreateRole={() => openWizard()} />}
        {activeNav === 'org'         && <OrgStructureView onGenerateRole={(nodeId) => openWizard({ orgNodeId: nodeId })} />}
        {activeNav === 'roles'       && <RolesDashboard  onDeriveRole={(role)   => openWizard({ parentRoleId: role.ID })} onEditRole={(role) => openWizard({ roleId: role.ID })} onCreateRole={() => openWizard()} initialFilter={rolesFilter} setInitialFilter={setRolesFilter} />}
        {activeNav === 'wizard'      && <Wizard context={wizardContext ?? {}} onDone={() => setActiveNav('roles')} />}
        {activeNav === 'assignments' && <RoleAssignmentsView />}
        {activeNav === 'replications' && <ReplicationsView />}
        {activeNav === 'audit'       && <AuditLogsView />}
        {activeNav === 'admin'       && <AdministrationView />}
      </Box>
    </Box>
  );
}

export default function App() {
  const [simulatedUser, setSimulatedUser] = useState('jdoe');

  return (
    <PermissionsProvider userId={simulatedUser}>
      <AppContent simulatedUser={simulatedUser} setSimulatedUser={setSimulatedUser} />
    </PermissionsProvider>
  );
}
