import { useState } from 'react';
import { TabContainer, Tab, Title, Text, FlexBox } from '@ui5/webcomponents-react';
import "@ui5/webcomponents-icons/dist/settings.js";
import "@ui5/webcomponents-icons/dist/connected.js";
import "@ui5/webcomponents-icons/dist/cloud.js";
import "@ui5/webcomponents-icons/dist/sys-monitor.js";
import "@ui5/webcomponents-icons/dist/shield.js";
import RestrictionFieldsView from './RestrictionFieldsView';
import StreamsView from './StreamsView';
import BdcSettingsView from './BdcSettingsView';
import BdcApiTesterView from './BdcApiTesterView';
import AppAuthorizationsView from './AppAuthorizationsView';

export default function AdministrationView() {
  const [activeTab, setActiveTab] = useState('fields');

  const handleTabSelect = (e) => {
    setActiveTab(e.detail.tab.id);
  };

  return (
    <div>
      <FlexBox direction="Column" style={{ marginBottom: '1.5rem', gap: '0.25rem' }}>
        <Title level="H3" style={{ fontWeight: 700 }}>System Administration</Title>
        <Text style={{ color: 'var(--sapContent_LabelColor)' }}>Configure global parameters, restriction fields, operational streams, and BDC gateways</Text>
      </FlexBox>

      {/* Tabs */}
      <TabContainer onTabSelect={handleTabSelect} style={{ marginBottom: '1.5rem' }}>
        <Tab 
          id="fields"
          text="Restriction Fields" 
          icon="settings"
          selected={activeTab === 'fields'}
        />
        <Tab 
          id="streams"
          text="Operational Streams" 
          icon="connected"
          selected={activeTab === 'streams'}
        />
        <Tab 
          id="bdc"
          text="BDC Connections" 
          icon="cloud"
          selected={activeTab === 'bdc'}
        />
        <Tab 
          id="tester"
          text="BDC API Tester" 
          icon="sys-monitor"
          selected={activeTab === 'tester'}
        />
        <Tab 
          id="authorizations"
          text="App Authorizations" 
          icon="shield"
          selected={activeTab === 'authorizations'}
        />
      </TabContainer>

      {/* Content panel */}
      <div>
        {activeTab === 'fields' && <RestrictionFieldsView />}
        {activeTab === 'streams' && <StreamsView />}
        {activeTab === 'bdc' && <BdcSettingsView />}
        {activeTab === 'tester' && <BdcApiTesterView />}
        {activeTab === 'authorizations' && <AppAuthorizationsView />}
      </div>
    </div>
  );
}
