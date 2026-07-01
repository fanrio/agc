import { useState, useEffect } from 'react';
import { Box, AppBar, Toolbar, Typography, Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Divider, FormControl, Select, MenuItem } from '@mui/material';
import { Home, Building2, Shield, Settings, Users, Network, History, RefreshCw } from 'lucide-react';
import * as api from './api';
import HomeView from './components/HomeView';
import OrgStructureView from './components/OrgStructureView';
import RolesDashboard from './components/RolesDashboard';
import Wizard from './components/Wizard';
import RoleAssignmentsView from './components/RoleAssignmentsView';
import AdministrationView from './components/AdministrationView';
import AuditLogsView from './components/AuditLogsView';
import ReplicationsView from './components/ReplicationsView';

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

export default function App() {
  const [activeNav, setActiveNav]         = useState('home');
  const [wizardContext, setWizardContext] = useState(null); // { parentRoleId?, orgNodeId? }
  const [rolesFilter, setRolesFilter]     = useState(null);
  
  // Simulated Logged-In User access authorizations
  const [simulatedUser, setSimulatedUser] = useState('jdoe');
  const [permissions, setPermissions] = useState({
    canManageOrgRoles: true,
    canManageSingleRoles: true,
    canManageDerivedRoles: true,
    managedDerivedRolesScope: 'ALL',
    canAssignRoles: true
  });

  const loadPermissions = async () => {
    try {
      const authList = await api.getAppAuthorizations();
      if (!authList || authList.length === 0) {
        // Open Demo Mode: everyone has all access
        setPermissions({
          canManageOrgRoles: true,
          canManageSingleRoles: true,
          canManageDerivedRoles: true,
          managedDerivedRolesScope: 'ALL',
          canAssignRoles: true
        });
      } else {
        const userAuth = authList.find(a => a.userId.toLowerCase() === simulatedUser.toLowerCase());
        if (userAuth) {
          setPermissions({
            canManageOrgRoles: userAuth.canManageOrgRoles,
            canManageSingleRoles: userAuth.canManageSingleRoles,
            canManageDerivedRoles: userAuth.canManageDerivedRoles,
            managedDerivedRolesScope: userAuth.managedDerivedRolesScope || 'ALL',
            canAssignRoles: userAuth.canAssignRoles
          });
        } else {
          // Not found -> no admin permissions
          setPermissions({
            canManageOrgRoles: false,
            canManageSingleRoles: false,
            canManageDerivedRoles: false,
            managedDerivedRolesScope: '',
            canAssignRoles: false
          });
        }
      }
    } catch (e) {
      console.error('Failed to load application authorizations:', e);
    }
  };

  useEffect(() => {
    loadPermissions();
  }, [simulatedUser, activeNav]);

  function navigateToRoles(filter = null) {
    setRolesFilter(filter);
    setActiveNav('roles');
  }

  function openWizard(ctx = {}) {
    setWizardContext(ctx);
    setActiveNav('wizard');
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Topbar */}
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, bgcolor: 'background.paper', backgroundImage: 'none', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar sx={{ display: 'flex', justifyContent: 'space-between', minHeight: 64 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Network size={20} color="#0F172A" />
            <Typography variant="h6" component="div" sx={{ fontWeight: 700, letterSpacing: '0.02em', display: 'flex', alignItems: 'center', color: 'primary.main' }}>
              fanrio <Box component="span" sx={{ fontWeight: 300, color: 'text.secondary', ml: 0.5 }}>/ BDC Auth Wizard</Box>
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <Select
                value={simulatedUser}
                onChange={(e) => setSimulatedUser(e.target.value)}
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
            {NAV.map(item => {
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
        {activeNav === 'home'        && <HomeView setActiveNav={setActiveNav} navigateToRoles={navigateToRoles} onCreateRole={() => openWizard()} permissions={permissions} />}
        {activeNav === 'org'         && <OrgStructureView onGenerateRole={(nodeId) => openWizard({ orgNodeId: nodeId })} permissions={permissions} />}
        {activeNav === 'roles'       && <RolesDashboard  onDeriveRole={(roleId)   => openWizard({ parentRoleId: roleId })} onEditRole={(roleId) => openWizard({ roleId })} onCreateRole={() => openWizard()} initialFilter={rolesFilter} setInitialFilter={setRolesFilter} permissions={permissions} />}
        {activeNav === 'wizard'      && <Wizard context={wizardContext ?? {}} onDone={() => setActiveNav('roles')} permissions={permissions} />}
        {activeNav === 'assignments' && <RoleAssignmentsView permissions={permissions} />}
        {activeNav === 'replications' && <ReplicationsView />}
        {activeNav === 'audit'       && <AuditLogsView />}
        {activeNav === 'admin'       && <AdministrationView />}
      </Box>
    </Box>
  );
}
