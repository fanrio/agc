import { useState } from 'react';
import { Box, Typography, Tabs, Tab } from '@mui/material';
import { Settings, Network, Cloud, Terminal, ShieldAlert, GitFork, Database } from 'lucide-react';
import RestrictionFieldsView from './RestrictionFieldsView';
import StreamsView from './StreamsView';
import BdcSettingsView from './BdcSettingsView';
import BdcApiTesterView from './BdcApiTesterView';
import AppAuthorizationsView from './AppAuthorizationsView';
import DynamicRulesView from './DynamicRulesView';
import MasterDataEditorView from './MasterDataEditorView';
import { usePermissions } from '../context/PermissionsContext';

export default function AdministrationView() {
  const { permissions } = usePermissions();
  const [activeTab, setActiveTab] = useState(0);

  const allTabs = [
    {
      label: 'BDC Connections',
      icon: <Cloud size={16} />,
      component: <BdcSettingsView />,
      visible: permissions?.isSuperAdmin || permissions?.canManageSettings
    },
    {
      label: 'Restriction Fields',
      icon: <Settings size={16} />,
      component: <RestrictionFieldsView />,
      visible: permissions?.isSuperAdmin || permissions?.canManageSettings
    },
    {
      label: 'Streams',
      icon: <Network size={16} />,
      component: <StreamsView />,
      visible: permissions?.isSuperAdmin || permissions?.canManageSettings
    },
    {
      label: 'App Authorizations',
      icon: <ShieldAlert size={16} />,
      component: <AppAuthorizationsView />,
      visible: permissions?.isSuperAdmin || permissions?.canManageAppUsers
    },
    {
      label: 'Dynamic Rules',
      icon: <GitFork size={16} />,
      component: <DynamicRulesView />,
      visible: permissions?.isSuperAdmin || permissions?.canManageSettings
    },
    {
      label: 'Master Data Editor',
      icon: <Database size={16} />,
      component: <MasterDataEditorView />,
      visible: permissions?.isSuperAdmin || permissions?.canManageSettings
    },
    {
      label: 'BDC API Tester',
      icon: <Terminal size={16} />,
      component: <BdcApiTesterView />,
      visible: permissions?.isSuperAdmin || permissions?.canManageSettings
    }
  ];

  const TABS = allTabs
    .filter(t => t.visible)
    .map((t, idx) => ({ id: idx, ...t }));

  const visibleTabIndices = TABS.map(t => t.id);
  const selectedTabIndex = visibleTabIndices.includes(activeTab) ? activeTab : (visibleTabIndices[0] !== undefined ? visibleTabIndices[0] : 0);

  const handleChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  if (TABS.length === 0) {
    return (
      <Box sx={{ p: 4, textAlign: 'center', bgcolor: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 2 }}>
        <Typography variant="h6" color="error.main" sx={{ fontWeight: 700, mb: 1 }}>Access Denied</Typography>
        <Typography variant="body2" color="text.secondary">You do not have administration privileges in this application.</Typography>
      </Box>
    );
  }

  // Find currently active tab definition
  const currentTab = TABS.find(t => t.id === selectedTabIndex) || TABS[0];

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>System Administration</Typography>
        <Typography variant="body2" color="text.secondary">Configure global parameters, restriction fields, application contexts, BDC gateways, and dynamic generation engines</Typography>
      </Box>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs 
          value={selectedTabIndex} 
          onChange={handleChange} 
          textColor="primary" 
          indicatorColor="primary" 
          variant="scrollable" 
          scrollButtons="auto"
        >
          {TABS.map(tab => (
            <Tab 
              key={tab.id}
              value={tab.id}
              icon={tab.icon} 
              iconPosition="start" 
              label={tab.label} 
              sx={{ fontWeight: 600, minHeight: 48 }}
            />
          ))}
        </Tabs>
      </Box>

      {/* Content panel */}
      <Box>
        {currentTab.component}
      </Box>
    </Box>
  );
}
