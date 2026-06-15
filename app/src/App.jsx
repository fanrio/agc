import { useState, useEffect } from 'react';
import { ShellBar, SideNavigation, SideNavigationItem, Page, FlexBox, Select, Option, Icon } from '@ui5/webcomponents-react';
import '@ui5/webcomponents-icons/dist/AllIcons.js';
import * as api from './api';
import HomeView from './components/HomeView';
import OrgStructureView from './components/OrgStructureView';
import RolesDashboard from './components/RolesDashboard';
import Wizard from './components/Wizard';
import RoleAssignmentsView from './components/RoleAssignmentsView';
import AdministrationView from './components/AdministrationView';
import AuditLogsView from './components/AuditLogsView';

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
          canAssignRoles: true
        });
      } else {
        const userAuth = authList.find(a => a.userId.toLowerCase() === simulatedUser.toLowerCase());
        if (userAuth) {
          setPermissions({
            canManageOrgRoles: userAuth.canManageOrgRoles,
            canManageSingleRoles: userAuth.canManageSingleRoles,
            canManageDerivedRoles: userAuth.canManageDerivedRoles,
            canAssignRoles: userAuth.canAssignRoles
          });
        } else {
          // Not found -> no admin permissions
          setPermissions({
            canManageOrgRoles: false,
            canManageSingleRoles: false,
            canManageDerivedRoles: false,
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
    <FlexBox direction="Column" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* Topbar - ShellBar */}
      <ShellBar
        primaryTitle="fanrio"
        secondaryTitle="/ BDC Auth Wizard"
        logo={<Icon name="org-chart" style={{ color: '#0F172A', fontSize: '20px' }} />}
      >
        <div slot="content" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Select
            onChange={(e) => setSimulatedUser(e.detail.selectedOption.value)}
            style={{ minWidth: '200px' }}
          >
            <Option value="jdoe" selected={simulatedUser === 'jdoe'}>John Doe (jdoe)</Option>
            <Option value="asmith" selected={simulatedUser === 'asmith'}>Alice Smith (asmith)</Option>
            <Option value="bobm" selected={simulatedUser === 'bobm'}>Bob Martin (bobm)</Option>
            <Option value="cwhite" selected={simulatedUser === 'cwhite'}>Charlie White (cwhite)</Option>
            <Option value="admin" selected={simulatedUser === 'admin'}>System Admin (admin)</Option>
          </Select>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--sapContent_LabelColor)' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }} />
            <span style={{ fontSize: '0.875rem' }}>CAP Connected · SQLite (mock)</span>
          </div>
        </div>
      </ShellBar>

      <FlexBox direction="Row" style={{ flexGrow: 1, overflow: 'hidden', width: '100%' }}>
        {/* Sidebar Navigation */}
        <SideNavigation
          style={{ height: '100%', flexShrink: 0 }}
          onSelectionChange={(e) => {
            const itemId = e.detail.item.id;
            setActiveNav(itemId);
            if (itemId !== 'wizard') setWizardContext(null);
          }}
        >
          <SideNavigationItem id="home" text="Home Dashboard" icon="home" selected={activeNav === 'home'} />
          <SideNavigationItem id="org" text="Organization" icon="building" selected={activeNav === 'org'} />
          <SideNavigationItem id="roles" text="Roles" icon="shield" selected={activeNav === 'roles'} />
          <SideNavigationItem id="assignments" text="Role Assignments" icon="group" selected={activeNav === 'assignments'} />
          <SideNavigationItem id="audit" text="Audit Logs" icon="history" selected={activeNav === 'audit'} />
          <SideNavigationItem id="admin" text="Administration" icon="settings" selected={activeNav === 'admin'} />
        </SideNavigation>

        {/* Main Content Area */}
        <Page style={{ flexGrow: 1, height: '100%' }}>
          <div style={{ padding: '2rem' }}>
            {activeNav === 'home'        && <HomeView setActiveNav={setActiveNav} navigateToRoles={navigateToRoles} onCreateRole={() => openWizard()} permissions={permissions} />}
            {activeNav === 'org'         && <OrgStructureView onGenerateRole={(nodeId) => openWizard({ orgNodeId: nodeId })} permissions={permissions} />}
            {activeNav === 'roles'       && <RolesDashboard  onDeriveRole={(roleId)   => openWizard({ parentRoleId: roleId })} onEditRole={(roleId) => openWizard({ roleId })} onCreateRole={() => openWizard()} initialFilter={rolesFilter} setInitialFilter={setRolesFilter} permissions={permissions} />}
            {activeNav === 'wizard'      && <Wizard context={wizardContext ?? {}} onDone={() => setActiveNav('roles')} permissions={permissions} />}
            {activeNav === 'assignments' && <RoleAssignmentsView permissions={permissions} />}
            {activeNav === 'audit'       && <AuditLogsView />}
            {activeNav === 'admin'       && <AdministrationView />}
          </div>
        </Page>
      </FlexBox>
    </FlexBox>
  );
}
