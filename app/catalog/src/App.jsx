import { useState, useEffect, useRef } from 'react';
import { 
  Box, 
  AppBar, 
  Toolbar, 
  Typography, 
  Drawer, 
  List, 
  ListItem, 
  ListItemButton, 
  ListItemIcon, 
  ListItemText, 
  CircularProgress, 
  Button
} from '@mui/material';
import { 
  Home, 
  Building2, 
  Shield, 
  Settings, 
  Users, 
  Network, 
  History, 
  LogOut, 
  UserCheck, 
  ShieldCheck 
} from 'lucide-react';
import LoginView from './components/LoginView';
import HomeView from './components/HomeView';
import OrgStructureView from './components/OrgStructureView';
import RolesDashboard from './components/RolesDashboard';
import Wizard from './components/Wizard';
import RoleAssignmentsView from './components/RoleAssignmentsView';
import SystemView from './components/SystemView';
import UsersView from './components/UsersView';
import AppAuthorizationsView from './components/AppAuthorizationsView';
import AuditLogsView from './components/AuditLogsView';
import ReplicationsView from './components/ReplicationsView';
import UserAuthorizationCardDrawer from './components/UserAuthorizationCard/UserAuthorizationCardDrawer';
import { PermissionsProvider, usePermissions } from './context/PermissionsContext';

const DRAWER_WIDTH = 240;

const NAV = [
  { id: 'home',            label: 'Dashboard',             icon: Home },
  { id: 'org',             label: 'Organization',          icon: Building2 },
  { id: 'roles',           label: 'Roles',                 icon: Shield },
  { id: 'assignments',     label: 'Role Assignments',      icon: Users },
  { id: 'audit',           label: 'Audit Logs',            icon: History },
  { id: 'access-profiles', label: 'Access Profiles',       icon: ShieldCheck },
  { id: 'users',           label: 'Manage Users',          icon: UserCheck },
  { id: 'system',          label: 'System',                icon: Settings },
];

