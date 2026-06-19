import { useState } from 'react';
import { Box, Typography, Tabs, Tab } from '@mui/material';
import { Settings, Network, Cloud, Terminal, ShieldAlert } from 'lucide-react';
import RestrictionFieldsView from './RestrictionFieldsView';
import StreamsView from './StreamsView';
import BdcSettingsView from './BdcSettingsView';
import BdcApiTesterView from './BdcApiTesterView';
import AppAuthorizationsView from './AppAuthorizationsView';

export default function AdministrationView() {
  const [activeTab, setActiveTab] = useState(0); // 0 = fields, 1 = streams, 2 = bdc, 3 = tester, 4 = authorizations

  const handleChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>System Administration</Typography>
        <Typography variant="body2" color="text.secondary">Configure global parameters, restriction fields, operational streams, and BDC gateways</Typography>
      </Box>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={handleChange} textColor="primary" indicatorColor="primary">
          <Tab 
            icon={<Settings size={16} />} 
            iconPosition="start" 
            label="Restriction Fields" 
            sx={{ fontWeight: 600, minHeight: 48 }}
          />
          <Tab 
            icon={<Network size={16} />} 
            iconPosition="start" 
            label="Operational Streams" 
            sx={{ fontWeight: 600, minHeight: 48 }}
          />
          <Tab 
            icon={<Cloud size={16} />} 
            iconPosition="start" 
            label="BDC Connections" 
            sx={{ fontWeight: 600, minHeight: 48 }}
          />
          <Tab 
            icon={<Terminal size={16} />} 
            iconPosition="start" 
            label="BDC API Tester" 
            sx={{ fontWeight: 600, minHeight: 48 }}
          />
          <Tab 
            icon={<ShieldAlert size={16} />} 
            iconPosition="start" 
            label="App Authorizations" 
            sx={{ fontWeight: 600, minHeight: 48 }}
          />
        </Tabs>
      </Box>

      {/* Content panel */}
      <Box>
        {activeTab === 0 && <RestrictionFieldsView />}
        {activeTab === 1 && <StreamsView />}
        {activeTab === 2 && <BdcSettingsView />}
        {activeTab === 3 && <BdcApiTesterView />}
        {activeTab === 4 && <AppAuthorizationsView />}
      </Box>
    </Box>
  );
}