function getNavFromHash() {
  const hashRaw = (typeof window !== 'undefined' && window.location.hash ? window.location.hash : '').replace(/^#/, '').trim();
  const hash = hashRaw.split('?')[0].split('/')[0];
  if (['security-profiles', 'security_profiles', 'profiles', 'securityprofiles', 'access-profiles', 'access_profiles', 'accessprofiles'].includes(hash)) {
    return 'access-profiles';
  }
  const validNavs = ['home', 'org', 'roles', 'assignments', 'audit', 'access-profiles', 'users', 'system', 'wizard', 'replications'];
  return validNavs.includes(hash) ? hash : 'home';
}

function AppContent({ simulatedUser, onLogout }) {
  const [activeNav, setActiveNavState]         = useState(getNavFromHash);
  const [wizardContext, setWizardContext]       = useState(null);
  const [rolesFilter, setRolesFilter]           = useState(null);
  const [inspectingUserId, setInspectingUserId] = useState(null);
  const isNavigatingRef                         = useRef(false);
  
  const { permissions, loading } = usePermissions();

  const setActiveNav = (navId) => {
    isNavigatingRef.current = true;
    setActiveNavState(navId);
    if (window.location.hash !== `#${navId}`) {
      window.location.hash = `#${navId}`;
    }
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 50);
  };

  useEffect(() => {
    const handleHashChange = () => {
      if (isNavigatingRef.current) return;
      const nav = getNavFromHash();
      setActiveNavState(nav);
    };
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('popstate', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('popstate', handleHashChange);
    };
  }, []);

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
    if (item.id === 'org') return !!permissions?.canManageOrgRoles;
    if (item.id === 'replications') return !!permissions?.canManageReplications;
    if (item.id === 'audit') return !!permissions?.canViewAuditLogs;
    if (item.id === 'users') return !!permissions?.canManageAppUsers;
    if (item.id === 'access-profiles') return true;
    if (item.id === 'system') return !!permissions?.canManageSettings;
    return true;
  });

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Topbar */}
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, bgcolor: 'background.paper', backgroundImage: 'none', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar sx={{ display: 'flex', justifyContent: 'space-between', minHeight: 64 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Network size={20} color="var(--accent-primary)" />
            <Typography variant="h6" component="div" sx={{ fontWeight: 700, letterSpacing: '0.02em', display: 'flex', alignItems: 'center', color: 'primary.main' }}>
              cortex <Box component="span" sx={{ fontWeight: 300, color: 'text.secondary', ml: 0.5 }}>/ BDC Auth Wizard</Box>
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button
              variant="outlined"
              color="primary"
              size="small"
              startIcon={<ShieldCheck size={16} />}
              onClick={() => setInspectingUserId(simulatedUser || 'admin')}
              sx={{ textTransform: 'none', fontWeight: 600, height: 34, borderRadius: 1.5 }}
            >
              Inspect User Card
            </Button>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  bgcolor: 'primary.light',
                  color: 'primary.contrastText',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  textTransform: 'uppercase'
                }}
              >
                {simulatedUser.charAt(0)}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', lineHeight: 1.2 }}>
                  {simulatedUser.includes('@') ? simulatedUser.split('@')[0].replace('.', ' ') : simulatedUser}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1 }}>
                  {simulatedUser}
                </Typography>
              </Box>
            </Box>

            <Button
              variant="outlined"
              color="error"
              size="small"
              onClick={onLogout}
              startIcon={<LogOut size={14} />}
              sx={{ textTransform: 'none', fontWeight: 600, height: 32, borderRadius: 1.5 }}
            >
              Log Out
            </Button>
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
                    <ListItemText 
                      primary={
                        <Typography sx={{ fontSize: '0.875rem', fontWeight: isActive ? 600 : 500 }}>
                          {item.label}
                        </Typography>
                      }
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        </Box>
      </Drawer>

      {/* Main Content */}
      <Box component="main" sx={{ flexGrow: 1, p: 4, width: `calc(100% - ${DRAWER_WIDTH}px)`, mt: 8 }}>
        {activeNav === 'home'              && <HomeView setActiveNav={setActiveNav} navigateToRoles={navigateToRoles} onCreateRole={() => openWizard()} />}
        {activeNav === 'org'               && (permissions?.isSuperAdmin || permissions?.canManageOrgRoles) && <OrgStructureView onGenerateRole={(nodeId) => openWizard({ orgNodeId: nodeId })} />}
        {activeNav === 'roles'             && <RolesDashboard  onDeriveRole={(role)   => openWizard({ parentRoleId: role.ID })} onEditRole={(role) => openWizard({ roleId: role.ID })} onCreateRole={() => openWizard()} initialFilter={rolesFilter} setInitialFilter={setRolesFilter} />}
        {activeNav === 'wizard'            && <Wizard context={wizardContext ?? {}} onDone={() => setActiveNav('roles')} />}
        {activeNav === 'assignments'       && <RoleAssignmentsView onInspectUser={(uid) => setInspectingUserId(uid)} />}
        {activeNav === 'replications'      && <ReplicationsView />}
        {activeNav === 'audit'             && <AuditLogsView />}
        {activeNav === 'access-profiles' && <UsersView onInspectUser={(uid) => setInspectingUserId(uid)} />}
        {activeNav === 'users'             && <AppAuthorizationsView />}
        {activeNav === 'system'            && <SystemView />}
      </Box>

      {/* Global User Authorization Card Drawer */}
      <UserAuthorizationCardDrawer 
        userId={inspectingUserId} 
        onClose={() => setInspectingUserId(null)} 
      />
    </Box>
  );
}

export default function App() {
  const [simulatedUser, setSimulatedUser] = useState(() => localStorage.getItem('auth_user') || '');
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!localStorage.getItem('auth_user'));

  const handleLoginSuccess = (userId) => {
    setSimulatedUser(userId);
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_user');
    setSimulatedUser('');
    setIsLoggedIn(false);
  };

  if (!isLoggedIn) {
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <PermissionsProvider userId={simulatedUser}>
      <AppContent simulatedUser={simulatedUser} onLogout={handleLogout} />
    </PermissionsProvider>
  );
}
